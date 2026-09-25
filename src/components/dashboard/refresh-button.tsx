"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";

function formatLastUpdated(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function RefreshButton() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const refreshData = useCallback(() => {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => {
      setLastUpdated(formatLastUpdated(new Date()));
      setRefreshing(false);
    }, 1500);
  }, [router]);

  // Server-rendered data is "current as of" the page load.
  useEffect(() => {
    // Queue the state update so it doesn't fire synchronously inside the effect,
    // which the lint rule flags as a cascading-render risk.
    const handle = window.requestAnimationFrame(() => {
      setLastUpdated(formatLastUpdated(new Date()));
    });
    return () => window.cancelAnimationFrame(handle);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshData();
      }
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [refreshData]);

  return (
    <div className="flex items-center gap-2">
      {lastUpdated ? (
        <span className="hidden text-[11px] text-[#52645a] sm:inline" aria-live="polite">
          Last updated <span className="font-mono text-[#43584b]">{lastUpdated}</span>
        </span>
      ) : null}
      <button
        type="button"
        disabled={refreshing}
        aria-label={refreshing ? "Refreshing data" : "Refresh data"}
        title="Re-run all dashboard queries"
        onClick={refreshData}
        className="v2-focus-ring inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#dce5dd] bg-white px-3 py-1.5 text-[11px] font-medium text-[#43584b] transition hover:border-[#bad1c3] hover:bg-[#f4f8f4] disabled:opacity-50 cursor-pointer"
      >
        {refreshing ? (
          <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCwIcon className="size-3" aria-hidden="true" />
        )}
        Refresh
      </button>
    </div>
  );
}
