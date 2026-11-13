"use client";

import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Plug, Smartphone, UserRound } from "lucide-react";

import { Badge, Notice, Panel } from "@/components/owner/kit";
import { useProfilePicture } from "@/components/profile-picture";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AVATAR_CHANGED_EVENT } from "@/hooks/use-avatar-upload";

type UserProfile = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string | null;
};

export function SettingsAccount({ userProfile }: { userProfile: UserProfile }) {
  const [image, setImage] = useState(userProfile.image);
  const picture = useProfilePicture();
  useEffect(() => {
    const onChanged = (event: Event) => setImage((event as CustomEvent<string>).detail || null);
    window.addEventListener(AVATAR_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(AVATAR_CHANGED_EVENT, onChanged);
  }, []);
  const initial = (userProfile.email || userProfile.name || "?").charAt(0);

  return (
    <Panel title="Your account" icon={UserRound}>
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-[#efe9dc] pb-4">
        <Avatar src={image} fallback={initial} size="xl" className="owner-avatar" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={picture.uploading} onClick={picture.choose}>
            {picture.uploading ? "Saving…" : "Change profile picture"}
          </Button>
          {image ? (
            <Button type="button" variant="ghost" size="sm" disabled={picture.uploading} onClick={() => void picture.remove()}>
              Remove
            </Button>
          ) : null}
        </div>
        {picture.input}
        {picture.error ? <p role="alert" className="w-full text-sm text-[#a1231b]">{picture.error}</p> : null}
      </div>
      <dl aria-label="Your account" className="divide-y divide-[#efe9dc]">
        <AccountRow label="Name" value={userProfile.name || "Name not set"} />
        <AccountRow label="Email" value={userProfile.email} />
        <AccountRow label="Access" value={userProfile.role ?? "user"} capitalize />
      </dl>
      <a href="/install" className="mt-4 flex items-center gap-2 border-t border-[#efe9dc] pt-4 text-sm font-semibold text-[#8a6420] hover:underline">
        <Smartphone className="size-4" aria-hidden="true" />
        Put the app on your iPhone home screen
      </a>
    </Panel>
  );
}

function AccountRow({ label, value, capitalize = false }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 py-3 text-sm first:pt-0 last:pb-0">
      <dt className="text-[#5c584f]">{label}</dt>
      <dd className={`break-all font-medium text-[#0a0a0a] ${capitalize ? "capitalize" : ""}`}>{value}</dd>
    </div>
  );
}

type KeyKind = "header" | "link";
type KeyStatus = { exists: boolean; lastFour: string | null; createdAt: string | null; lastUsedAt: string | null };
type Keys = Record<KeyKind, KeyStatus>;
type KeysAnswer = { keys?: Keys; key?: string; error?: string };

const KEY_KINDS: Array<{ kind: KeyKind; title: string; about: string; make: string; makeNew: string; replaceWarning: string; offWarning: string }> = [
  {
    kind: "header", title: "Key for Claude Code", about: "For Claude Code on your computer. It goes in the command below.",
    make: "Make a key", makeNew: "Make a new key", replaceWarning: "Make a new key? The old one stops working at once.", offWarning: "Turn this key off? Claude Code stops reaching the engine until you make a new one.",
  },
  {
    kind: "link", title: "Link for claude.ai", about: "For the Claude app and claude.ai, which take a link instead of a key.",
    make: "Make a link", makeNew: "Make a new link", replaceWarning: "Make a new link? The old one stops working at once.", offWarning: "Turn this link off? claude.ai stops reaching the engine until you make a new one.",
  },
];
const LOAD_FAILED = "Could not load your connector keys. Reload the page to try again.";

const torontoTime = (iso: string | null) => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null
    : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
};

// A time ends in "p.m.", which already closes its sentence.
const sentence = (text: string) => (text.endsWith(".") ? text : `${text}.`);

const codeBox = "block w-full select-all break-all rounded-xl border border-[var(--owner-line)] bg-[var(--owner-paper)] px-3 py-2.5 font-mono text-[13px] leading-relaxed text-[var(--owner-ink)]";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => void copy()}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/**
 * Settings, Claude connector: the signed-in founder's two keys for the engine's MCP server (/api/mcp). A key is
 * shown once, when it is made; after that only its last four characters.
 */
