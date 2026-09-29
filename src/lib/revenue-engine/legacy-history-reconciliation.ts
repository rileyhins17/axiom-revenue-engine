/** Offline, read-only projection for reconciling legacy contact history to v2 businesses. */
import { createHash } from "node:crypto";

export const LEGACY_HISTORY_RECONCILIATION_VERSION = "legacy-history-reconciliation-v1" as const;

export interface LegacyHistoryLeadProjection {
  leadId: string;
  domain: string | null;
  phone: string | null;
  email: string | null;
}

export interface LegacyHistoryBusinessProjection {
  businessId: string;
  domain: string | null;
  phone: string | null;
}

export interface LegacyHistoryLocationProjection {
  locationId: string;
  businessId: string;
  phone: string | null;
}

export interface LegacyHistoryContactPointProjection { contactPointId: string; businessId: string; channel: "EMAIL" | "PHONE"; value: string; }

export type LegacyHistoryEventType = "SUPPRESSION" | "SEND" | "SEQUENCE" | "STEP" | "FUNNEL" | "LEAD_STATE";
export type LegacyHistoryEventStatus =
  | "ACTIVE" | "REVOKED" | "EXPIRED"
  | "SENT" | "ACCEPTED" | "DELIVERED" | "UNKNOWN_OUTCOME" | "FAILED" | "CANCELLED"
  | "BOUNCED" | "REPLIED" | "UNSUBSCRIBED" | "COMPLAINT" | "OUTREACH_SENT"
  | "REPORTED_CONTACTED" | "REPORTED_REPLIED" | "REPORTED_BOUNCED"
  | "OPEN" | "CLICKED" | "PREPARED" | "APPROVED" | "SKIPPED";

export interface LegacyHistoryEventProjection {
  eventId: string;
  leadId: string | null;
  type: LegacyHistoryEventType;
  status: LegacyHistoryEventStatus;
  occurredAt: string;
  expiresAt: string | null;
  /** Used only for domain-scoped suppression rows; never emitted in the report. */
  domain?: string | null;
  /** Used for exact email suppression matching only; never emitted. */
  email?: string | null;
}

export interface V2BusinessStopProjection {
  businessId: string;
  kind: "SUPPRESSION" | "CONTACTED" | "REPLY" | "UNKNOWN";
  status: "ACTIVE" | "REVOKED" | "EXPIRED" | "RESOLVED" | "UNKNOWN";
  expiresAt: string | null;
}

export interface LegacyHistoryReconciliationInput {
  snapshot: { snapshotId: string; asOf: string };
  /** Must be true only when each source table/query completed without truncation or error. */
  complete: true;
  legacyLeads: LegacyHistoryLeadProjection[];
  businesses: LegacyHistoryBusinessProjection[];
  locations: LegacyHistoryLocationProjection[];
  contactPoints: LegacyHistoryContactPointProjection[];
  events: LegacyHistoryEventProjection[];
  v2BusinessStops: V2BusinessStopProjection[];
}

export type LegacyHistoryBlocker = "IDENTITY_REVIEW" | "SUPPRESSIVE_HISTORY" | "SUPPRESSION_REVIEW" | "CONTACTED_HISTORY" | "BOUNCE_HISTORY" | "REPLY_HISTORY" | "UNRESOLVED_HISTORY";

export interface LegacyHistoryCandidateMapping {
  legacyLeadId: string;
  candidates: Array<{ businessId: string; contactPointIds: string[]; matchedBy: Array<"EXACT_DOMAIN" | "EXACT_PHONE" | "EXACT_EMAIL"> }>;
  /** Identity evidence only nominates a candidate; human review must decide any merge. */
  mergeApproved: false;
  blockers: LegacyHistoryBlocker[];
}

export interface LegacyHistoryLeadStatus {
  legacyLeadId: string;
  status: "NO_HISTORY" | "SUPPRESSIVE" | "CONTACTED" | "BOUNCED" | "REPLIED" | "UNRESOLVED";
  sentEvidence: boolean;
  replyEvidence: boolean;
  bounceEvidence: boolean;
  suppressionActive: boolean;
  suppressionExpired: boolean;
  unresolved: boolean;
  reportedContacted: boolean;
  reportedReplied: boolean;
  reportedBounced: boolean;
  events: LegacyHistoryEventReference[];
}

