import { randomBytes } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertPrivateKwM2ApprovalChain, PrivateKwM2ExecutionAuthorizationSchema,
  PrivateKwM2OwnerApprovalEnvelopeSchema, PrivateKwM2ResearchPacketSchema,
  PrivateKwM2ResearchPolicySchema,
} from "../src/lib/revenue-engine/private-kw-m2-authorization";
import { PrivateKwImportPlanSchema } from "../src/lib/revenue-engine/private-kw-import";
import { PrivateKwShadowSliceManifestSchema } from "../src/lib/revenue-engine/private-kw-shadow-slice";
import {
  executePrivateKwM2HtmlEvidence, reloadPrivateKwM2WebsiteEvidenceReceipt,
  PrivateKwM2HtmlEvidenceRequestSchema, type PrivateKwM2HtmlEvidenceDependencies,
} from "../src/lib/revenue-engine/private-kw-m2-html-evidence-workflow";
import { createPrivateKwPublicHttpTransport } from "../src/lib/revenue-engine/private-kw-public-http-transport";
import { readPrivateKwJson } from "./private-kw-files";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const MAX_REQUEST_BYTES = 5 * 1024 * 1024;
export const PRIVATE_KW_M2_HTML_CAPTURE_LOCK_PATH = path.join(ROOT, "data", "kw-evaluation", ".m2-html-capture.lock");

type Mode = "PREFLIGHT" | "EXECUTE" | "VERIFY";
type Parsed = { mode: Mode; requestPath: string };
type CaptureOptions = { clock?: () => Date; dependencies?: PrivateKwM2HtmlEvidenceDependencies };

function parseArgs(args: string[]): Parsed {
  if (args.length < 1 || args.length > 2) throw new Error("Usage: <request.json> [--execute | --verify]");
  const requestPath = args[0]!;
  const flag = args[1];
  if (flag !== undefined && flag !== "--execute" && flag !== "--verify") throw new Error("Unknown capture mode.");
  return { requestPath, mode: flag === "--execute" ? "EXECUTE" : flag === "--verify" ? "VERIFY" : "PREFLIGHT" };
}

