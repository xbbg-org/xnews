/**
 * OCR for documents with no text layer.
 *
 * A scanned PDF carries page images and no characters, so text extraction has
 * nothing to read. This sends those page images to a vision model over an
 * OpenAI-compatible `/v1/chat/completions` endpoint, which is what both vLLM
 * and SGLang expose when serving a document-parsing model — no Python and no
 * dependency on this side, just `fetch`.
 *
 * Defaults target Baidu's Unlimited-OCR (https://github.com/baidu/Unlimited-OCR),
 * whose recipe pins `temperature: 0`, a `Multi page parsing.` prompt, and an
 * `image_mode` of `base` for multi-page requests. Every one of those is
 * overridable, and the transport is plain OpenAI chat completions, so any
 * comparable server works.
 *
 * The caller runs the server. This module never starts one and has no default
 * endpoint: `baseUrl` is required.
 */

import { XnewsFetchError } from "./errors.js";
import { postJson } from "./http.js";
import type { SourceFetchOptions } from "./types.js";

/** One image to read, in an encoding the server accepts. */
export interface OcrImage {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  /** 1-based page number, preserved on the result. */
  readonly page?: number;
}

export interface OcrPage {
  readonly page: number;
  readonly text: string;
}

export interface OcrResult {
  readonly pages: readonly OcrPage[];
  readonly text: string;
  readonly model: string;
  readonly warnings: readonly string[];
}

export interface OcrOptions extends SourceFetchOptions {
  /**
   * Server origin, including any path prefix — `http://127.0.0.1:10000` for a
   * local SGLang/vLLM server, or `https://openrouter.ai/api` for OpenRouter.
   * `/v1/chat/completions` is appended. Required: this package ships no
   * endpoint and starts no server.
   */
  readonly baseUrl: string;
  /** Served model name; defaults to `Unlimited-OCR`. */
  readonly model?: string;
  /** Bearer token, when the server requires one. */
  readonly apiKey?: string;
  /** Overrides the task prompt. */
  readonly prompt?: string;
  /**
   * Unlimited-OCR's two image configurations. `gundam` crops at 640px and is
   * for a single image; `base` runs at 1024px and is the only mode its recipe
   * supports for multi-page requests. Defaults by batch size.
   */
  readonly imageMode?: "base" | "gundam";
  /**
   * SGLang's serialized `DeepseekOCRNoRepeatNGramLogitProcessor`, which the
   * recipe pairs with `ngram_size: 35` to stop the decoder looping on dense
   * pages. vLLM does not accept it; leave unset there.
   */
  readonly customLogitProcessor?: string;
  /**
   * Pages per request. The recipe sends a whole document at once, but a long
   * book overruns the 32k context, so this batches. Defaults to 8.
   */
  readonly pagesPerRequest?: number;
  /** Extra body fields merged last, so they win over every default above. */
  readonly extraBody?: Readonly<Record<string, unknown>>;
}

/** OpenRouter's OpenAI-compatible origin, for callers routing through it. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api";

const DEFAULT_MODEL = "Unlimited-OCR";
const SINGLE_PAGE_PROMPT = "<image>document parsing.";
const MULTI_PAGE_PROMPT = "<image>Multi page parsing.";
const DEFAULT_PAGES_PER_REQUEST = 8;
/** Recipe values: 35-gram suppression over a 128 (single) or 1024 (multi) window. */
const NGRAM_SIZE = 35;
const SINGLE_PAGE_NGRAM_WINDOW = 128;
const MULTI_PAGE_NGRAM_WINDOW = 1024;

/**
 * Reads a set of page images. Pages are batched, and a batch that fails is
 * reported rather than silently dropped, so a partial read is visible as
 * missing page numbers plus a warning instead of looking like a short book.
 */
