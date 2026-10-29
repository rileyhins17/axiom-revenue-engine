import { createHash } from "node:crypto";

import { z } from "zod";

import {
  PrivateKwPublicHttpTransportReceiptSchema,
  privateKwPublicHttpTransportReceiptDigest,
  type PrivateKwPublicHttpTransport,
} from "@/lib/revenue-engine/private-kw-public-http-transport";
import { normalizePublicWebsiteUrl } from "@/lib/revenue-engine/public-website-url";

export const PRIVATE_KW_SOURCE_POLICY_VERSION = "kw-m2-source-policy-v1";
export const PRIVATE_KW_SOURCE_POLICY_MAX_ROBOTS_BYTES = 128 * 1024;
export const PRIVATE_KW_SOURCE_POLICY_MAX_REDIRECTS = 3;

export const PrivateKwSourcePolicyDecisionSchema = z.object({
  policyVersion: z.literal(PRIVATE_KW_SOURCE_POLICY_VERSION),
  robotsUrl: z.string().url(),
  httpStatus: z.number().int().nullable(),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  matchedGroup: z.string().nullable(),
  matchedRule: z.string().nullable(),
  allowed: z.boolean(),
  crawlDelaySeconds: z.number().nonnegative().nullable(),
  nextAllowedAt: z.string().datetime({ offset: true }).nullable(),
  termsDecision: z.string(),
  reason: z.string().min(1),
  transportReceiptIds: z.array(z.number().int().positive()),
  transportReceiptDigests: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
  networkRequestCount: z.number().int().nonnegative(),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

export type PrivateKwSourcePolicyDecision = z.infer<typeof PrivateKwSourcePolicyDecisionSchema>;

export type PrivateKwRobotsPolicyInput = {
  approvedSourceUrl: string;
  auditUserAgent: string;
  termsDecision: "PUBLIC_REVIEW_ONLY" | "TERMS_REVIEWED_FOR_FACTS" | "UNKNOWN" | string;
  transport: PrivateKwPublicHttpTransport;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  policyDeadlineAt?: Date;
  maxRobotsBytes?: number;
  maxRedirects?: number;
};

type Rule = { kind: "allow" | "disallow"; path: string; source: string };
type Group = { agents: string[]; rules: Rule[]; crawlDelay: number | null };

async function boundedText(response: Response, maxBytes: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) throw new Error("robots body too large");
      chunks.push(next.value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
  } catch (error) {
    await reader.cancel("robots_body_limit").catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let sawDirective = false;
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.length > 8192) throw new Error("robots line too long");
    const line = rawLine.split("#", 1)[0]!.trim();
    if (!line) { current = null; continue; }
    const separator = line.indexOf(":");
    if (separator <= 0) throw new Error("robots directive malformed");
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (!value) throw new Error("robots user-agent empty");
      if (!current || current.rules.length > 0 || current.crawlDelay !== null) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      sawDirective = true;
    } else if (key === "allow" || key === "disallow") {
      if (!current) throw new Error("robots rule without user-agent");
      if (value) current.rules.push({ kind: key, path: value, source: `${key[0]!.toUpperCase()}${key.slice(1)}: ${value}` });
      sawDirective = true;
    } else if (key === "crawl-delay") {
      if (!current || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error("robots crawl-delay malformed");
      const delay = Number(value);
      if (!Number.isFinite(delay) || delay > 3600) throw new Error("robots crawl-delay out of range");
      if (current.crawlDelay !== null) throw new Error("robots crawl-delay duplicated");
      current.crawlDelay = delay;
      sawDirective = true;
    } else {
      throw new Error("robots directive unsupported");
    }
  }
  if (!sawDirective) throw new Error("robots file has no directives");
  return groups;
}

