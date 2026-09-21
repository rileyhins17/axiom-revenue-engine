import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type ClientRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

import { z } from "zod";

import { normalizePublicWebsiteUrl } from "@/lib/revenue-engine/public-website-url";

export const PRIVATE_KW_PUBLIC_TRANSPORT_VERSION = "kw-m2-public-transport-v1";

export type PublicDnsAnswer = { address: string; family: 4 | 6 };
export type PublicDnsResolver = (hostname: string) => Promise<readonly PublicDnsAnswer[]>;

export type BoundPublicRequest = {
  url: string;
  protocol: "http:" | "https:";
  hostname: string;
  port: 80 | 443;
  path: string;
  method: "GET";
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
  address: string;
  family: 4 | 6;
  servername: string;
  agent: false;
};

export type PublicConnectionResponse = {
  statusCode: number;
  headers: Readonly<Record<string, string | readonly string[]>>;
  body: ReadableStream<Uint8Array>;
  abort: () => void;
};

export type PublicConnectionExecutor = (request: BoundPublicRequest) => Promise<PublicConnectionResponse>;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const BIG_SIXTEEN = BigInt(16);
const BIG_THIRTY_TWO = BigInt(32);
const BIG_FFFF = BigInt(0xffff);
export const PrivateKwPublicHttpTransportReceiptSchema = z.object({
  transportVersion: z.literal(PRIVATE_KW_PUBLIC_TRANSPORT_VERSION),
  requestId: z.number().int().positive(),
  normalizedUrl: z.string().url(),
  method: z.literal("GET"),
  hostname: z.string().min(1),
  selectedAddress: z.string().optional(),
  selectedFamily: z.union([z.literal(4), z.literal(6)]).optional(),
  addressClass: z.string(),
  statusCode: z.number().int().optional(),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  socketOpened: z.boolean(),
  networkRequestCount: z.literal(1),
  errorCode: z.string().optional(),
  acceptedAddressesDigest: Sha256Schema.optional(),
}).strict();

export type PrivateKwPublicHttpTransportReceipt = z.infer<typeof PrivateKwPublicHttpTransportReceiptSchema>;

export type PrivateKwPublicHttpTransportOptions = {
  resolveDns?: PublicDnsResolver;
  executeConnection?: PublicConnectionExecutor;
  now?: () => Date;
};

export class PrivateKwPublicHttpTransportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PrivateKwPublicHttpTransportError";
    this.code = code;
  }
}

type Classified = { address: string; family: 4 | 6; classification: string };

function ipv4Number(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  if (octets.some((part) => part > 255)) return null;
  return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
}

function inV4(value: number, start: number, prefix: number) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (start & mask);
}

function parseIpv6(value: string): bigint | null {
  if (value.includes("%")) return null;
  const lower = value.toLowerCase();
  if (lower.includes(".")) {
    const split = lower.lastIndexOf(":");
    if (split < 0) return null;
    const v4 = ipv4Number(lower.slice(split + 1));
    if (v4 === null) return null;
    const high = ((v4 / 0x10000) & 0xffff).toString(16);
    const low = (v4 & 0xffff).toString(16);
    return parseIpv6(`${lower.slice(0, split)}:${high}:${low}`);
  }
  const halves = lower.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const total = left.length + right.length;
  if ((halves.length === 1 && total !== 8) || (halves.length === 2 && total >= 8)) return null;
  const parts = [...left, ...(halves.length === 2 ? Array(8 - total).fill("0") : []), ...right].map((part) => parseInt(part, 16));
  return parts.reduce((result, part) => (result << BIG_SIXTEEN) | BigInt(part), BIG_ZERO);
}

function inV6(value: bigint, start: bigint, prefix: number) {
  if (prefix === 0) return true;
  const mask = ((BIG_ONE << BigInt(prefix)) - BIG_ONE) << BigInt(128 - prefix);
  return (value & mask) === (start & mask);
}

function classifyV4(value: number) {
  if (inV4(value, 0, 8)) return "UNSPECIFIED";
  if (inV4(value, 0x0a000000, 8) || inV4(value, 0xac100000, 12) || inV4(value, 0xc0a80000, 16)) return "PRIVATE";
  if (inV4(value, 0x64400000, 10)) return "RESERVED";
  if (inV4(value, 0x7f000000, 8)) return "LOOPBACK";
  if (inV4(value, 0xa9fe0000, 16)) return "LINK_LOCAL";
  if (inV4(value, 0xc0000000, 24) || inV4(value, 0xc0000200, 24) || inV4(value, 0xc0586300, 24)) return "RESERVED";
  if (inV4(value, 0xc6120000, 15)) return "BENCHMARK";
  if (inV4(value, 0xc6336400, 24) || inV4(value, 0xcb007100, 24)) return "DOCUMENTATION";
  if (inV4(value, 0xe0000000, 4)) return "MULTICAST";
  if (inV4(value, 0xf0000000, 4)) return "RESERVED";
  return "PUBLIC";
}