export async function ocrImages(
  images: readonly OcrImage[],
  options: OcrOptions,
): Promise<OcrResult> {
  if (options.baseUrl.trim() === "") {
    throw new XnewsFetchError("config", "OCR requires a baseUrl; xnews starts no OCR server", {
      url: "",
    });
  }
  if (images.length === 0) {
    throw new XnewsFetchError("config", "OCR received no page images", { url: options.baseUrl });
  }

  const model = options.model ?? DEFAULT_MODEL;
  const batchSize = normalizeBatchSize(options.pagesPerRequest);
  const endpoint = joinEndpoint(options.baseUrl);
  const warnings: string[] = [];
  const pages: OcrPage[] = [];

  for (let start = 0; start < images.length; start += batchSize) {
    const batch = images.slice(start, start + batchSize);
    const prompt = options.prompt ?? (batch.length === 1 ? SINGLE_PAGE_PROMPT : MULTI_PAGE_PROMPT);
    const multiPage = batch.length > 1;
    const body = {
      model,
      messages: [{ role: "user", content: messageContent(prompt, batch) }],
      temperature: 0,
      stream: false,
      // Unlimited-OCR emits layout markers as special tokens; dropping them
      // loses table and heading structure.
      skip_special_tokens: false,
      images_config: { image_mode: options.imageMode ?? (multiPage ? "base" : "gundam") },
      ...(options.customLogitProcessor === undefined
        ? {}
        : {
            custom_logit_processor: options.customLogitProcessor,
            custom_params: {
              ngram_size: NGRAM_SIZE,
              window_size: multiPage ? MULTI_PAGE_NGRAM_WINDOW : SINGLE_PAGE_NGRAM_WINDOW,
            },
          }),
      ...options.extraBody,
    };

    let text: string;
    try {
      const headers = authHeaders(options);
      text = readCompletion(
        await postJson(
          endpoint,
          body,
          requestOptions(options),
          options.userAgent,
          headers === undefined ? {} : { headers },
        ),
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      const first = batch[0]?.page ?? start + 1;
      const last = batch.at(-1)?.page ?? start + batch.length;
      warnings.push(
        `ocr: pages ${first}-${last} failed (${error instanceof Error ? error.message : String(error)})`,
      );
      continue;
    }

    // A multi-page reply is one document; splitting it back into pages would
    // invent boundaries the model did not state, so a batch maps to its first
    // page and its whole span lands in that entry's text.
    pages.push({ page: batch[0]?.page ?? start + 1, text: text.trim() });
  }

  if (pages.length === 0) {
    throw new XnewsFetchError(
      "network",
      `OCR returned nothing for all ${images.length} page image(s): ${warnings.join("; ")}`,
      { url: endpoint },
    );
  }

  return { pages, text: pages.map((entry) => entry.text).join("\n\n"), model, warnings };
}

/**
 * Appends the chat-completions path while keeping any prefix on `baseUrl`.
 * `new URL("/v1/…", base)` resolves against the origin and silently discards
 * the prefix, turning `https://openrouter.ai/api` into `https://openrouter.ai`
 * — a 404 that looks like the server rejecting the request.
 */
function joinEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}${trimmed.endsWith("/v1") ? "" : "/v1"}/chat/completions`;
}

function requestOptions(options: OcrOptions): SourceFetchOptions {
  return {
    ...options,
    // A page of dense text comes back large, and a batch comes back larger.
    maxResponseBytes: options.maxResponseBytes ?? 64 * 1024 * 1024,
  };
}

/** Bearer auth is a per-request header, not a fetch option. */
function authHeaders(options: OcrOptions): Readonly<Record<string, string>> | undefined {
  return options.apiKey === undefined || options.apiKey === ""
    ? undefined
    : { authorization: `Bearer ${options.apiKey}` };
}

function messageContent(
  prompt: string,
  images: readonly OcrImage[],
): readonly Readonly<Record<string, unknown>>[] {
  return [
    { type: "text", text: prompt },
    ...images.map((image) => ({
      type: "image_url",
      image_url: { url: `data:${image.mediaType};base64,${base64(image.bytes)}` },
    })),
  ];
}

/** Reads the assistant message out of an OpenAI chat completion. */
function readCompletion(body: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new XnewsFetchError("config", "OCR server returned a non-JSON completion", { url: "" });
  }
  if (typeof payload !== "object" || payload === null) {
    throw new XnewsFetchError("config", "OCR completion was not an object", { url: "" });
  }
  if ("error" in payload) {
    throw new XnewsFetchError("http_status", `OCR server error: ${String(payload.error)}`, {
      url: "",
    });
  }
  if (!("choices" in payload) || !Array.isArray(payload.choices)) {
    throw new XnewsFetchError("config", "OCR completion stated no choices", { url: "" });
  }
  const first: unknown = payload.choices[0];
  if (typeof first !== "object" || first === null || !("message" in first)) {
    throw new XnewsFetchError("config", "OCR completion stated no message", { url: "" });
  }
  const message = first.message;
  if (typeof message !== "object" || message === null || !("content" in message)) {
    throw new XnewsFetchError("config", "OCR completion message stated no content", { url: "" });
  }
  return typeof message.content === "string" ? message.content : "";
}

function normalizeBatchSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGES_PER_REQUEST;
  if (!Number.isInteger(value) || value < 1) {
    throw new XnewsFetchError("config", "pagesPerRequest must be a positive integer", { url: "" });
  }
  return value;
}

/** Chunked so a multi-megabyte page image cannot blow the argument limit. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
