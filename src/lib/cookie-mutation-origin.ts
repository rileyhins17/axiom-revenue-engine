import { getCloudflareBindings } from "./cloudflare";

function configuredOrigin(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid origin configuration");
  const text = value.trim();
  const url = new URL(text);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash || text.includes("*")
    || (text !== url.origin && text !== `${url.origin}/`)) {
    throw new Error("Invalid origin configuration");
  }
  return url.origin;
}

/** No cached environment, host-derived trust, wildcard, or bearer bypass. */
export function cookieMutationOriginStatus(request: Request): 403 | 503 | null {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;

  let allowed: Set<string>;
  try {
    const bindings = getCloudflareBindings();
    const config = bindings ?? process.env;
    allowed = new Set([configuredOrigin(config.APP_BASE_URL)]);
    const extra = config.AUTH_ALLOWED_ORIGINS;
    if (extra !== undefined && extra !== "") {
      if (typeof extra !== "string") return 503;
      for (const value of extra.split(",")) allowed.add(configuredOrigin(value));
    }
  } catch { return 503; }

  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  // Missing Fetch Metadata is supported only with an exact valid Origin.
  // This preserves older clients; an absent/null Origin is never accepted.
  if (!origin || !allowed.has(origin) || (site !== null && site !== "same-origin")) return 403;
  // NextURL normalizes loopback addresses to localhost, and reverse proxies
  // may use an internal URL. Host only constrains an ALREADY configured Origin;
  // it never adds trust. Do not accept client-supplied forwarding headers.
  const targetHost = request.headers.get("host") ?? new URL(request.url).host;
  if (new URL(origin).host !== targetHost) return 403;
  return null;
}
