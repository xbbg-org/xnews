import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { isRecord } from "../src/json.js";

const ROOT_MANIFEST_PATH = new URL("../package.json", import.meta.url);
const COMPANION_MANIFEST_PATH = new URL(
  "../packages/xnews-langgraph/package.json",
  import.meta.url,
);
const CI_PATH = new URL("../.github/workflows/ci.yml", import.meta.url);
const PUBLISH_PATH = new URL("../.github/workflows/npm-publish.yml", import.meta.url);

function rootScript(manifest: unknown, name: string): string {
  const scripts = isRecord(manifest) ? manifest["scripts"] : undefined;
  const script = isRecord(scripts) ? scripts[name] : undefined;
  if (typeof script !== "string") throw new Error(`Expected a ${name} script`);
  return script;
}

test("root remains a publishable zero-runtime-dependency workspace package", async () => {
  const root: unknown = JSON.parse(await readFile(ROOT_MANIFEST_PATH, "utf8"));
  expect(root).toMatchObject({
    name: "@xbbg/xnews",
    workspaces: ["packages/*"],
    engines: { node: ">=24" },
  });
  expect(root).not.toHaveProperty("dependencies");
  expect(root).not.toHaveProperty("peerDependencies");

  const companion: unknown = JSON.parse(await readFile(COMPANION_MANIFEST_PATH, "utf8"));
  expect(companion).toMatchObject({
    name: "@xbbg/xnews-langgraph",
    peerDependencies: {
      "@xbbg/xnews": "^0.2.0",
      "@langchain/core": "^1.2.9",
      "@langchain/langgraph": "^1.4.12",
      langchain: "^1.5.10",
      zod: "^3.25.76 || ^4.2.0",
    },
    devDependencies: { "@xbbg/xnews": "file:../.." },
  });
  expect(companion).not.toHaveProperty("dependencies");

  // Same snapshot hazard as CI: any script that both builds core and re-links it
  // into the companion must build first, or the companion gates run against a
  // copied core that has no `dist`.
  for (const name of ["test:langgraph", "quality:langgraph"]) {
    const script = rootScript(root, name);
    expect(script).toContain("bun run install:langgraph");
    expect(script.indexOf("bun run build:core")).toBeLessThan(
      script.indexOf("bun run install:langgraph"),
    );
  }
});

test("CI builds local core before companion gates and pins both Zod floors", async () => {
  const workflow = await readFile(CI_PATH, "utf8");
  expect(workflow).toContain("core-quality:");
  expect(workflow).toContain("langgraph-quality:");
  expect(workflow).toContain("langgraph-package-smoke:");
  expect(workflow).toContain('zod: ["3.25.76", "4.2.0"]');
  expect(workflow).toContain("run: bun run build:core");
  expect(workflow).toContain("run: bun run --cwd packages/xnews-langgraph quality");
  expect(workflow).toContain("bun run --cwd packages/xnews-langgraph smoke:packaged-install --");
  expect(workflow.indexOf("run: bun run build:core")).toBeLessThan(
    workflow.indexOf("run: bun run --cwd packages/xnews-langgraph quality"),
  );

  // `bun install --cwd` copies the core package tree into the install store rather
  // than symlinking it, so a link taken before `dist` exists snapshots a core with
  // no type declarations and every companion import fails to resolve.
  const linkIndex = workflow.indexOf(
    "bun install --cwd packages/xnews-langgraph --frozen-lockfile",
  );
  expect(linkIndex).toBeGreaterThan(-1);
  expect(workflow.indexOf("run: bun run build:core")).toBeLessThan(linkIndex);
});

test("publish workflow allowlists packages and separates verification from authority", async () => {
  const workflow = await readFile(PUBLISH_PATH, "utf8");
  expect(workflow).toContain('tags: ["v*", "xnews-langgraph-v*"]');
  expect(workflow).toContain("- core\n          - langgraph");
  expect(workflow).toContain("xnews-langgraph-v*)");
  expect(workflow).toContain('PACKAGE_ID="langgraph"');
  expect(workflow).toContain("v*)");
  expect(workflow).toContain('PACKAGE_ID="core"');
  expect(workflow).toContain("tag '$REF_NAME' does not select an allowlisted npm package");
  expect(workflow).toContain("unknown package '$PACKAGE_ID'; expected core or langgraph");
  expect(workflow).not.toContain("Skipping npm publish for non-stable tag");

  expect(workflow).toContain('PACKAGE_NAME="@xbbg/xnews"');
  expect(workflow).toContain('PACKAGE_NAME="@xbbg/xnews-langgraph"');
  expect(workflow).toContain('QUALITY_COMMAND="quality:core"');
  expect(workflow).toContain('QUALITY_COMMAND="quality:langgraph"');
  expect(workflow).toContain('SMOKE_COMMAND="smoke:packaged-install:core"');
  expect(workflow).toContain('SMOKE_COMMAND="smoke:packaged-install:langgraph"');
  expect(workflow).toContain("does not match tag version");
  expect(workflow).toContain("already exists on npm; publication is idempotently complete");
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).toContain("environment: npm-publish");
  expect(workflow).toContain("npm pack");
  expect(workflow).toContain("package_sha256");
  expect(workflow).toContain("npm publish package.tgz --ignore-scripts");
  expect(workflow.indexOf("name: Verify and pack")).toBeLessThan(
    workflow.indexOf("name: Publish verified"),
  );
  expect(workflow.indexOf("npm pack")).toBeLessThan(workflow.indexOf("id-token: write"));
});

test("first companion publication fails closed and tags only after publication", async () => {
  const workflow = await readFile(PUBLISH_PATH, "utf8");
  expect(workflow).toContain("bootstrap:");
  expect(workflow).toContain("bootstrap is workflow_dispatch-only and restricted to langgraph");
  expect(workflow).toContain("bootstrap must be dispatched from the main branch");
  expect(workflow).toContain(
    "bootstrap is only allowed before the package's first npm publication",
  );
  expect(workflow).toContain("npm registry lookup failed closed");
  expect(workflow).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_BOOTSTRAP_TOKEN }}");
  expect(workflow).toContain('git tag -a "$RELEASE_TAG" -m "$RELEASE_TITLE"');
  expect(workflow).toContain('git push origin "refs/tags/${RELEASE_TAG}"');
  expect(workflow.indexOf("name: Bootstrap first companion publication")).toBeLessThan(
    workflow.indexOf('git tag -a "$RELEASE_TAG" -m "$RELEASE_TITLE"'),
  );
  expect(workflow).toContain("unset NODE_AUTH_TOKEN NPM_TOKEN NPM_CONFIG_USERCONFIG");
  expect(workflow).toContain("--ignore-scripts --provenance --access public");
  expect(workflow).not.toContain("npm publish --access public --registry");
  expect(workflow).not.toContain("secrets.NPM_TOKEN");
  expect(workflow).not.toContain("uses: actions/checkout@v");
  expect(workflow).not.toContain("uses: actions/setup-node@v");
  expect(workflow).not.toContain("uses: oven-sh/setup-bun@v");
});