function classifyV6(value: bigint): string {
  if (value === BIG_ZERO) return "UNSPECIFIED";
  if (value === BIG_ONE) return "LOOPBACK";
  if ((value >> BIG_THIRTY_TWO) === BIG_FFFF) return classifyV4(Number(value & BigInt(0xffffffff)));
  if (inV6(value, parseIpv6("fc00::")!, 7)) return "PRIVATE";
  if (inV6(value, parseIpv6("fe80::")!, 10)) return "LINK_LOCAL";
  if (inV6(value, parseIpv6("ff00::")!, 8)) return "MULTICAST";
  if (inV6(value, parseIpv6("2001:db8::")!, 32)) return "DOCUMENTATION";
  if (inV6(value, parseIpv6("2001:2::")!, 48)) return "BENCHMARK";
  if (inV6(value, parseIpv6("2001:10::")!, 28) || inV6(value, parseIpv6("2001::")!, 32)) return "RESERVED";
  if (inV6(value, parseIpv6("2002::")!, 16)) return "RESERVED";
  return "PUBLIC";
}

export function classifyPublicAddress(address: string, family: 4 | 6): string {
  if (address.includes("%")) return "INVALID";
  const detected = isIP(address);
  if (detected !== family) return "INVALID";
  if (family === 4) {
    const parsed = ipv4Number(address);
    return parsed === null ? "INVALID" : classifyV4(parsed);
  }
  const parsed = parseIpv6(address);
  return parsed === null ? "INVALID" : classifyV6(parsed);
}

function canonicalAddress(address: string, family: 4 | 6) {
  if (family === 4) return address;
  const parsed = parseIpv6(address);
  if (parsed === null) return address.toLowerCase();
  const groups: string[] = [];
  for (let index = 7; index >= 0; index -= 1) groups.push(((parsed >> BigInt(index * 16)) & BIG_FFFF).toString(16));
  let bestStart = -1; let bestLength = 0;
  for (let index = 0; index < 8;) {
    if (groups[index] !== "0") { index += 1; continue; }
    const start = index;
    while (index < 8 && groups[index] === "0") index += 1;
    if (index - start > bestLength) { bestStart = start; bestLength = index - start; }
  }
  if (bestLength < 2) return groups.join(":");
  const left = groups.slice(0, bestStart).join(":");
  const right = groups.slice(bestStart + bestLength).join(":");
  if (!left) return `::${right}`;
  if (!right) return `${left}::`;
  return `${left}::${right}`;
}

function classifyAnswers(answers: readonly PublicDnsAnswer[]): { selected: Classified; digestInput: string } {
  if (answers.length === 0) throw new PrivateKwPublicHttpTransportError("DNS_EMPTY", "DNS returned no addresses.");
  const unique = new Map<string, Classified>();
  for (const answer of answers) {
    if (!answer || (answer.family !== 4 && answer.family !== 6)) throw new PrivateKwPublicHttpTransportError("DNS_INVALID", "DNS returned an invalid family.");
    const normalized = canonicalAddress(answer.address, answer.family);
    const classification = classifyPublicAddress(normalized, answer.family);
    if (classification === "INVALID") throw new PrivateKwPublicHttpTransportError("DNS_INVALID", "DNS returned an invalid address.");
    unique.set(`${answer.family}:${normalized}`, { address: normalized, family: answer.family, classification });
  }
  const all = [...unique.values()].sort((a, b) => a.family - b.family || a.address.localeCompare(b.address));
  if (all.some((answer) => answer.classification !== "PUBLIC")) throw new PrivateKwPublicHttpTransportError("DNS_NON_PUBLIC", "DNS returned a non-public address.");
  return { selected: all[0]!, digestInput: all.map((answer) => `${answer.family}:${answer.address}`).join("|") };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function defaultResolver(hostname: string) {
  return dnsLookup(hostname, { all: true, verbatim: true }).then((answers) => answers.map((answer) => ({ address: answer.address, family: answer.family as 4 | 6 })));
}

function safeHeaders(headers: Readonly<Record<string, string | readonly string[]>>) {
  const output = new Headers();
  for (const name of ["content-type", "content-length", "location", "retry-after"]) {
    const value = headers[name] ?? headers[name.toLowerCase()];
    if (typeof value === "string") output.set(name, value);
    else if (Array.isArray(value)) output.set(name, value.join(", "));
  }
  return output;
}

function nativeExecutor(request: BoundPublicRequest): Promise<PublicConnectionResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const options = {
      protocol: request.protocol,
      hostname: request.address,
      port: request.port,
      path: request.path,
      method: request.method,
      headers: request.headers,
      family: request.family,
      agent: false as const,
      ...(request.protocol === "https:" ? { servername: request.servername } : {}),
    };
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error); } };
    const makeRequest = request.protocol === "https:" ? httpsRequest : httpRequest;
    const nativeRequest: ClientRequest = makeRequest(options, (incoming) => {
      const body = Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>;
      const abort = () => incoming.destroy();
      resolve({ statusCode: incoming.statusCode ?? 0, headers: incoming.headers as Record<string, string | readonly string[]>, body, abort });
    });
    nativeRequest.once("error", fail);
    const abort = () => { nativeRequest.destroy(); };
    if (request.signal.aborted) abort();
    else request.signal.addEventListener("abort", abort, { once: true });
    nativeRequest.end();
  });
}

