import type { ProspectDb } from "./engine-prospects-d1";
import { classifyEngineLead, ENGINE_LEAD_RULES_VERSION, type EngineLeadDecision } from "./engine-lead-rules";
import { ENGINE_SITE_CAPTURE_VERSION, type EngineSiteCapture } from "./engine-site-capture";
import { torontoMidnight } from "../prospect-format";

/**
 * Cloud website check for businesses that list a website (DiscoveryHeld).
 *
 * Runs on Cloudflare's browser (the axiom-site-check Worker), never on anyone's
 * computer. Each homepage is opened once at desktop and once at phone size and graded
 * with the same deterministic rules the local weekly run used. Weak websites (STRONG
 * leads) and working ones (WEAK) join EngineProspect with their reasons, exactly as the
 * local publish step did; not-a-target sites (WRONG) are recorded but not added. A site
 * that will not load is retried on later runs, then marked FAILED. Page text stays in
 * memory; only the label, reasons, final URL and versions are stored.
 */
export const SITE_CHECK_VERSION = `cloud-site-check-v1+${ENGINE_SITE_CAPTURE_VERSION}+${ENGINE_LEAD_RULES_VERSION}`;
/** Per run (every 10 minutes during the day) and per day: about 25 browser-minutes a day, inside the included hours. */
export const SITE_CHECKS_PER_RUN = 6;
export const SITE_CHECKS_PER_DAY = 120;
export const SITE_CHECK_MAX_ATTEMPTS = 3;

export type SiteCheckBusiness = { businessId: string; businessName: string; niche: string; websiteUrl: string };
export type SiteCapture = (business: SiteCheckBusiness) => Promise<EngineSiteCapture>;
/** checked = sites graded; failed = attempts that did not load (each counts toward the daily cap); gaveUp = sites now marked FAILED. */
export type SiteCheckResult = { runId: string; checked: number; strong: number; weak: number; wrong: number; failed: number; gaveUp: number; stopReason: string | null };

type Held = { placeId: string; name: string; city: string; niche: string; websiteUrl: string; phone: string | null; address: string | null; attempts: number };
type Changes = { changes?: number; meta?: { changes?: number } };
const changed = (result: unknown) => ((result as Changes).meta?.changes ?? (result as Changes).changes ?? 0) === 1;
const hostKey = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, "");
/** The address the site actually answered on, keeping http: so "not secure" stays visible. */
const siteOrigin = (url: string) => {
  try { const parsed = new URL(url); return ["http:", "https:"].includes(parsed.protocol) ? `${parsed.protocol}//${parsed.hostname.toLowerCase()}/` : null; }
  catch { return null; }
};
const EMAIL = /^[^\s@']+@[^\s@']+\.[a-z]{2,24}$/;

