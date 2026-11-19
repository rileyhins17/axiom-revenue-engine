/**
 * Does an email domain take mail? (Aidan, Nov 5: city emails must not bounce.) Read through Cloudflare's
 * DNS over HTTPS, so the same check runs on a PC (`scripts/outreach.ts`) and in the Worker (loading a list
 * from the screen). A domain with no mail server (no MX record, a "null MX" that says it takes no mail, or a
 * domain that doesn't exist) is held when the list is loaded, with the reason.
 *
 * A lookup that can't be made after three tries stops the load instead of guessing: nothing is loaded and
 * the person loading is told to try again.
 */
export const DOH_URL = "https://cloudflare-dns.com/dns-query";

/**
 * The most domains one load from the screen checks. The Worker may make 50 outside requests per request
 * on the free plan; this leaves room for retries.
 */
export const SCREEN_DOMAIN_LIMIT = 40;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export type MailServerCheck = {
  /** Domain to the reason its rows are held ("has no mail server"). */
  noMailServer: Map<string, string>;
  /** Domains that couldn't be looked up: the load stops. */
  unreadable: string[];
};

type DohAnswer = { Status?: number; Answer?: Array<{ type?: number; data?: string }> };

/** The domain of an address, lowercased ("" when there is none). */
export const emailDomain = (email: string) => {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).trim().toLowerCase();
};

async function lookUp(domain: string, fetchImpl: Fetch, tries: number): Promise<string | null | "unreadable"> {
  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const response = await fetchImpl(`${DOH_URL}?name=${encodeURIComponent(domain)}&type=MX`, { headers: { accept: "application/dns-json" } });
      if (!response.ok) continue;
      const answer = (await response.json()) as DohAnswer;
      lastStatus = answer.Status;
      if (answer.Status === 3) return "doesn't exist";
      if (answer.Status !== 0) continue;
      const hosts = (answer.Answer ?? []).filter((record) => record.type === 15)
        .map((record) => String(record.data ?? "").trim().split(/\s+/)[1] ?? "");
      if (hosts.some((host) => host && host !== ".")) return null;
      return hosts.length ? "takes no mail (null MX)" : "has no mail server";
    } catch {
      // network trouble: try again
    }
  }
  // The DNS itself kept answering with an error: mail to it would fail too, so the rows are held.
  if (lastStatus !== undefined && lastStatus !== 0) return "has no working mail server (DNS error)";
  return "unreadable";
}

/** Looks up every domain once, a few at a time. */
export async function checkMailServers(domains: Iterable<string>, options: { fetch?: Fetch; tries?: number; concurrency?: number } = {}): Promise<MailServerCheck> {
  const fetchImpl = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const tries = Math.max(1, options.tries ?? 3);
  const queue = [...new Set([...domains].map((domain) => domain.trim().toLowerCase()).filter(Boolean))].sort();
  const noMailServer = new Map<string, string>();
  const unreadable: string[] = [];
  const worker = async () => {
    for (let domain = queue.shift(); domain !== undefined; domain = queue.shift()) {
      const result = await lookUp(domain, fetchImpl, tries);
      if (result === "unreadable") unreadable.push(domain);
      else if (result) noMailServer.set(domain, result);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 4, queue.length)) }, worker));
  return { noMailServer, unreadable: unreadable.sort() };
}
