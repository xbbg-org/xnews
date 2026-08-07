import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";
import * as ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const catalogEntry = resolve(sourceRoot, "catalog.ts");

const networkModules = new Set([
  "dns",
  "http",
  "https",
  "net",
  "node:dns",
  "node:http",
  "node:https",
  "node:net",
  "node:tls",
  "tls",
  "undici",
]);
const networkConstructors = new Set(["EventSource", "WebSocket", "XMLHttpRequest"]);

async function staticImportGraph(entry: string): Promise<ReadonlySet<string>> {
  const visited = new Set<string>();
  const pending = [entry];

  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);

    const source = ts.createSourceFile(
      file,
      await readFile(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      let specifier: ts.Expression | undefined;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        specifier = node.moduleSpecifier;
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        specifier = node.arguments[0];
      }

      if (
        specifier !== undefined &&
        ts.isStringLiteral(specifier) &&
        specifier.text.startsWith(".")
      ) {
        const imported = resolve(
          dirname(file),
          specifier.text.endsWith(".js")
            ? `${specifier.text.slice(0, -3)}.ts`
            : `${specifier.text}.ts`,
        );
        if (!visited.has(imported)) pending.push(imported);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return visited;
}

async function findNetworkPrimitives(files: ReadonlySet<string>): Promise<readonly string[]> {
  const findings: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      await readFile(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const report = (node: ts.Node, primitive: string): void => {
      const location = source.getLineAndCharacterOfPosition(node.getStart(source));
      findings.push(
        `${relative(sourceRoot, file).replaceAll("\\", "/")}:${location.line + 1} ${primitive}`,
      );
    };
    const visit = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        networkModules.has(node.moduleSpecifier.text)
      ) {
        report(node, `imports ${node.moduleSpecifier.text}`);
      }
      if (ts.isCallExpression(node)) {
        if (
          ts.isIdentifier(node.expression) &&
          (node.expression.text === "fetch" ||
            (node.expression.text === "require" &&
              node.arguments[0] !== undefined &&
              ts.isStringLiteral(node.arguments[0]) &&
              networkModules.has(node.arguments[0].text)))
        ) {
          report(node, `calls ${node.expression.text}`);
        }
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          (node.expression.name.text === "fetch" || node.expression.name.text === "connect")
        ) {
          report(node, `calls .${node.expression.name.text}`);
        }
      }
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        networkConstructors.has(node.expression.text)
      ) {
        report(node, `constructs ${node.expression.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return findings.toSorted();
}

test("catalog import graph cannot reach the fetch layer", async () => {
  const graph = await staticImportGraph(catalogEntry);
  const paths = [...graph]
    .map((file) => relative(sourceRoot, file).replaceAll("\\", "/"))
    .toSorted();

  expect(paths).toContain("catalog.ts");
  expect(paths).toContain("sources/sec.urls.ts");
  expect(paths).toContain("sources/fixedfeeds.urls.ts");
  expect(paths).not.toContain("http.ts");
  expect(paths.filter((path) => path.startsWith("sources/") && !path.endsWith(".urls.ts"))).toEqual(
    [],
  );
  expect(await findNetworkPrimitives(graph)).toEqual([]);
});
