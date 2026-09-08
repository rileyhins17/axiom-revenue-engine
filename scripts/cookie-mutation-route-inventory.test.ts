import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import ts from "typescript";

// Exact service authorities, never a prefix-based cookie-security exemption.
const services = new Map([
  ["agent/jobs/claim/route.ts", "requireAgentAuth"],
  ["agent/jobs/[id]/complete/route.ts", "requireAgentAuth"],
  ["agent/jobs/[id]/failed/route.ts", "requireAgentAuth"],
  ["agent/jobs/[id]/heartbeat/route.ts", "requireAgentAuth"],
  ["agent/jobs/[id]/logs/route.ts", "requireAgentAuth"],
  ["agent/jobs/[id]/results/route.ts", "requireAgentAuth"],
]);

const retired = new Set(["mcp/route.ts", "internal/cron-tick/route.ts"]);

test("every custom unsafe API export starts with the shared cookie or exact service boundary", () => {
  const root = join(process.cwd(), "src/app/api");
  const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name))
      : entry.name === "route.ts" ? [join(directory, entry.name)] : []);
  let guarded = 0;
  const observed = new Set<string>();
  for (const path of files(root)) {
    const name = relative(root, path).replaceAll("\\", "/");
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    if (retired.has(name)) {
      // This is not an authentication exemption: prove the entire module is
      // only seven fixed no-authority responses and its single pure import.
      assert.equal(source.statements.length, 8, name);
      const imported = source.statements[0];
      assert(ts.isImportDeclaration(imported) && ts.isStringLiteral(imported.moduleSpecifier), name);
      assert.equal(imported.moduleSpecifier.text, "@/lib/retired-legacy-control", name);
      const methods: string[] = [];
      for (const node of source.statements.slice(1)) {
        assert(ts.isFunctionDeclaration(node) && node.name && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword), name);
        assert.equal(node.parameters.length, 0, name);
        assert.equal(node.body?.getText(source), "{ return retiredLegacyControlResponse(); }", name);
        methods.push(node.name.text);
      }
      assert.deepEqual(methods.sort(), ["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"].sort(), name);
      continue;
    }
    for (const node of source.statements) {
      // Do not silently overlook aliases or export-const handlers in a new route.
      if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) assert.fail(`Review API export form: ${name}`);
      if (ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const declaration of node.declarationList.declarations) {
          assert(!/^(POST|PUT|PATCH|DELETE)$/.test(declaration.name.getText(source)), `Review API handler form: ${name}`);
        }
      }
      if (!ts.isFunctionDeclaration(node) || !node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
        || !/^(POST|PUT|PATCH|DELETE)$/.test(node.name?.text ?? "")) continue;
      if (name === "auth/[...all]/route.ts") {
        assert.match(node.body?.getText(source) ?? "", /return createHandlers\(\)\.(POST|PATCH|PUT|DELETE)\(request\)/);
        continue;
      }
      const first = node.body?.statements[0];
      assert(first && ts.isVariableStatement(first), `Missing initial auth boundary: ${name}`);
      const expression = first.declarationList.declarations[0]?.initializer;
      assert(expression && ts.isAwaitExpression(expression) || expression && ts.isCallExpression(expression), name);
      const call = ts.isAwaitExpression(expression) ? expression.expression : expression;
      assert(ts.isCallExpression(call) && ts.isIdentifier(call.expression), name);
      const expected = services.get(name);
      assert(expected ? call.expression.text === expected : ["requireApiSession", "requireAdminApiSession"].includes(call.expression.text), name);
      assert.equal(call.arguments[0]?.getText(source), "request", name);
      if (expected) observed.add(name); else {
        const result = first.declarationList.declarations[0]!.name.getText(source);
        const denial = node.body?.statements[1]?.getText(source) ?? "";
        assert(denial.includes(`if ("response" in ${result})`) && denial.includes(`return ${result}.response;`),
          `The initial boundary denial must return before other work: ${name}`);
        const imported = source.statements.some(statement => ts.isImportDeclaration(statement)
          && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "@/lib/session"
          && statement.importClause?.namedBindings?.getText(source).includes(call.expression.getText(source)));
        assert(imported, `Use the shared session boundary: ${name}`);
        guarded++;
      }
    }
  }
  assert.deepEqual([...observed].sort(), [...services.keys()].sort());
  assert.equal(guarded, 21, "Review the inventory when a custom mutation is added or removed.");
});
