"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

import { Notice, OwnerPage } from "@/components/owner/kit";
import { Button } from "@/components/ui/button";

/** After a release, an open tab can ask for code that no longer exists; only a full reload fixes that. */
function isStaleCode(error: Error) {
  return error.name === "ChunkLoadError" || /Loading chunk|dynamically imported module|Importing a module script failed/i.test(error.message);
}

/**
 * Replaces Next's "This page couldn't load" card. Most failures are a moment's hiccup, so the
 * screen tries again by itself once after a second and a half; only a second failure is shown.
 */
export default function ScreenError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [autoRetried, setAutoRetried] = useState(false);

  useEffect(() => {
    console.error(error);
    if (isStaleCode(error)) {
      // At most one reload a minute, so a real outage can't loop.
      let last = 0;
      try { last = Number(sessionStorage.getItem("axiom-stale-reload") ?? 0); sessionStorage.setItem("axiom-stale-reload", String(Date.now())); } catch { /* private mode */ }
      if (Date.now() - last > 60_000) { window.location.reload(); return; }
    }
    if (autoRetried) return;
    const timer = setTimeout(() => { setAutoRetried(true); retry(); }, 1500);
    return () => clearTimeout(timer);
  }, [error, retry, autoRetried]);

  return <OwnerPage>
    {autoRetried
      ? <Notice tone="warning" icon={AlertTriangle} title="This screen didn't load." role="alert"
        action={<div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => retry()}><RotateCw aria-hidden="true" />Try again</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => window.location.reload()}>Reload</Button>
        </div>}>
        It tried twice. FCC emails keep sending on their own; this only affects the screen.
        {error.digest ? <span className="owner-meta mt-1 block">Code {error.digest}</span> : null}
      </Notice>
      : <Notice tone="info" icon={RotateCw} title="Loading again…" role="status">That took a moment longer than usual.</Notice>}
  </OwnerPage>;
}
