export const PUBLIC_WEBSITE_MAX_URL_LENGTH = 2_048;

export type PublicWebsiteUrlErrorCode = "INVALID_URL" | "BLOCKED_URL";

export class PublicWebsiteUrlError extends Error {
  readonly code: PublicWebsiteUrlErrorCode;

  constructor(code: PublicWebsiteUrlErrorCode, message: string) {
    super(message);
    this.name = "PublicWebsiteUrlError";
    this.code = code;
  }
}

const BLOCKED_HOST_SUFFIXES = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "lan",
  "home",
  "home.arpa",
  "corp",
  "test",
  "example",
  "invalid",
  "onion",
  "arpa",
];

function invalid(message: string): never {
  throw new PublicWebsiteUrlError("INVALID_URL", message);
}

function blocked(message: string): never {
  throw new PublicWebsiteUrlError("BLOCKED_URL", message);
}

function isIpv4Literal(hostname: string) {
  const parts = hostname.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part));
}

function isBlockedHostname(hostname: string) {
  return BLOCKED_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
}

function validateHostname(hostname: string) {
  if (!hostname || hostname.length > 253) invalid("The website hostname is invalid.");

  // Business websites must use DNS names. Rejecting every IP literal is stricter
  // than attempting to keep a changing list of private and reserved IP ranges.
  if (hostname.startsWith("[") || hostname.includes(":") || isIpv4Literal(hostname)) {
    blocked("IP-address website targets are not allowed.");
  }

  if (isBlockedHostname(hostname)) {
    blocked("Local, internal, and reserved website hostnames are not allowed.");
  }

  const labels = hostname.split(".");
  if (labels.length < 2) blocked("Single-label website hostnames are not public targets.");
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    invalid("The website hostname is invalid.");
  }
}

/**
 * Convert a source-supplied website value into one canonical public HTTP(S)
 * target. The result is safe to persist, but every redirect must still pass
 * through this function before it is fetched.
 */
export function normalizePublicWebsiteUrl(value: string) {
  const raw = value.trim();
  if (!raw || raw.length > PUBLIC_WEBSITE_MAX_URL_LENGTH) {
    invalid("The website URL is empty or too long.");
  }
  if (/[\\\u0000-\u0020\u007f]/.test(raw)) {
    invalid("The website URL contains forbidden whitespace or control characters.");
  }

  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    invalid("The website URL could not be parsed.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    blocked("Only HTTP and HTTPS website targets are allowed.");
  }
  if (url.username || url.password) {
    blocked("Website URLs containing credentials are not allowed.");
  }
  if (
    (url.protocol === "http:" && url.port && url.port !== "80") ||
    (url.protocol === "https:" && url.port && url.port !== "443")
  ) {
    blocked("Only the standard HTTP and HTTPS ports are allowed.");
  }

  const hostname = url.hostname.toLocaleLowerCase("en-CA").replace(/\.+$/, "");
  validateHostname(hostname);
  url.hostname = hostname;
  url.hash = "";

  return url.toString();
}