function chooseGroup(groups: Group[], agent: string) {
  const normalized = agent.toLowerCase();
  const exact = groups.filter((group) => group.agents.some((entry) => entry === normalized || normalized.startsWith(`${entry}/`)));
  if (exact.length > 0) return { groups: exact, name: normalized };
  const wildcard = groups.filter((group) => group.agents.includes("*"));
  return wildcard.length > 0 ? { groups: wildcard, name: "*" } : { groups: [], name: null };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function evaluatePrivateKwRobotsPolicy(input: PrivateKwRobotsPolicyInput): Promise<PrivateKwSourcePolicyDecision> {
  if (input.maxRobotsBytes !== undefined && (!Number.isSafeInteger(input.maxRobotsBytes) || input.maxRobotsBytes <= 0 || input.maxRobotsBytes > PRIVATE_KW_SOURCE_POLICY_MAX_ROBOTS_BYTES)) {
    throw new Error("maxRobotsBytes is outside the bounded policy limit");
  }
  if (input.maxRedirects !== undefined && (!Number.isSafeInteger(input.maxRedirects) || input.maxRedirects < 0 || input.maxRedirects > PRIVATE_KW_SOURCE_POLICY_MAX_REDIRECTS)) {
    throw new Error("maxRedirects is outside the bounded policy limit");
  }
  const approved = normalizePublicWebsiteUrl(input.approvedSourceUrl);
  const origin = new URL(approved);
  const robotsUrl = new URL("/robots.txt", origin).toString();
  const now = input.now ?? (() => new Date());
  const maxBytes = input.maxRobotsBytes ?? PRIVATE_KW_SOURCE_POLICY_MAX_ROBOTS_BYTES;
  const maxRedirects = input.maxRedirects ?? PRIVATE_KW_SOURCE_POLICY_MAX_REDIRECTS;
  let current = robotsUrl;
  let response: Response | null = null;
  const receiptIds: number[] = [];
  let redirectCount = 0;
  let httpStatus: number | null = null;
  let contentDigest: string | null = null;
  let matchedGroup: string | null = null;
  let matchedRule: string | null = null;
  let crawlDelaySeconds: number | null = null;
  let reason = "robots unavailable";
  try {
    for (;;) {
      const currentUrl = normalizePublicWebsiteUrl(current);
      if (new URL(currentUrl).hostname !== origin.hostname) {
        reason = "robots redirect host does not match approved source";
        break;
      }
      response = await input.transport.request(currentUrl, { method: "GET", redirect: "manual", credentials: "omit", headers: { Accept: "text/plain", "User-Agent": input.auditUserAgent } });
      const receipt = input.transport.takeReceipts().at(-1);
      if (receipt) receiptIds.push(receipt.requestId);
      httpStatus = response.status;
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirectCount >= maxRedirects) { reason = "robots redirect is missing or exceeds the limit"; break; }
        current = new URL(location, currentUrl).toString();
        redirectCount += 1;
        continue;
      }
      if (response.status < 200 || response.status >= 300) { reason = "robots response unavailable"; break; }
      const text = await boundedText(response, maxBytes);
      contentDigest = digest(text);
      const groups = parseRobots(text);
      const selected = chooseGroup(groups, input.auditUserAgent);
      matchedGroup = selected.name;
      const path = new URL(approved).pathname || "/";
      const rules = selected.groups.flatMap((group) => group.rules).filter((rule) => rule.path === "" || path.startsWith(rule.path));
      rules.sort((left, right) => right.path.length - left.path.length || (left.kind === "allow" ? -1 : 1));
      const winning = rules[0];
      matchedRule = winning?.source ?? null;
      const delayValues = selected.groups.map((group) => group.crawlDelay).filter((delay): delay is number => delay !== null);
      if (delayValues.length > 1) throw new Error("robots crawl-delay conflicts across matching groups");
      crawlDelaySeconds = delayValues[0] ?? null;
      const nextAllowedAt = crawlDelaySeconds === null ? null : new Date(now().getTime() + crawlDelaySeconds * 1000).toISOString();
      const robotsAllowed = !winning || winning.kind === "allow";
      const termsAllowed = input.termsDecision === "TERMS_REVIEWED_FOR_FACTS" || input.termsDecision === "PUBLIC_REVIEW_ONLY";
      reason = !robotsAllowed ? "robots disallows the approved source path" : !termsAllowed ? "terms decision is missing or ambiguous" : "robots allows crawl; terms decision reviewed";
      if (robotsAllowed && termsAllowed && crawlDelaySeconds !== null && crawlDelaySeconds > 0) {
        if (!input.sleep) throw new Error("robots crawl-delay requires a bounded sleep dependency");
        const sleepMs = crawlDelaySeconds * 1000;
        if (input.policyDeadlineAt && now().getTime() + sleepMs > input.policyDeadlineAt.getTime()) throw new Error("robots crawl-delay exceeds policy deadline");
        await input.sleep(sleepMs);
      }
      const receiptDigests = receiptDigestsFor(input.transport, receiptIds);
      return PrivateKwSourcePolicyDecisionSchema.parse({ policyVersion: PRIVATE_KW_SOURCE_POLICY_VERSION, robotsUrl, httpStatus, contentDigest, matchedGroup, matchedRule, allowed: robotsAllowed && termsAllowed, crawlDelaySeconds, nextAllowedAt, termsDecision: input.termsDecision, reason, transportReceiptIds: receiptIds, transportReceiptDigests: receiptDigests, networkRequestCount: receiptIds.length, providerOperationsAuthorized: 0, costAuthorizedUsd: 0 });
    }
  } catch (error) {
    reason = error instanceof Error && error.message ? error.message : "robots response malformed or unavailable";
  }
  const termsAllowed = input.termsDecision === "TERMS_REVIEWED_FOR_FACTS" || input.termsDecision === "PUBLIC_REVIEW_ONLY";
  const receiptDigests = receiptDigestsFor(input.transport, receiptIds);
  return PrivateKwSourcePolicyDecisionSchema.parse({ policyVersion: PRIVATE_KW_SOURCE_POLICY_VERSION, robotsUrl, httpStatus, contentDigest, matchedGroup, matchedRule, allowed: false, crawlDelaySeconds, nextAllowedAt: null, termsDecision: input.termsDecision, reason: termsAllowed ? reason : "terms decision is missing or ambiguous", transportReceiptIds: receiptIds, transportReceiptDigests: receiptDigests, networkRequestCount: receiptIds.length, providerOperationsAuthorized: 0, costAuthorizedUsd: 0 });
}

function receiptDigestsFor(transport: PrivateKwPublicHttpTransport, receiptIds: readonly number[]) {
  return transport.takeReceipts().filter((entry) => receiptIds.includes(entry.requestId)).map((entry) => {
    const parsed = PrivateKwPublicHttpTransportReceiptSchema.parse(entry);
    const expected = privateKwPublicHttpTransportReceiptDigest(parsed);
    if (parsed.receiptDigest !== expected) throw new Error("transport receipt digest mismatch");
    return parsed.receiptDigest;
  });
}
