import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = resolve(packageRoot, "../..");
const supportedZodVersions = ["3.25.76", "4.2.0"] as const;
type SupportedZodVersion = (typeof supportedZodVersions)[number];

function isSupportedZodVersion(value: string): value is SupportedZodVersion {
  return supportedZodVersions.some((version) => version === value);
}

const requestedVersion = process.argv[2];
let versions: readonly SupportedZodVersion[];
if (requestedVersion === undefined) {
  versions = supportedZodVersions;
} else {
  if (!isSupportedZodVersion(requestedVersion)) {
    throw new Error(
      `Expected Zod version ${supportedZodVersions.join(" or ")}; received ${requestedVersion}`,
    );
  }
  versions = [requestedVersion];
}

function run(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(`${command} failed (${String(result.status)})\n${detail}`);
  }
  return result.stdout ?? "";
}

function environmentTarball(
  name: "XNEWS_CORE_TARBALL" | "XNEWS_LANGGRAPH_TARBALL",
): string | undefined {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) return undefined;
  return isAbsolute(value) ? value : resolve(repositoryRoot, value);
}

async function localTarballs(workspace: string): Promise<{ core: string; companion: string }> {
  const configuredCore = environmentTarball("XNEWS_CORE_TARBALL");
  const configuredCompanion = environmentTarball("XNEWS_LANGGRAPH_TARBALL");
  if (configuredCore === undefined) {
    run("npm", ["pack", "--pack-destination", workspace], repositoryRoot);
  }
  if (configuredCompanion === undefined) {
    run("npm", ["pack", "--pack-destination", workspace], packageRoot);
  }
  const entries = await readdir(workspace);
  const core =
    configuredCore ??
    entries
      .filter((entry) => /^xbbg-xnews-\d/u.test(entry))
      .map((entry) => join(workspace, entry))[0];
  const companion =
    configuredCompanion ??
    entries
      .filter((entry) => entry.startsWith("xbbg-xnews-langgraph-"))
      .map((entry) => join(workspace, entry))[0];
  if (core === undefined || companion === undefined)
    throw new Error("npm pack did not produce both tarballs");
  return { core, companion };
}

const workspace = await mkdtemp(join(tmpdir(), "xnews-langgraph-packed-"));
let failure: unknown;
try {
  const tarballs = await localTarballs(workspace);
  for (const zodVersion of versions) {
    const consumer = join(workspace, `zod-${zodVersion}`);
    await mkdir(consumer, { recursive: true });
    await writeFile(
      join(consumer, "package.json"),
      `${JSON.stringify(
        {
          name: `xnews-langgraph-zod-${zodVersion.replaceAll(".", "-")}`,
          private: true,
          type: "module",
        },
        null,
        2,
      )}\n`,
    );
    run(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--save-exact",
        tarballs.core,
        tarballs.companion,
        "@langchain/core@1.2.9",
        "@langchain/langgraph@1.4.12",
        "langchain@1.5.10",
        `zod@${zodVersion}`,
        "typescript@5.9.3",
      ],
      consumer,
    );

    await writeFile(
      join(consumer, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2024",
            lib: ["ES2024", "ESNext.Disposable", "DOM", "DOM.Iterable"],
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            exactOptionalPropertyTypes: true,
            skipLibCheck: true,
            noEmit: true,
          },
          include: ["probe.ts"],
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(consumer, "probe.ts"),
      [
        `import { createXnewsAnalyst, createXnewsTools, XnewsRuntimeContextSchema, type XnewsCatalogInput, type XnewsRuntimeContext, type XnewsWorksSearchInput } from "@xbbg/xnews-langgraph";`,
        `import type { BaseChatModel } from "@langchain/core/language_models/chat_models";`,
        `import { z as activeZod } from "zod";`,
        `import { z as z3 } from "zod/v3";`,
        `declare const model: BaseChatModel;`,
        `const context: XnewsRuntimeContext = {`,
        `  credentials: { privateValues: ["private"] as readonly string[] },`,
        `  mirrors: ["https://mirror.example"] as readonly string[],`,
        `};`,
        `const tools = createXnewsTools();`,
        `const analyst = createXnewsAnalyst({ model });`,
        `void analyst.invoke({ messages: [] }, { context });`,
        `void tools;`,
        `const CustomContextSchema = XnewsRuntimeContextSchema.extend({ tenantLabel: z3.string() });`,
        `const customContext: z3.input<typeof CustomContextSchema> = {`,
        `  tenantLabel: "tenant-a",`,
        `  credentials: { privateValues: ["private"] as readonly string[] },`,
        `  mirrors: ["https://mirror.example"] as readonly string[],`,
        `};`,
        `const CustomResultSchema = activeZod.object({`,
        `  summary: activeZod.string(),`,
        `  claims: activeZod.array(activeZod.object({ statement: activeZod.string(), evidence: activeZod.array(activeZod.string()), confidence: activeZod.number() })),`,
        `  sources: activeZod.array(activeZod.object({ id: activeZod.string(), title: activeZod.string().optional(), url: activeZod.string().optional(), provider: activeZod.string().optional() })),`,
        `  uncertainty: activeZod.array(activeZod.string()),`,
        `  limitations: activeZod.array(activeZod.string()),`,
        `  providerDiagnostics: activeZod.array(activeZod.object({ provider: activeZod.string(), status: activeZod.enum(["ok", "empty", "unsupported", "partial", "error", "disabled"]), warningCount: activeZod.number(), errorCode: activeZod.enum(["config", "network", "http_status", "timeout", "aborted", "unknown"]).optional() })),`,
        `  generatedAt: activeZod.string(),`,
        `  customFinding: activeZod.string(),`,
        `});`,
        `const customAnalyst = createXnewsAnalyst({ model, contextSchema: CustomContextSchema, resultSchema: CustomResultSchema });`,
        `void customAnalyst.invoke({ messages: [] }, { context: customContext }).then((state) => state.structuredResponse?.customFinding.toUpperCase());`,
        `const worksInput: XnewsWorksSearchInput = { operation: "search", source: "works", query: "rates" };`,
        `// @ts-expect-error a present selector cannot be undefined`,
        `const invalidWorksInput: XnewsWorksSearchInput = { operation: "search", source: "works", query: undefined };`,
        `const catalogInput: XnewsCatalogInput = { operation: "providers", seam: undefined };`,
        `void worksInput; void invalidWorksInput; void catalogInput;`,
      ].join("\n"),
    );
    run("npx", ["--no-install", "tsc", "-p", "tsconfig.json"], consumer);

    await writeFile(join(consumer, "probe.mjs"), runtimeProbe(zodVersion));
    run("node", ["probe.mjs"], consumer);
  }
} catch (error) {
  failure = error;
} finally {
  await rm(workspace, { force: true, recursive: true });
}
if (failure !== undefined) {
  console.error(
    failure instanceof Error
      ? failure.message
      : typeof failure === "string"
        ? failure
        : "Unknown packaged-install smoke failure",
  );
  process.exitCode = 1;
}

