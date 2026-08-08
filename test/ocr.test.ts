import { expect, test } from "bun:test";
import { XnewsFetchError } from "../src/errors.js";
import { isRecord } from "../src/json.js";
import { OPENROUTER_BASE_URL, ocrImages, type OcrImage } from "../src/ocr.js";

const PAGE: OcrImage = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]),
  mediaType: "image/jpeg",
  page: 1,
};

function completion(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function captureXnewsError(promise: Promise<unknown>): Promise<XnewsFetchError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof XnewsFetchError) return error;
    throw new Error("Expected XnewsFetchError", { cause: error });
  }
  throw new Error("Expected XnewsFetchError");
}

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** The request body as a plain record; fields are checked at each assertion. */
function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  const body = init?.body;
  if (typeof body !== "string") throw new TypeError("expected a JSON string request body");
  const parsed: unknown = JSON.parse(body);
  if (!isRecord(parsed)) throw new TypeError("expected a JSON object request body");
  return parsed;
}

/** Reads `images_config.image_mode` without asserting a shape. */
function imageMode(body: Record<string, unknown>): string | undefined {
  const config = body["images_config"];
  if (!isRecord(config)) return undefined;
  const mode = config["image_mode"];
  return typeof mode === "string" ? mode : undefined;
}

/** Reads the content parts of the first chat message. */
function messageParts(body: Record<string, unknown>): readonly Record<string, unknown>[] {
  const messages = body["messages"];
  if (!Array.isArray(messages)) return [];
  const first: unknown = messages[0];
  if (!isRecord(first) || !Array.isArray(first["content"])) return [];
  return first["content"].filter((part): part is Record<string, unknown> => isRecord(part));
}

/** Reads a nested `image_url.url`. */
function imageUrl(part: Record<string, unknown> | undefined): string | undefined {
  const holder = part?.["image_url"];
  if (!isRecord(holder)) return undefined;
  const url = holder["url"];
  return typeof url === "string" ? url : undefined;
}

test("a base path on the server URL is preserved, not resolved away", async () => {
  const dialed: string[] = [];
  await ocrImages([PAGE], {
    baseUrl: OPENROUTER_BASE_URL,
    fetch: (input) => {
      dialed.push(inputUrl(input));
      return Promise.resolve(completion("text"));
    },
  });

  // `new URL("/v1/...", base)` would have produced https://openrouter.ai/v1/...
  expect(dialed[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
});

test("a local server URL gains the chat-completions path once", async () => {
  for (const [baseUrl, expected] of [
    ["http://127.0.0.1:10000", "http://127.0.0.1:10000/v1/chat/completions"],
    ["http://127.0.0.1:10000/", "http://127.0.0.1:10000/v1/chat/completions"],
    ["http://127.0.0.1:10000/v1", "http://127.0.0.1:10000/v1/chat/completions"],
    ["http://127.0.0.1:10000/v1/chat/completions", "http://127.0.0.1:10000/v1/chat/completions"],
  ] as const) {
    const dialed: string[] = [];
    await ocrImages([PAGE], {
      baseUrl,
      fetch: (input) => {
        dialed.push(inputUrl(input));
        return Promise.resolve(completion("text"));
      },
    });
    expect(dialed[0]).toBe(expected);
  }
});

test("images are sent as base64 data URLs beside the prompt", async () => {
  let body: Record<string, unknown> = {};
  await ocrImages([PAGE], {
    baseUrl: "http://server.example",
    fetch: (_input, init) => {
      body = requestBody(init);
      return Promise.resolve(completion("text"));
    },
  });

  expect(body["model"]).toBe("Unlimited-OCR");
  expect(body["temperature"]).toBe(0);
  // Layout markers arrive as special tokens; dropping them loses structure.
  expect(body["skip_special_tokens"]).toBe(false);
  const parts = messageParts(body);
  expect(parts[0]?.["type"]).toBe("text");
  expect(imageUrl(parts[1])).toBe("data:image/jpeg;base64,/9j/4AA=");
});

test("image mode follows the recipe: gundam for one page, base for several", async () => {
  const modes: string[] = [];
  const fetchMode = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    void input;
    modes.push(imageMode(requestBody(init)) ?? "none");
    return Promise.resolve(completion("text"));
  };

  await ocrImages([PAGE], { baseUrl: "http://server.example", fetch: fetchMode });
  await ocrImages([PAGE, { ...PAGE, page: 2 }], {
    baseUrl: "http://server.example",
    fetch: fetchMode,
  });

  expect(modes).toEqual(["gundam", "base"]);
});

test("the SGLang logit processor is sent only when supplied, with recipe params", async () => {
  const bodies: Record<string, unknown>[] = [];
  const capture = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    void input;
    bodies.push(requestBody(init));
    return Promise.resolve(completion("text"));
  };

  // vLLM rejects the field, so it must be absent by default.
  await ocrImages([PAGE], { baseUrl: "http://server.example", fetch: capture });
  expect(bodies[0]).not.toHaveProperty("custom_logit_processor");

  await ocrImages([PAGE, { ...PAGE, page: 2 }], {
    baseUrl: "http://server.example",
    customLogitProcessor: "serialized-processor",
    fetch: capture,
  });
  expect(bodies[1]?.["custom_logit_processor"]).toBe("serialized-processor");
  expect(bodies[1]?.["custom_params"]).toEqual({ ngram_size: 35, window_size: 1024 });
});