export interface LegacyHistoryEventReference {
  eventRef: string;
  type: LegacyHistoryEventType;
  status: LegacyHistoryEventStatus;
  occurredAt: string;
  expiresAt: string | null;
}

export interface LegacyHistoryReconciliationReport {
  version: typeof LEGACY_HISTORY_RECONCILIATION_VERSION;
  snapshotId: string;
  asOf: string;
  mappings: LegacyHistoryCandidateMapping[];
  history: LegacyHistoryLeadStatus[];
  businessBlockers: Array<{ businessId: string; blockers: LegacyHistoryBlocker[]; contactPointIds: string[] }>;
  suppressions: Array<{ eventRef: string; status: "ACTIVE" | "EXPIRED" | "INACTIVE"; occurredAt: string; expiresAt: string | null; legacyLeadId: string | null; domainCandidateBusinessIds: string[]; contactMatches: Array<{ businessId: string; contactPointId: string }> }>;
  unresolvedHistory: boolean;
  ownerReviewRequired: boolean;
  unresolvedReasons: string[];
}

const iso = (value: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error("Invalid reconciliation timestamp");
  return parsed;
};
const EVENT_TYPES = new Set<LegacyHistoryEventType>(["SUPPRESSION", "SEND", "SEQUENCE", "STEP", "FUNNEL", "LEAD_STATE"]);
const EVENT_STATUSES = new Set<LegacyHistoryEventStatus>(["ACTIVE", "REVOKED", "EXPIRED", "SENT", "ACCEPTED", "DELIVERED", "UNKNOWN_OUTCOME", "FAILED", "CANCELLED", "BOUNCED", "REPLIED", "UNSUBSCRIBED", "COMPLAINT", "OUTREACH_SENT", "REPORTED_CONTACTED", "REPORTED_REPLIED", "REPORTED_BOUNCED", "OPEN", "CLICKED", "PREPARED", "APPROVED", "SKIPPED"]);

function requiredId(value: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new Error("Invalid reconciliation identifier");
}

function normalizeDomain(value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim() === "") throw new Error("Invalid domain projection");
  const domain = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (domain.includes("/") || domain.includes("@") || /\s/.test(domain)) throw new Error("Invalid domain projection");
  return domain.startsWith("www.") ? domain.slice(4) : domain;
}

function normalizePhone(value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim() === "") throw new Error("Invalid phone projection");
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) throw new Error("Invalid phone projection");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

function opaqueEventRef(eventId: string): string {
  return `event:sha256:${createHash("sha256").update(`legacy-history-event-v1\0${eventId}`).digest("hex")}`;
}

/**
 * Reconciles already-extracted, privacy-minimal rows. It performs no I/O, writes,
 * identity merges, or contact action. Any incomplete or malformed source fails closed.
 */
