"use client";

import { useEffect, useState } from "react";

/**
 * Last-resort screen when the app's frame itself fails (the root layout). It replaces Next's
 * "This page couldn't load" card, tries once more by itself, and then offers a reload.
 * It renders its own page, so it can't use the app's styles.
 */
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
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f4ef", color: "#202c26", font: "15px/1.5 Inter, Segoe UI, Arial, sans-serif" }}>
        <title>Axiom</title>
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          {autoRetried ? <>
            <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>This screen didn&apos;t load.</h1>
            <p style={{ margin: "0 0 16px", color: "#5c584f" }}>FCC emails keep sending on their own; this only affects the screen.</p>
            <button type="button" onClick={() => window.location.reload()}
              style={{ font: "inherit", fontWeight: 600, padding: "8px 16px", borderRadius: 8, border: "1px solid #d8d1c2", background: "#fffdf8", cursor: "pointer" }}>
              Reload
            </button>
            {error.digest ? <p style={{ marginTop: 16, fontSize: 12, color: "#8a857a" }}>Code {error.digest}</p> : null}
          </> : <p>Loading again…</p>}
        </main>
      </body>
    </html>
  );
}