function requestDetails(input: string | URL | Request, init?: RequestInit) {
  const effectiveInit = typeof input === "string" || input instanceof URL
    ? { ...init, redirect: init?.redirect ?? "manual", credentials: init?.credentials ?? "omit" }
    : init;
  const source = typeof input === "string" || input instanceof URL ? new Request(input.toString(), effectiveInit) : new Request(input, effectiveInit);
  const url = normalizePublicWebsiteUrl(source.url);
  if (source.method !== "GET") throw new PrivateKwPublicHttpTransportError("METHOD_NOT_ALLOWED", "Only GET is allowed.");
  if (source.redirect !== "manual") throw new PrivateKwPublicHttpTransportError("REDIRECT_NOT_MANUAL", "Redirects must be handled manually.");
  if (source.credentials !== "omit") throw new PrivateKwPublicHttpTransportError("CREDENTIALS_NOT_ALLOWED", "Credentials are not allowed.");
  if (source.body !== null) throw new PrivateKwPublicHttpTransportError("BODY_NOT_ALLOWED", "Request bodies are not allowed.");
  for (const [name] of source.headers) {
    const lower = name.toLowerCase();
    if (lower === "host" || lower === "authorization" || lower === "cookie" || lower === "proxy-authorization" || lower === "proxy-connection" || lower === "forwarded" || lower.startsWith("x-forwarded-")) {
      throw new PrivateKwPublicHttpTransportError("HEADER_NOT_ALLOWED", `Header ${name} is not allowed.`);
    }
    if (!["accept", "accept-language", "user-agent"].includes(lower)) throw new PrivateKwPublicHttpTransportError("HEADER_NOT_ALLOWED", `Header ${name} is not allowed.`);
  }
  const parsed = new URL(url);
  const headers: Record<string, string> = { Host: parsed.host, Connection: "close" };
  for (const [name, value] of source.headers) headers[name] = value;
  return { source, parsed, headers };
}

export function createPrivateKwPublicHttpTransport(options: PrivateKwPublicHttpTransportOptions = {}) {
  const resolveDns = options.resolveDns ?? defaultResolver;
  const executeConnection = options.executeConnection ?? nativeExecutor;
  const now = options.now ?? (() => new Date());
  const receipts: PrivateKwPublicHttpTransportReceipt[] = [];
  let requestId = 0;
  return {
    async request(input: string | URL | Request, init?: RequestInit): Promise<Response> {
      const started = now();
      const id = ++requestId;
      let normalizedUrl = "https://invalid.invalid/";
      let hostname = "unknown.invalid";
      let selected: Classified | undefined;
      let acceptedAddressesDigest: string | undefined;
      let socketOpened = false;
      let addressClass = "UNKNOWN";
      let statusCode: number | undefined;
      let errorCode: string | undefined;
      try {
        const details = requestDetails(input, init);
        normalizedUrl = details.parsed.toString();
        hostname = details.parsed.hostname;
        const answers = await resolveDns(hostname);
        const classified = classifyAnswers(answers);
        selected = classified.selected;
        acceptedAddressesDigest = digest(classified.digestInput);
        addressClass = selected.classification;
        const path = `${details.parsed.pathname}${details.parsed.search}` || "/";
        const response = await executeConnection({
          url: normalizedUrl,
          protocol: details.parsed.protocol as "http:" | "https:",
          hostname,
          port: details.parsed.protocol === "http:" ? 80 : 443,
          path,
          method: "GET",
          headers: details.headers,
          signal: details.source.signal,
          address: selected.address,
          family: selected.family,
          servername: hostname,
          agent: false,
        });
        socketOpened = true;
        statusCode = response.statusCode;
        return new Response(response.body, { status: response.statusCode, headers: safeHeaders(response.headers) });
      } catch (error) {
        errorCode = error instanceof PrivateKwPublicHttpTransportError ? error.code : "NETWORK_ERROR";
        throw error;
      } finally {
        const completed = now();
        receipts.push(PrivateKwPublicHttpTransportReceiptSchema.parse({
          transportVersion: PRIVATE_KW_PUBLIC_TRANSPORT_VERSION,
          requestId: id,
          normalizedUrl,
          method: "GET",
          hostname,
          ...(selected ? { selectedAddress: selected.address, selectedFamily: selected.family } : {}),
          addressClass,
          ...(statusCode === undefined ? {} : { statusCode }),
          startedAt: started.toISOString(), completedAt: completed.toISOString(), socketOpened,
          networkRequestCount: 1,
          ...(errorCode ? { errorCode } : {}),
          ...(acceptedAddressesDigest ? { acceptedAddressesDigest } : {}),
        }));
      }
    },
    takeReceipts() {
      return receipts.slice();
    },
  };
}

export type PrivateKwPublicHttpTransport = ReturnType<typeof createPrivateKwPublicHttpTransport>;
