/**
 * A filer's public RMD listing, read right before an email says anything about it.
 *
 * Every FCC email claims the listing "doesn't show" or "still shows no" 2026
 * recertification. The engine never looked: the hand-run scans found 8 of 3,404
 * contacts recertified between Nov 1 and Nov 3, 2026, and 24 earlier ones had to
 * be suppressed by hand. This module reads the same public page the scans read
 * (the portal's page API, no login) so the sender can stop a contact whose listing
 * now shows a recertification, and never claim what is no longer true.
 *
 * `parseFccFilingStatus` is pure and tested. `fccFilingStatusFromPortal` does the
 * two requests the portal needs (a landing page for the session cookie and the
 * `g_ck` token, then the page API) and is only ever exercised against the live
 * portal.
 */

export type FccFilingStatus = {
  /** "2026-11-01" style, or null when the listing shows no recertification date. */
  lastRecertified: string | null;
  /** The portal's `enable_recertify` flag (true when the Recertify button shows), or null when the page doesn't carry it. */
  recertifyOpen: boolean | null;
};

/** Reads one listing. Resolves null when the page can't be read or parsed; never throws. */
export type FccFilingStatusReader = (filingUrl: string) => Promise<FccFilingStatus | null>;

export const FCC_PORTAL = "https://fccprod.servicenowservices.com";
const PAGE_API = `${FCC_PORTAL}/api/now/sp/page?id=rmd_form&table=x_g_fmc_rmd_robocall_mitigation_database&view=sp&sys_id=`;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/** The 32-hex `sys_id` in a filing URL, or null. */
export function fccSysId(filingUrl: string | null | undefined) {
  return /sys_id=([0-9a-f]{32})/i.exec(filingUrl ?? "")?.[1]?.toLowerCase() ?? null;
}

/** True when `status` shows a recertification in `day`'s year or later (`day` is "YYYY-MM-DD"). */
export function fccRecertifiedBy(status: FccFilingStatus | null, day: string) {
  const year = Number(day.slice(0, 4));
  const recertYear = Number((status?.lastRecertified ?? "").slice(0, 4));
  return Number.isFinite(recertYear) && recertYear >= year;
}

/**
 * The listing's status from the portal's page JSON: the first `record` object that
 * carries `last_recertified`. Null when no such record is in the document.
 */
export function parseFccFilingStatus(doc: unknown): FccFilingStatus | null {
  let found: FccFilingStatus | null = null;
  const walk = (node: unknown, depth: number) => {
    if (found || depth > 40 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1); return; }
    const record = (node as { record?: unknown }).record;
    if (record && typeof record === "object" && !Array.isArray(record) && "last_recertified" in record) {
      const r = record as Record<string, unknown>;
      const last = typeof r.last_recertified === "string" ? r.last_recertified.trim() : "";
      const open = r.enable_recertify;
      found = {
        lastRecertified: last || null,
        recertifyOpen: open === true || open === "true" ? true : open === false || open === "false" ? false : null,
      };
      return;
    }
    for (const value of Object.values(node as Record<string, unknown>)) walk(value, depth + 1);
  };
  walk(doc, 0);
  return found;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * A reader against the live portal. The session (cookie and token) is fetched once,
 * on the first listing, and reused for the rest of this reader's life, so one tick
 * costs one landing request plus one request per listing. Any failure resolves null.
 */
export function fccFilingStatusFromPortal(fetchImpl: FetchLike = (input, init) => fetch(input, init), timeoutMs = 20_000): FccFilingStatusReader {
  let session: Promise<{ cookie: string; token: string } | null> | null = null;
  const withTimeout = (init?: RequestInit) => ({ ...init, signal: AbortSignal.timeout(timeoutMs) });
  const openSession = async () => {
    try {
      const response = await fetchImpl(`${FCC_PORTAL}/rmd?id=rmd_landing`, withTimeout({ headers: { "User-Agent": USER_AGENT } }));
      const headers = response.headers as Headers & { getSetCookie?: () => string[] };
      const setCookies = headers.getSetCookie?.() ?? (headers.get("set-cookie") ? [headers.get("set-cookie")!] : []);
      const cookie = setCookies.map((line) => line.split(";")[0]!.trim()).filter(Boolean).join("; ");
      const html = await response.text();
      const token = /g_ck\s*=\s*['"]([^'"]+)['"]/.exec(html)?.[1] ?? "";
      return { cookie, token };
    } catch {
      return null;
    }
  };
  return async (filingUrl) => {
    const sysId = fccSysId(filingUrl);
    if (!sysId) return null;
    session ??= openSession();
    const live = await session;
    if (!live) { session = null; return null; }
    try {
      const response = await fetchImpl(PAGE_API + sysId, withTimeout({
        headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...(live.cookie ? { Cookie: live.cookie } : {}), ...(live.token ? { "X-UserToken": live.token } : {}) },
      }));
      if (!response.ok) return null;
      return parseFccFilingStatus(await response.json());
    } catch {
      return null;
    }
  };
}
