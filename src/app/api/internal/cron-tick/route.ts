import { NextResponse } from "next/server";

import { runAutomationScheduler } from "@/lib/outreach-automation";
import { runCloudScrapeWorker } from "@/lib/cloud-scrape-worker";
import { runAutonomousIntake } from "@/lib/autonomous-intake";
import { runAutoPipeline } from "@/lib/auto-pipeline";
import { getServerEnv } from "@/lib/env";

/**
 * Internal cron-tick endpoint. The Cloudflare Workers cron handler is capped at
 * 30s CPU per invocation; on a busy database that cap is reached before any
 * sends fire. By moving the actual work into an HTTP route the cron handler can
 * trigger via env.WORKER_SELF_REFERENCE.fetch (a service-binding fetch), each
 * trigger runs in its own fetch invocation with its own 30s CPU budget. The
 * cron handler itself only does the fetch dispatch — nearly zero CPU.
 *
 * Auth: shared internal secret (MCP_API_TOKEN). Same token the MCP server uses.
 */
export async function POST(request: Request) {
  const env = getServerEnv();
  const expected = (env as { MCP_API_TOKEN?: string }).MCP_API_TOKEN || "";
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const task = url.searchParams.get("task") || "scheduler";

  try {
    const startedAt = Date.now();
    let result: unknown;
    switch (task) {
      case "scheduler":
        result = await runAutomationScheduler();
        break;
      case "pipeline":
        result = await runAutoPipeline("system");
        break;
      case "intake":
        result = await runAutonomousIntake();
        break;
      case "scrape":
        result = await runCloudScrapeWorker();
        break;
      default:
        return NextResponse.json({ error: `unknown task ${task}` }, { status: 400 });
    }
    return NextResponse.json({ ok: true, task, durationMs: Date.now() - startedAt, result });
  } catch (error: unknown) {
    console.error(`[cron-tick:${task}] failed:`, error);
    return NextResponse.json(
      { ok: false, task, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