async function withCaptureLock<T>(action: () => Promise<T>): Promise<T> {
  let handle;
  try {
    handle = await open(PRIVATE_KW_M2_HTML_CAPTURE_LOCK_PATH, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Another M2 HTML capture is already running.");
    throw error;
  }
  let held: BigIntStats | undefined;
  try {
    held = await handle.stat({ bigint: true });
    await handle.writeFile(`${process.pid}:${randomBytes(32).toString("hex")}\n`, "utf8");
    await handle.sync();
    return await action();
  } finally {
    try {
      if (held) {
        const current = await lstat(PRIVATE_KW_M2_HTML_CAPTURE_LOCK_PATH, { bigint: true });
        if (!current.isFile() || current.isSymbolicLink() || current.dev !== held.dev || current.ino !== held.ino) {
          throw new Error("M2 HTML capture lock was replaced; replacement retained.");
        }
        await unlink(PRIVATE_KW_M2_HTML_CAPTURE_LOCK_PATH);
      }
    } finally {
      await handle.close();
    }
  }
}

async function loadRequest(requestPath: string) {
  const loaded = await readPrivateKwJson(requestPath, MAX_REQUEST_BYTES);
  return PrivateKwM2HtmlEvidenceRequestSchema.parse(loaded.value);
}

function validateRequest(request: ReturnType<typeof PrivateKwM2HtmlEvidenceRequestSchema.parse>, now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error("M2 capture clock must be valid.");
  const researchPacket = PrivateKwM2ResearchPacketSchema.parse(request.researchPacket);
  const authorization = PrivateKwM2ExecutionAuthorizationSchema.parse(request.authorization);
  const ownerEnvelope = PrivateKwM2OwnerApprovalEnvelopeSchema.parse(request.ownerEnvelope);
  const manifest = PrivateKwShadowSliceManifestSchema.parse(request.manifest);
  const sourcePlan = PrivateKwImportPlanSchema.parse(request.sourcePlan);
  if (request.researchPolicy === undefined) throw new Error("M2 request must include its exact research policy.");
  const researchPolicy = PrivateKwM2ResearchPolicySchema.parse(request.researchPolicy);
  const record = manifest.records.find((entry) => entry.businessId === request.businessId);
  const source = sourcePlan.records.find((entry) => entry.business.id === request.businessId);
  const policy = researchPolicy.decisions.find((entry) => entry.businessId === request.businessId);
  if (!record || !source || !source.sourceRecord.websiteUrl || !record.websiteUrl) throw new Error("Selected business has no approved website URL.");
  if (!policy || Date.parse(policy.retentionReviewDate) < now.getTime()) throw new Error("Selected business retention review is missing or expired.");
  const requestTime = Date.parse(request.requestedAt);
  if (!Number.isFinite(requestTime) || requestTime > now.getTime()) throw new Error("M2 request time must be valid and not in the future.");
  if (ownerEnvelope.status === "PENDING") {
    assertPrivateKwM2ApprovalChain({ researchPacket, authorization, ownerEnvelope, manifest, sourcePlan, researchPolicy, phase: "PREPARE", now: now.toISOString() });
  } else {
    assertPrivateKwM2ApprovalChain({ researchPacket, authorization, ownerEnvelope, manifest, sourcePlan, researchPolicy, phase: "GET", now: now.toISOString() });
  }
  return { researchPacket, authorization, ownerEnvelope, manifest, sourcePlan, researchPolicy };
}

function summary(mode: Mode, status: string, request: ReturnType<typeof PrivateKwM2HtmlEvidenceRequestSchema.parse>, extra: Record<string, unknown> = {}) {
  return { mode, status, businessId: request.businessId, operationId: extra.operationId ?? null,
    currentRequestCount: extra.currentRequestCount ?? 0, recordedNetworkRequestCount: extra.recordedNetworkRequestCount ?? 0,
    providerOperations: 0, costAuthorizedUsd: 0, ...extra,
    limitations: ["HTML_ONLY", "VISUAL_UNKNOWN", "CONTACT_DATA_DISCARDED", "NO_QUALIFICATION_OR_OUTREACH_AUTHORITY"] };
}

export async function capturePrivateKwM2Html(args: string[], options: CaptureOptions = {}) {
  const parsed = parseArgs(args);
  const clock = options.clock ?? (() => new Date());
  const request = await loadRequest(parsed.requestPath);
  const chain = validateRequest(request, clock());
  if (parsed.mode === "PREFLIGHT") {
    return summary(parsed.mode, chain.ownerEnvelope.status === "APPROVED" ? "READY_FOR_CAPTURE" : "OWNER_APPROVAL_REQUIRED", request);
  }
  if (parsed.mode === "VERIFY") {
    const receipt = await reloadPrivateKwM2WebsiteEvidenceReceipt({ request, receiptStore: options.dependencies?.receiptStore, evidenceStore: options.dependencies?.store }, { clock });
    return summary(parsed.mode, receipt.status, request, { operationId: receipt.operationId, currentRequestCount: 0, recordedNetworkRequestCount: receipt.networkRequestCount, receiptStatus: receipt.status, stopReason: receipt.stopReason });
  }
  if (chain.ownerEnvelope.status !== "APPROVED") throw new Error("Capture requires a current APPROVED owner envelope.");
  if (request.replayMode !== "NEW") throw new Error("--execute requires request replayMode NEW.");
  const { receipt, currentRequestCount } = await withCaptureLock(async () => {
    validateRequest(request, clock());
    const transport = options.dependencies?.transport ?? createPrivateKwPublicHttpTransport({ now: clock });
    const before = transport.takeReceipts().length;
    const receipt = await executePrivateKwM2HtmlEvidence(request, { ...options.dependencies, transport, clock });
    return { receipt, currentRequestCount: transport.takeReceipts().length - before };
  });
  return summary(parsed.mode, receipt.status, request, { operationId: receipt.operationId, currentRequestCount, recordedNetworkRequestCount: receipt.networkRequestCount, receiptStatus: receipt.status, stopReason: receipt.stopReason });
}

export async function runCapturePrivateKwM2HtmlCli(
  args: string[],
  options: CaptureOptions = {},
  output = {
    stdout: (value: string) => { process.stdout.write(value); },
    stderr: (value: string) => { process.stderr.write(value); },
  },
) {
  try {
    const result = await capturePrivateKwM2Html(args, options);
    output.stdout(JSON.stringify(result) + "\n");
    return result.status === "FAILED" ? 1 : 0;
  } catch (error: unknown) {
    output.stderr(JSON.stringify({ status: "BLOCKED", error: error instanceof Error ? error.message : String(error) }) + "\n");
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runCapturePrivateKwM2HtmlCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
