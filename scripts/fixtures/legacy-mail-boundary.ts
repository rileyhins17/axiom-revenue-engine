import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { legacyClientMailFixture } from "./legacy-client-mail";
import * as legacyHistory from "../../src/lib/revenue-engine/legacy-mail-history";

export function legacyBoundary(f: ReturnType<typeof legacyClientMailFixture>, kind: "page" | "client" | "list" | "detail", owner = "owner") {
  const page = kind === "page";
  const path = kind === "page" ? "src/app/clients/[id]/page.tsx" : kind === "client" ? "src/app/api/clients/[id]/route.ts" : kind === "list" ? "src/app/api/outreach/emails/route.ts" : "src/app/api/outreach/emails/[id]/route.ts";
  const source = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: { default?: (context: unknown) => Promise<{ props: Record<string, unknown> }>; GET?: (request: Request, context: unknown) => Promise<Response> } = {};
  const session = { user: { id: owner, role: owner === "member" ? "user" : "admin" }, session: { id: `${owner}-session` } };
  runInNewContext(source, { exports, Response, require(name: string) {
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "next/server") return { NextResponse: Response };
    if (name === "next/navigation") return { notFound() { throw new Error("NOT_FOUND"); } };
    if (name === "@/components/ClientProfile") return { ClientProfile: () => null };
    if (name === "@/lib/session") return {
      requireSession: async () => session, requireApiSession: async () => ({ session }),
      requireAdminSession: async () => { if (owner === "member") throw new Error("ADMIN_DENIED"); return session; },
      requireAdminApiSession: async () => owner === "member" ? { response: new Response(null, { status: 403 }) } : { session },
    };
    if (name === "@/lib/cloudflare") return { getDatabase: () => f.database };
    if (name === "@/lib/prisma") return { getPrisma: () => f.prisma };
    if (name === "@/lib/revenue-engine/legacy-mail-history") return legacyHistory;
    assert.fail("Unexpected client history authority: " + name);
  } }, { timeout: 1000 });
  return async (lead = "1") => page ? (await exports.default!({ params: Promise.resolve({ id: lead }) })).props
    : exports.GET!(new Request(`https://example.invalid/api/clients/${lead}`), { params: Promise.resolve({ id: lead }) });
}