function runtimeProbe(zodVersion: string): string {
  return `
import { createRequire } from "node:module";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { XNEWS_TOOL_NAMES, createXnewsAnalyst, createXnewsTools } from "@xbbg/xnews-langgraph";

const require = createRequire(import.meta.url);
const coreManifest = require("@xbbg/xnews/package.json");
const companionManifest = require("@xbbg/xnews-langgraph/package.json");
const zodManifest = require("zod/package.json");
if (zodManifest.version !== ${JSON.stringify(zodVersion)}) throw new Error("wrong exact Zod floor");
for (const manifest of [coreManifest, companionManifest]) {
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const specifier of Object.values(manifest[field] ?? {})) {
      if (/^(?:file|link|workspace):/.test(String(specifier))) throw new Error("local runtime protocol leaked");
    }
  }
}
if (coreManifest.dependencies || coreManifest.peerDependencies) throw new Error("core runtime contract changed");
const tools = createXnewsTools();
if (tools.length !== 10 || tools.map((tool) => tool.name).join() !== XNEWS_TOOL_NAMES.join()) throw new Error("tool registry mismatch");

class SmokeModel extends BaseChatModel {
  boundToolList = [];
  _llmType() { return "packaged-smoke"; }
  bindTools(tools) { this.boundToolList = tools; return this; }
  async _generate(messages) {
    const toolMessages = messages.filter((message) => ToolMessage.isInstance(message));
    if (toolMessages.length === 0) return call("xnews_catalog", { operation: "capabilities" }, "catalog-1");
    const structured = this.boundToolList.map(toolName).find((name) => name && !XNEWS_TOOL_NAMES.includes(name));
    if (!structured) throw new Error("structured tool missing");
    return call(structured, {
      summary: "Packaged analyst completed.", claims: [], sources: [], uncertainty: [],
      limitations: [], providerDiagnostics: [], generatedAt: "2026-08-25T00:00:00.000Z"
    }, "structured-1");
  }
}
function toolName(tool) {
  if (tool && typeof tool.name === "string") return tool.name;
  if (tool?.function && typeof tool.function.name === "string") return tool.function.name;
}
function call(name, args, id) {
  const message = new AIMessage({ content: "", tool_calls: [{ name, args, id, type: "tool_call" }] });
  return { generations: [{ text: "", message }] };
}
const analyst = createXnewsAnalyst({ model: new SmokeModel({}) });
if (typeof analyst.invoke !== "function" || typeof analyst.stream !== "function" || typeof analyst.streamEvents !== "function") throw new Error("native graph interfaces missing");
const result = await analyst.invoke({ messages: [{ role: "user", content: "Run smoke." }] }, { context: {} });
if (result.structuredResponse?.summary !== "Packaged analyst completed.") throw new Error("structured response missing");
const artifactMessage = result.messages.find((message) => ToolMessage.isInstance(message) && message.artifact);
if (!artifactMessage) throw new Error("tool artifact was not preserved");
`;
}