test("pages are batched and every batch is one request", async () => {
  const sizes: number[] = [];
  const pages = Array.from({ length: 5 }, (_, index) => ({ ...PAGE, page: index + 1 }));
  await ocrImages(pages, {
    baseUrl: "http://server.example",
    pagesPerRequest: 2,
    fetch: (_input, init) => {
      sizes.push(messageParts(requestBody(init)).length - 1);
      return Promise.resolve(completion("text"));
    },
  });

  expect(sizes).toEqual([2, 2, 1]);
});

test("a failed batch is reported, not silently dropped", async () => {
  let call = 0;
  const pages = Array.from({ length: 4 }, (_, index) => ({ ...PAGE, page: index + 1 }));
  const result = await ocrImages(pages, {
    baseUrl: "http://server.example",
    pagesPerRequest: 2,
    fetch: () => {
      call += 1;
      return Promise.resolve(call === 1 ? new Response("boom", { status: 500 }) : completion("ok"));
    },
  });

  expect(result.pages.map((entry) => entry.page)).toEqual([3]);
  expect(result.warnings.some((warning) => warning.includes("pages 1-2 failed"))).toBe(true);
});

test("every batch failing is an error, not an empty read", async () => {
  const error = await captureXnewsError(
    ocrImages([PAGE], {
      baseUrl: "http://server.example",
      fetch: () => Promise.resolve(new Response("boom", { status: 500 })),
    }),
  );

  expect(error.message).toContain("OCR returned nothing");
});

test("an api key becomes a bearer header", async () => {
  let authorization: string | undefined;
  await ocrImages([PAGE], {
    baseUrl: OPENROUTER_BASE_URL,
    apiKey: "sk-test",
    fetch: (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? undefined;
      return Promise.resolve(completion("text"));
    },
  });

  expect(authorization).toBe("Bearer sk-test");
});

test("a server error payload surfaces instead of parsing as a completion", async () => {
  const error = await captureXnewsError(
    ocrImages([PAGE], {
      baseUrl: "http://server.example",
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "model not found" }), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
    }),
  );

  expect(error.message).toContain("model not found");
});

test("an empty page list and a blank server URL both fail as config", async () => {
  expect((await captureXnewsError(ocrImages([], { baseUrl: "http://s.example" }))).code).toBe(
    "config",
  );
  expect((await captureXnewsError(ocrImages([PAGE], { baseUrl: "   " }))).code).toBe("config");
});