export function SettingsConnector({ founder, baseUrl }: { founder: string | null; baseUrl: string }) {
  const [keys, setKeys] = useState<Keys | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<KeyKind | null>(null);
  const [made, setMade] = useState<{ kind: KeyKind; key: string } | null>(null);

  useEffect(() => {
    if (!founder) return;
    let left = false;
    fetch("/api/connector/keys", { credentials: "same-origin" })
      .then(async (response) => ({ ok: response.ok, data: (await response.json().catch(() => ({}))) as KeysAnswer }))
      .then(({ ok, data }) => {
        if (left) return;
        if (ok && data.keys) setKeys(data.keys);
        else setError(data.error ?? LOAD_FAILED);
      })
      .catch(() => { if (!left) setError(LOAD_FAILED); });
    return () => { left = true; };
  }, [founder]);

  const change = async (kind: KeyKind, method: "POST" | "DELETE") => {
    setBusy(kind); setError(null);
    try {
      const response = await fetch("/api/connector/keys", { method, credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }) });
      const data = (await response.json().catch(() => ({}))) as KeysAnswer;
      if (!response.ok || !data.keys) throw new Error(data.error ?? "Could not save. Try again.");
      setKeys(data.keys);
      const key = method === "POST" ? data.key : undefined;
      setMade((current) => (key ? { kind, key } : current?.kind === kind ? null : current));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const address = `${baseUrl}/api/mcp`;
  const command = (key: string) => `claude mcp add --transport http axiom-engine ${address} --header "Authorization: Bearer ${key}"`;
  const newHeaderKey = made?.kind === "header" ? made.key : null;

  return (
    <Panel title="Claude connector" icon={Plug}
      description="Lets your own Claude read the engine and do a few safe things: pause a campaign, check or load a list, send you a test, mark a reply answered. It can't approve a batch or resume a campaign: those stay on the screen.">
      {!founder ? <p className="text-sm">Only Riley or Aidan can have a connector key.</p> : (
        <div className="space-y-5">
          {error ? <Notice tone="danger" role="alert">{error}</Notice> : null}
          <ul className="owner-list">
            {KEY_KINDS.map((item) => {
              const status = keys?.[item.kind];
              const shown = made?.kind === item.kind ? (item.kind === "link" ? `${address}/k/${made.key}` : made.key) : null;
              const madeAt = torontoTime(status?.createdAt ?? null);
              const usedAt = torontoTime(status?.lastUsedAt ?? null);
              return (
                <li key={item.kind} className="space-y-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--owner-ink)]"><KeyRound className="size-4 text-[var(--owner-gold-deep)]" aria-hidden="true" />{item.title}</h3>
                    {status ? <Badge tone={status.exists ? "success" : "neutral"}>{status.exists ? "On" : "None yet"}</Badge> : null}
                  </div>
                  <p className="owner-meta">
                    {!status ? (error ? "Not loaded." : "Loading…")
                      : status.exists ? [`Ends in ${status.lastFour ?? "····"}`, `Made ${madeAt ?? "earlier"}`, usedAt ? `Last used ${usedAt}` : "Not used yet"].map(sentence).join(" ")
                        : item.about}
                  </p>
                  {shown ? (
                    <Notice tone="warning" icon={KeyRound} title="Copy it now. It won't be shown again." role="status">
                      <div className="mt-2 space-y-2">
                        <code className={codeBox}>{shown}</code>
                        <CopyButton text={shown} label={item.kind === "link" ? "Copy the link address" : "Copy the key"} />
                        <p>Anyone with this {item.kind === "link" ? "link" : "key"} can read the engine&rsquo;s data and pause a campaign. Keep it private. If it gets out, make a new one: the old one stops working at once.</p>
                      </div>
                    </Notice>
                  ) : null}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button type="button" variant={status?.exists ? "outline" : "default"} disabled={!status || busy !== null} className="w-full sm:w-auto"
                      onClick={() => { if (!status?.exists || window.confirm(item.replaceWarning)) void change(item.kind, "POST"); }}>
                      {busy === item.kind ? "Saving…" : status?.exists ? item.makeNew : item.make}
                    </Button>
                    {status?.exists ? (
                      <Button type="button" variant="ghost" disabled={busy !== null} className="w-full text-[var(--owner-danger)] sm:w-auto"
                        onClick={() => { if (window.confirm(item.offWarning)) void change(item.kind, "DELETE"); }}>
                        Turn off
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="space-y-4 border-t border-[var(--owner-line)] pt-4 text-sm text-[var(--owner-ink)]">
            <div className="space-y-2">
              <p><span className="font-semibold">Claude Code.</span> Run this once on your computer{newHeaderKey ? ", exactly as it is:" : ", with your key in place of <key>:"}</p>
              <code className={codeBox}>{command(newHeaderKey ?? "<key>")}</code>
              {newHeaderKey ? <CopyButton text={command(newHeaderKey)} label="Copy the command" /> : null}
            </div>
            <p><span className="font-semibold">claude.ai and the Claude app.</span> Open Settings, then Connectors, then Add custom connector, and paste your link address.</p>
            <p className="owner-meta">Every call your Claude makes is logged with your name. Times here are Toronto time.</p>
          </div>
        </div>
      )}
    </Panel>
  );
}