export async function runSiteChecks(db: ProspectDb, options: {
  /** Opened only when there is work, so an idle run never starts a browser. */
  openCapture: () => Promise<{ capture: SiteCapture; close: () => Promise<void> }>;
  now?: Date; perRun?: number; perDay?: number; newId?: () => string;
}): Promise<SiteCheckResult> {
  const now = options.now ?? new Date();
  const runId = `site-${now.toISOString().replace(/[:.]/g, "-")}-${(options.newId?.() ?? crypto.randomUUID()).slice(0, 8)}`;
  const result: SiteCheckResult = { runId, checked: 0, strong: 0, weak: 0, wrong: 0, failed: 0, gaveUp: 0, stopReason: null };
  await db.prepare(`INSERT INTO "SiteCheckRun" ("runId","startedAt") VALUES (?,?)`).bind(runId, now.toISOString()).run();
  const finish = async (stopReason: string | null) => {
    result.stopReason = stopReason;
    await db.prepare(`UPDATE "SiteCheckRun" SET "finishedAt"=?,"checked"=?,"strong"=?,"weak"=?,"wrong"=?,"failed"=?,"stopReason"=? WHERE "runId"=?`)
      .bind(new Date().toISOString(), result.checked, result.strong, result.weak, result.wrong, result.failed, stopReason, runId).run();
    return result;
  };

  const today = await db.prepare(`SELECT COALESCE(SUM("checked" + "failed"), 0) AS n FROM "SiteCheckRun" WHERE "startedAt" >= ?`).bind(torontoMidnight(now)).first<{ n: number }>();
  const room = Math.max(0, Math.min(options.perRun ?? SITE_CHECKS_PER_RUN, (options.perDay ?? SITE_CHECKS_PER_DAY) - Number(today?.n ?? 0)));
  if (room === 0) return finish("Today's website checks are done; more tomorrow.");
  const { results: due } = await db.prepare(`SELECT "placeId","name","city","niche","websiteUrl","phone","address","attempts" FROM "DiscoveryHeld"
    WHERE "status" = 'WAITING' ORDER BY "attempts" ASC, "firstSeenAt" ASC, "placeId" ASC LIMIT ?`).bind(room).all<Held>();
  if (!due.length) return finish(null);

  let session: Awaited<ReturnType<typeof options.openCapture>>;
  try { session = await options.openCapture(); }
  catch (caught) {
    // Browser Run itself is unavailable (outage or usage limit): count the waiting sites as
    // failed for this run, so the health check's "can't open any websites" alert fires.
    result.failed = due.length;
    return finish(`Couldn't start Cloudflare's browser: ${(caught instanceof Error ? caught.message : "unknown").split("\n")[0]!.slice(0, 150)}`);
  }
  try {
    for (const held of due) {
      const id = hostKey(held.websiteUrl);
      const known = await db.prepare(`SELECT "prospectId" FROM "EngineProspect" WHERE "prospectId" = ? OR "placeId" = ? LIMIT 1`).bind(id, held.placeId).first<{ prospectId: string }>();
      if (known) {
        // Added some other way in the meantime; nothing to check.
        await db.prepare(`UPDATE "DiscoveryHeld" SET "status"='CHECKED',"checkedAt"=?,"prospectId"=?,"checkVersion"=?,"lastError"='Already on the list.' WHERE "placeId"=?`)
          .bind(now.toISOString(), known.prospectId, SITE_CHECK_VERSION, held.placeId).run();
        continue;
      }
      let capture: EngineSiteCapture | null = null;
      let error = "";
      try { capture = await session.capture({ businessId: held.placeId, businessName: held.name, niche: held.niche, websiteUrl: held.websiteUrl }); }
      catch (caught) { error = caught instanceof Error ? caught.message.split("\n")[0]!.slice(0, 200) : "capture failed"; }
      if (!capture || capture.status !== "CAPTURED") {
        const attempts = held.attempts + 1;
        const giveUp = attempts >= SITE_CHECK_MAX_ATTEMPTS;
        const reason = (capture?.status === "UNREACHABLE" ? capture.reason : error || "The website could not be loaded.").slice(0, 300);
        await db.prepare(`UPDATE "DiscoveryHeld" SET "status"=?,"attempts"=?,"checkedAt"=?,"checkVersion"=?,"lastError"=? WHERE "placeId"=?`)
          .bind(giveUp ? "FAILED" : "WAITING", attempts, now.toISOString(), SITE_CHECK_VERSION, reason, held.placeId).run();
        result.failed += 1;
        if (giveUp) result.gaveUp += 1;
        continue;
      }

      const decision: EngineLeadDecision = classifyEngineLead(held.websiteUrl, capture.signals, now.getUTCFullYear());
      const reasons = JSON.stringify(decision.reasons.slice(0, 5)).slice(0, 2000);
      const finalUrl = (siteOrigin(capture.signals.finalUrl) ?? held.websiteUrl).slice(0, 300);
      let prospectId: string | null = null;
      if (decision.label === "STRONG" || decision.label === "WEAK") {
        const inserted = await db.prepare(`INSERT INTO "EngineProspect" ("prospectId","placeId","name","city","niche","websiteUrl","phone","address","label","reasons","runId","firstSeenAt","lastSeenAt")
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT("prospectId") DO NOTHING`)
          .bind(id, held.placeId, held.name.slice(0, 200), held.city, held.niche, finalUrl,
            (held.phone ?? capture.signals.phone ?? null)?.slice(0, 40) ?? null, (held.address ?? capture.signals.streetAddress ?? null)?.slice(0, 200) ?? null,
            decision.label, reasons, runId, now.toISOString(), now.toISOString()).run();
        prospectId = id;
        const email = capture.signals.email?.trim().toLowerCase();
        if (changed(inserted) && email && EMAIL.test(email) && email.length <= 254 && (capture.signals.emailMethod === "MAILTO_LINK" || capture.signals.emailMethod === "PAGE_TEXT")) {
          await db.prepare(`INSERT INTO "EngineProspectEmail" ("prospectId","email","sourceUrl","method","capturedAt","runId") VALUES (?,?,?,?,?,?) ON CONFLICT("prospectId") DO NOTHING`)
            .bind(id, email, capture.signals.finalUrl.slice(0, 300), capture.signals.emailMethod, now.toISOString(), runId).run();
        }
      }
      await db.prepare(`UPDATE "DiscoveryHeld" SET "status"='CHECKED',"attempts"=?,"checkedAt"=?,"label"=?,"reasons"=?,"finalUrl"=?,"checkVersion"=?,"prospectId"=?,"lastError"=NULL WHERE "placeId"=?`)
        .bind(held.attempts + 1, now.toISOString(), decision.label, reasons, finalUrl, SITE_CHECK_VERSION, prospectId, held.placeId).run();
      result.checked += 1;
      if (decision.label === "STRONG") result.strong += 1; else if (decision.label === "WEAK") result.weak += 1; else result.wrong += 1;
    }
  } finally {
    await session.close().catch(() => undefined);
  }
  return finish(null);
}
