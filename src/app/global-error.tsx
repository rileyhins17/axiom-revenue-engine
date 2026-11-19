"use client";

import { useEffect, useState } from "react";

/**
 * Last-resort screen when the app's frame itself fails (the root layout). It replaces Next's
 * "This page couldn't load" card, tries once more by itself, and then offers a reload.
 * It renders its own page, so it can't use the app's styles: the two appearances are written out here.
 */
const COLOURS = `:root{color-scheme:light dark;--ge-ground:#f5f4ef;--ge-ink:#202c26;--ge-muted:#5c584f;--ge-line:#d8d1c2;--ge-button:#fffdf8;--ge-faint:#8a857a}`
  + `@media (prefers-color-scheme:dark){:root{--ge-ground:#141311;--ge-ink:#f5f0e6;--ge-muted:#aba497;--ge-line:#6b6252;--ge-button:#1d1b17;--ge-faint:#9d968a}}`;

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [autoRetried, setAutoRetried] = useState(false);

  useEffect(() => {
    console.error(error);
    if (autoRetried) return;
    const timer = setTimeout(() => { setAutoRetried(true); retry(); }, 1500);
    return () => clearTimeout(timer);
  }, [error, retry, autoRetried]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--ge-ground)", color: "var(--ge-ink)", font: "15px/1.5 Inter, Segoe UI, Arial, sans-serif" }}>
        <title>Axiom</title>
        <style>{COLOURS}</style>
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          {autoRetried ? <>
            <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>This screen didn&apos;t load.</h1>
            <p style={{ margin: "0 0 16px", color: "var(--ge-muted)" }}>FCC emails keep sending on their own; this only affects the screen.</p>
            <button type="button" onClick={() => window.location.reload()}
              style={{ font: "inherit", fontWeight: 600, padding: "8px 16px", borderRadius: 8, border: "1px solid var(--ge-line)", background: "var(--ge-button)", cursor: "pointer" }}>
              Reload
            </button>
            {error.digest ? <p style={{ marginTop: 16, fontSize: 12, color: "var(--ge-faint)" }}>Code {error.digest}</p> : null}
          </> : <p>Loading again…</p>}
        </main>
      </body>
    </html>
  );
}
