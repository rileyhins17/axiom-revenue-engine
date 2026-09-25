"use client";

import { Check, Copy, Headset, KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Token = { id: string; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" }) : "never";

/** Connect the Axiom Caller extension: create a personal token, shown once. */
export function CallerConnect() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => fetch("/api/caller/tokens", { credentials: "same-origin" })
    .then((response) => response.ok ? response.json() as Promise<{ tokens: Token[] }> : null)
    .then((body) => { if (body) setTokens(body.tokens); })
    .catch(() => undefined), []);
  useEffect(() => { void load(); }, [load]);

  async function post(body: unknown) {
    setError(null);
    const response = await fetch("/api/caller/tokens", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (!response?.ok) { setError("Couldn't save. Try again."); return null; }
    return response.json() as Promise<{ token?: string }>;
  }

  return <section id="caller" className="rounded-2xl border border-slate-200 bg-white p-5">
    <h2 className="flex items-center gap-2 font-semibold"><Headset className="size-4" aria-hidden="true" />Axiom Caller extension</h2>
    <p className="mt-1 text-sm text-slate-600">Connect your Axiom Caller workspace. Results save locally first, then sync here under your account.</p>
    <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-700">
      <li>Create a key below and copy it (it&apos;s only shown once).</li>
      <li>In the extension, expand <b>Revenue Engine &amp; Orbit</b>, choose Revenue Engine, and paste the key.</li>
      <li>Check the displayed operator and workspace, then open a business with <b>Open Caller</b> or its call button.</li>
    </ol>
    {fresh ? <div className="owner-pop mt-4 rounded-xl border border-[#e6d6b3] bg-[#fbf3e2] p-3">
      <p className="text-xs font-semibold text-[#5c4210]">Your new key (copy it now)</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1.5 text-xs ring-1 ring-[#efe2c6]">{fresh}</code>
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(fresh); setCopied(true); } catch { setError('Copy failed. Select and copy the key manually.'); } }} className="owner-press inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium">
          {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}{copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div> : null}
    <button type="button" onClick={async () => { const result = await post({ action: "create", label: "Axiom Caller" }); if (result?.token) { setFresh(result.token); setCopied(false); void load(); } }}
      className="owner-cta mt-4 inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold"><KeyRound className="size-4" aria-hidden="true" />Create extension key</button>
    {error ? <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p> : null}
    {tokens.length ? <ul className="mt-4 divide-y divide-slate-100 text-sm">{tokens.map((token) => <li key={token.id} className="flex items-center justify-between gap-3 py-2">
      <span><span className="font-medium">{token.label}</span> <span className="text-slate-600">· made {day(token.createdAt)} · last used {day(token.lastUsedAt)}</span></span>
      {token.revokedAt ? <span className="text-xs text-slate-600">Revoked</span>
        : <button type="button" onClick={async () => { await post({ action: "revoke", id: token.id }); void load(); }} className="text-xs font-medium text-rose-700 hover:underline">Revoke</button>}
    </li>)}</ul> : null}
  </section>;
}
