"use client";

import { CheckCircle2, ExternalLink, Star, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";

/**
 * What a founder can do with one reply: open it in Gmail (a link only: the engine never changes mail), mark it
 * answered, and mark it as one that counts toward its campaign's success number. Both marks can be taken back.
 */
export function ReplyActions({ id, kind, answered, success, successLabel, gmailUrl, canMark }: {
  id: string; kind: "reply" | "automatic" | "no_thanks"; answered: boolean; success: boolean; successLabel: string; gmailUrl: string | null; canMark: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mark = async (body: { answered?: boolean; success?: boolean }) => {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/replies/mark", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...body }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not save.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const person = kind === "reply";
  return <div className="space-y-2">
    <div className="owner-reply-actions">
      {gmailUrl ? <a href={gmailUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "lg" })}><ExternalLink aria-hidden="true" />Open in Gmail</a> : null}
      {canMark && person && !answered ? <Button type="button" size="lg" disabled={busy} onClick={() => void mark({ answered: true })}><CheckCircle2 aria-hidden="true" />Mark answered</Button> : null}
      {canMark && person && answered ? <Button type="button" variant="ghost" size="lg" disabled={busy} onClick={() => void mark({ answered: false })}><Undo2 aria-hidden="true" />Not answered after all</Button> : null}
      {canMark && person ? <Button type="button" variant="outline" size="lg" disabled={busy} aria-pressed={success} onClick={() => void mark({ success: !success })}>
        <Star aria-hidden="true" className={success ? "fill-current" : undefined} />{success ? `Counted in ${successLabel.toLowerCase()}: undo` : `Count it in ${successLabel.toLowerCase()}`}
      </Button> : null}
    </div>
    {error ? <p role="alert" className="text-sm font-medium" style={{ color: "var(--owner-danger)" }}>{error}</p> : null}
  </div>;
}