export function buildLegacyHistoryReconciliation(input: LegacyHistoryReconciliationInput): LegacyHistoryReconciliationReport {
  if (!input || input.complete !== true) throw new Error("Incomplete reconciliation input");
  requiredId(input.snapshot.snapshotId);
  const asOf = iso(input.snapshot.asOf);
  const leads = input.legacyLeads;
  const businesses = input.businesses;
  const locations = input.locations;
  const contactPoints = input.contactPoints;
  const events = input.events;
  const stops = input.v2BusinessStops;
  if (![leads, businesses, locations, contactPoints, events, stops].every(Array.isArray)) throw new Error("Invalid reconciliation projection");
  unique(leads.map(x => x.leadId), "legacy lead id");
  unique(businesses.map(x => x.businessId), "v2 business id");
  unique(locations.map(x => x.locationId), "v2 location id");
  unique(contactPoints.map(x => x.contactPointId), "v2 contact point id");
  unique(events.map(x => x.eventId), "history event id");

  const leadIds = new Set(leads.map(x => { requiredId(x.leadId); return x.leadId; }));
  const businessIds = new Set(businesses.map(x => { requiredId(x.businessId); return x.businessId; }));
  const domains = new Map<string, Set<string>>();
  const phones = new Map<string, Set<string>>();
  const phoneContacts = new Map<string, Array<{ businessId: string; contactPointId: string }>>();
  const emails = new Map<string, Array<{ businessId: string; contactPointId: string }>>();
  const add = (map: Map<string, Set<string>>, key: string | null, businessId: string) => {
    if (key === null) return;
    const ids = map.get(key) ?? new Set<string>(); ids.add(businessId); map.set(key, ids);
  };
  for (const business of businesses) {
    add(domains, normalizeDomain(business.domain), business.businessId);
    add(phones, normalizePhone(business.phone), business.businessId);
  }
  for (const location of locations) {
    requiredId(location.locationId); requiredId(location.businessId);
    if (!businessIds.has(location.businessId)) throw new Error("Location references unknown business");
    add(phones, normalizePhone(location.phone), location.businessId);
  }
  for (const contact of contactPoints) {
    requiredId(contact.contactPointId); requiredId(contact.businessId);
    if (!businessIds.has(contact.businessId) || !["EMAIL", "PHONE"].includes(contact.channel) || typeof contact.value !== "string" || contact.value.trim() === "") throw new Error("Invalid contact projection");
    if (contact.channel === "EMAIL") {
      if (!contact.value.includes("@")) throw new Error("Invalid email contact projection");
      const key = contact.value.trim().toLowerCase();
      const matches = emails.get(key) ?? []; matches.push({ businessId: contact.businessId, contactPointId: contact.contactPointId }); emails.set(key, matches);
    } else {
      add(phones, normalizePhone(contact.value), contact.businessId);
      const key = normalizePhone(contact.value)!;
      const matches = phoneContacts.get(key) ?? []; matches.push({ businessId: contact.businessId, contactPointId: contact.contactPointId }); phoneContacts.set(key, matches);
    }
  }

  const unresolvedReasons = new Set<string>();
  const leadFlags = new Map<string, { suppression: boolean; suppressionExpired: boolean; contacted: boolean; reply: boolean; bounce: boolean; unresolved: boolean; reportedContacted: boolean; reportedReplied: boolean; reportedBounced: boolean; events: LegacyHistoryEventReference[] }>();
  for (const id of leadIds) leadFlags.set(id, { suppression: false, suppressionExpired: false, contacted: false, reply: false, bounce: false, unresolved: false, reportedContacted: false, reportedReplied: false, reportedBounced: false, events: [] });
  const activeAtAsOf = (status: string, expiresAt: string | null) => status !== "REVOKED" && status !== "EXPIRED" && (expiresAt === null ? status === "ACTIVE" : iso(expiresAt) > asOf);
  const suppressionDomains = new Set<string>();
  const activeSuppressionDomains = new Set<string>();
  const suppressionEmails = new Set<string>();
  const activeSuppressionEmails = new Set<string>();
  const suppressions: LegacyHistoryReconciliationReport["suppressions"] = [];
  let unmatchableSuppression = false;
  for (const event of events) {
    requiredId(event.eventId);
    if (!EVENT_TYPES.has(event.type) || !EVENT_STATUSES.has(event.status)) throw new Error("Invalid history event type or status");
    if (event.type === "LEAD_STATE" && !["REPORTED_CONTACTED", "REPORTED_REPLIED", "REPORTED_BOUNCED", "UNKNOWN_OUTCOME"].includes(event.status)) throw new Error("Invalid legacy lead-state status");
    if (event.type !== "LEAD_STATE" && ["REPORTED_CONTACTED", "REPORTED_REPLIED", "REPORTED_BOUNCED"].includes(event.status)) throw new Error("Reported lead-state status requires LEAD_STATE type");
    if (iso(event.occurredAt) > asOf) throw new Error("Future-dated history event");
    if (event.expiresAt !== null) iso(event.expiresAt);
    const eventReference: LegacyHistoryEventReference = { eventRef: opaqueEventRef(event.eventId), type: event.type, status: event.status, occurredAt: event.occurredAt, expiresAt: event.expiresAt };
    if (event.type === "SUPPRESSION") {
      const active = activeAtAsOf(event.status, event.expiresAt);
      const expired = event.status === "EXPIRED" || (event.expiresAt !== null && iso(event.expiresAt) <= asOf);
      const suppressionDomain = normalizeDomain(event.domain ?? null);
      if (event.email != null && (typeof event.email !== "string" || event.email.trim() === "" || !event.email.includes("@"))) throw new Error("Invalid suppression email projection");
      const suppressionEmail = event.email == null ? null : event.email.trim().toLowerCase();
      const suppressionState = active ? "ACTIVE" : expired ? "EXPIRED" : "INACTIVE";
      const domainCandidateBusinessIds = suppressionDomain === null ? [] : [...(domains.get(suppressionDomain) ?? [])].sort();
      const contactMatches = suppressionEmail === null ? [] : (emails.get(suppressionEmail) ?? []).map(x => ({ ...x })).sort((a, b) => a.businessId.localeCompare(b.businessId) || a.contactPointId.localeCompare(b.contactPointId));
      suppressions.push({ eventRef: eventReference.eventRef, status: suppressionState, occurredAt: event.occurredAt, expiresAt: event.expiresAt, legacyLeadId: event.leadId, domainCandidateBusinessIds, contactMatches });
      if (event.status !== "REVOKED") {
        if (suppressionDomain !== null) suppressionDomains.add(suppressionDomain);
        if (suppressionEmail !== null) suppressionEmails.add(suppressionEmail);
      }
      if (active) {
        if (suppressionDomain !== null) activeSuppressionDomains.add(suppressionDomain);
        if (suppressionEmail !== null) activeSuppressionEmails.add(suppressionEmail);
      }
      if (event.leadId === null) {
        if (suppressionDomain === null && suppressionEmail === null) unmatchableSuppression = true;
        continue;
      }
      if (!leadIds.has(event.leadId)) { unresolvedReasons.add("HISTORY_WITHOUT_LEAD"); continue; }
      const flags = leadFlags.get(event.leadId)!;
      flags.events.push(eventReference);
      flags.suppression ||= active;
      flags.suppressionExpired ||= expired;
    } else if (event.type === "SEND" || event.type === "SEQUENCE" || event.type === "STEP") {
      requiredId(event.leadId ?? "");
      if (!leadIds.has(event.leadId!)) { unresolvedReasons.add("HISTORY_WITHOUT_LEAD"); continue; }
      const flags = leadFlags.get(event.leadId!)!;
      flags.events.push(eventReference);
      if (["SENT", "ACCEPTED", "DELIVERED"].includes(event.status)) flags.contacted = true;
      if (event.status === "REPLIED") flags.reply = true;
      if (event.status === "UNKNOWN_OUTCOME") flags.unresolved = true;
      if (event.status === "BOUNCED") flags.bounce = true;
    } else if (event.type === "FUNNEL") {
      requiredId(event.leadId ?? "");
      if (!leadIds.has(event.leadId!)) { unresolvedReasons.add("HISTORY_WITHOUT_LEAD"); continue; }
      const flags = leadFlags.get(event.leadId!)!;
      flags.events.push(eventReference);
      if (event.status === "REPLIED") flags.reply = true;
      if (["UNSUBSCRIBED", "COMPLAINT"].includes(event.status)) flags.suppression = true;
      if (event.status === "BOUNCED") flags.bounce = true;
      if (["OUTREACH_SENT", "SENT", "ACCEPTED", "DELIVERED"].includes(event.status)) flags.contacted = true;
      if (event.status === "UNKNOWN_OUTCOME") flags.unresolved = true;
    } else if (event.type === "LEAD_STATE") {
      requiredId(event.leadId ?? "");
      if (!leadIds.has(event.leadId!)) { unresolvedReasons.add("HISTORY_WITHOUT_LEAD"); continue; }
      const flags = leadFlags.get(event.leadId!)!;
      flags.events.push(eventReference);
      flags.unresolved = true;
      if (event.status === "REPORTED_CONTACTED") flags.reportedContacted = true;
      if (event.status === "REPORTED_REPLIED") flags.reportedReplied = true;
      if (event.status === "REPORTED_BOUNCED") flags.reportedBounced = true;
    }
  }
  const businessFlags = new Map<string, Set<LegacyHistoryBlocker>>();
  const suppressedContactIdsByBusiness = new Map<string, Set<string>>();
  const activeSuppressedContactIdsByBusiness = new Map<string, Set<string>>();
  for (const email of suppressionEmails) {
    const matches = emails.get(email) ?? [];
    if (matches.length === 0) { unmatchableSuppression = true; continue; }
    for (const match of matches) { const ids = suppressedContactIdsByBusiness.get(match.businessId) ?? new Set<string>(); ids.add(match.contactPointId); suppressedContactIdsByBusiness.set(match.businessId, ids); }
  }
  for (const email of activeSuppressionEmails) for (const match of emails.get(email) ?? []) {
    const ids = activeSuppressedContactIdsByBusiness.get(match.businessId) ?? new Set<string>(); ids.add(match.contactPointId); activeSuppressedContactIdsByBusiness.set(match.businessId, ids);
  }
  for (const domain of suppressionDomains) if ((domains.get(domain) ?? new Set()).size === 0) unmatchableSuppression = true;
  if (unmatchableSuppression) unresolvedReasons.add("SUPPRESSION_WITHOUT_MATCHABLE_IDENTITY");
  for (const stop of stops) {
    requiredId(stop.businessId);
    if (!["SUPPRESSION", "CONTACTED", "REPLY", "UNKNOWN"].includes(stop.kind) || !["ACTIVE", "REVOKED", "EXPIRED", "RESOLVED", "UNKNOWN"].includes(stop.status)) throw new Error("Invalid v2 stop projection");
    if (!businessIds.has(stop.businessId)) throw new Error("Stop references unknown business");
    if (stop.expiresAt !== null) iso(stop.expiresAt);
    if (stop.status === "UNKNOWN") unresolvedReasons.add("V2_STOP_UNRESOLVED");
    // An old stop remains a review blocker even when its projected status says
    // expired, revoked, or resolved; this report cannot adjudicate that release.
    const set = businessFlags.get(stop.businessId) ?? new Set<LegacyHistoryBlocker>();
    if (stop.kind === "SUPPRESSION") set.add("SUPPRESSIVE_HISTORY");
    else if (stop.kind === "CONTACTED") set.add("CONTACTED_HISTORY");
    else if (stop.kind === "REPLY") set.add("REPLY_HISTORY");
    else set.add("UNRESOLVED_HISTORY");
    businessFlags.set(stop.businessId, set);
  }

  const history = leads.map(lead => {
    const flags = leadFlags.get(lead.leadId)!;
    const status: LegacyHistoryLeadStatus["status"] = flags.suppression || flags.suppressionExpired ? "SUPPRESSIVE" : flags.unresolved ? "UNRESOLVED" : flags.reply ? "REPLIED" : flags.bounce ? "BOUNCED" : flags.contacted ? "CONTACTED" : "NO_HISTORY";
    return { legacyLeadId: lead.leadId, status, sentEvidence: flags.contacted, replyEvidence: flags.reply, bounceEvidence: flags.bounce, suppressionActive: flags.suppression, suppressionExpired: flags.suppressionExpired, unresolved: flags.unresolved, reportedContacted: flags.reportedContacted, reportedReplied: flags.reportedReplied, reportedBounced: flags.reportedBounced, events: flags.events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.eventRef.localeCompare(b.eventRef)) };
  });
  const historyById = new Map(history.map(x => [x.legacyLeadId, x]));
  const mappings = leads.map(lead => {
    const byId = new Map<string, Set<"EXACT_DOMAIN" | "EXACT_PHONE" | "EXACT_EMAIL">>();
    const exactContactIds = new Map<string, Set<string>>();
    const domain = normalizeDomain(lead.domain);
    const matchedDomain = domain !== null && suppressionDomains.has(domain);
    const matchedActiveDomain = domain !== null && activeSuppressionDomains.has(domain);
    for (const id of domains.get(domain ?? "") ?? []) byId.set(id, new Set(["EXACT_DOMAIN"]));
    const phone = normalizePhone(lead.phone);
    for (const id of phones.get(phone ?? "") ?? []) { const matched = byId.get(id) ?? new Set(); matched.add("EXACT_PHONE"); byId.set(id, matched); }
    for (const match of phoneContacts.get(phone ?? "") ?? []) { const ids = exactContactIds.get(match.businessId) ?? new Set<string>(); ids.add(match.contactPointId); exactContactIds.set(match.businessId, ids); }
    if (lead.email !== null) {
      if (typeof lead.email !== "string" || lead.email.trim() === "" || !lead.email.includes("@")) throw new Error("Invalid legacy email projection");
      for (const match of emails.get(lead.email.trim().toLowerCase()) ?? []) { const matched = byId.get(match.businessId) ?? new Set(); matched.add("EXACT_EMAIL"); byId.set(match.businessId, matched); const ids = exactContactIds.get(match.businessId) ?? new Set<string>(); ids.add(match.contactPointId); exactContactIds.set(match.businessId, ids); }
    }
    const status = historyById.get(lead.leadId)!;
    const blockers: LegacyHistoryBlocker[] = [];
    if (status.suppressionActive) blockers.push("SUPPRESSIVE_HISTORY");
    if (status.suppressionExpired) blockers.push("SUPPRESSION_REVIEW");
    if (status.sentEvidence) blockers.push("CONTACTED_HISTORY");
    if (status.bounceEvidence) blockers.push("BOUNCE_HISTORY");
    if (status.replyEvidence) blockers.push("REPLY_HISTORY");
    if (status.unresolved || unresolvedReasons.size > 0) blockers.push("UNRESOLVED_HISTORY");
    // Candidate matching is only a nomination. This report has no owner-disposition
    // input, so every unapproved candidate remains blocked for new outreach.
    if (byId.size > 0) blockers.push("IDENTITY_REVIEW");
    if (matchedDomain && !blockers.includes("SUPPRESSIVE_HISTORY")) blockers.push(matchedActiveDomain ? "SUPPRESSIVE_HISTORY" : "SUPPRESSION_REVIEW");
    if ([...byId.keys()].some(id => activeSuppressedContactIdsByBusiness.has(id)) && !blockers.includes("SUPPRESSIVE_HISTORY")) blockers.push("SUPPRESSIVE_HISTORY");
    else if ([...byId.keys()].some(id => suppressedContactIdsByBusiness.has(id)) && !blockers.includes("SUPPRESSIVE_HISTORY") && !blockers.includes("SUPPRESSION_REVIEW")) blockers.push("SUPPRESSION_REVIEW");
    for (const [businessId, v2Flags] of businessFlags) if (byId.has(businessId)) for (const flag of v2Flags) if (!blockers.includes(flag)) blockers.push(flag);
    return {
      legacyLeadId: lead.leadId,
      candidates: [...byId.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([businessId, matchedBy]) => ({ businessId, contactPointIds: [...(exactContactIds.get(businessId) ?? [])].sort(), matchedBy: [...matchedBy].sort() })),
      mergeApproved: false as const,
      blockers: blockers.sort(),
    };
  });
  const businessBlockerMap = new Map<string, Set<LegacyHistoryBlocker>>();
  const businessContactMap = new Map<string, Set<string>>();
  const addBusinessBlocker = (businessId: string, blocker: LegacyHistoryBlocker) => {
    const set = businessBlockerMap.get(businessId) ?? new Set<LegacyHistoryBlocker>(); set.add(blocker); businessBlockerMap.set(businessId, set);
  };
  for (const domain of suppressionDomains) for (const businessId of domains.get(domain) ?? []) addBusinessBlocker(businessId, activeSuppressionDomains.has(domain) ? "SUPPRESSIVE_HISTORY" : "SUPPRESSION_REVIEW");
  for (const [businessId, contactIds] of suppressedContactIdsByBusiness) {
    const activeIds = activeSuppressedContactIdsByBusiness.get(businessId) ?? new Set<string>();
    addBusinessBlocker(businessId, activeIds.size > 0 ? "SUPPRESSIVE_HISTORY" : "SUPPRESSION_REVIEW");
    businessContactMap.set(businessId, new Set(contactIds));
  }
  for (const mapping of mappings) for (const candidate of mapping.candidates) for (const blocker of mapping.blockers) addBusinessBlocker(candidate.businessId, blocker);
  for (const [businessId, blockers] of businessFlags) for (const blocker of blockers) addBusinessBlocker(businessId, blocker);
  const businessBlockers = businesses.map(({ businessId }) => ({ businessId, blockers: [...(businessBlockerMap.get(businessId) ?? [])].sort(), contactPointIds: [...(businessContactMap.get(businessId) ?? [])].sort() }));
  const ownerReviewRequired = unresolvedReasons.size > 0 || history.some(item => item.status !== "NO_HISTORY") || mappings.some(item => item.candidates.length > 0) || businessBlockers.some(item => item.blockers.length > 0);
  const unresolvedHistory = unresolvedReasons.size > 0
    || history.some(item => item.status !== "NO_HISTORY")
    || suppressions.some(item => item.status === "ACTIVE" || item.status === "EXPIRED")
    || businessBlockers.some(item => item.blockers.some(blocker => blocker !== "IDENTITY_REVIEW"));
  return {
    version: LEGACY_HISTORY_RECONCILIATION_VERSION,
    snapshotId: input.snapshot.snapshotId,
    asOf: input.snapshot.asOf,
    mappings,
    history,
    businessBlockers,
    suppressions: suppressions.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.eventRef.localeCompare(b.eventRef)),
    unresolvedHistory,
    ownerReviewRequired,
    unresolvedReasons: [...unresolvedReasons].sort(),
  };
}
