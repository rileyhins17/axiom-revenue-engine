import type { D1DatabaseLike } from "@/lib/cloudflare";

export type RevenueEvidencePartition = "LEGACY" | "M2_HTML";

export const REVENUE_EVIDENCE_PARTITION_TABLES = [
  ["RevenueWebsiteSnapshot", "evidenceMode"],
  ["RevenueEvidenceClaim", "evidenceMode"],
  ["RevenueQualificationSnapshot", "evidenceMode"],
  ["RevenueContactPoint", "evidenceMode"],
  ["RevenueVerificationResult", "evidenceMode"],
  ["RevenueLeadAssessmentReceipt", "assessmentKind"],
  ["RevenuePrivateKwContactInvocationReceipt", "assessmentKind"],
] as const;

type PartitionRequest = readonly [string, "evidenceMode" | "assessmentKind"];
const ALLOWED_REQUESTS = new Set(REVENUE_EVIDENCE_PARTITION_TABLES.map(([table, column]) => `${table}:${column}`));

export function classifyRevenueEvidencePartitions(rowsByTable: readonly { table: string; column: "evidenceMode" | "assessmentKind"; rows: unknown }[]): boolean {
  if (rowsByTable.length === 0) throw new Error("M2 reader received no evidence-partition schema metadata.");
  const states = rowsByTable.map(({ table, column, rows }) => {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error(`M2 reader could not inspect ${table} schema.`);
    const columns = new Set<string>();
    for (const row of rows) {
      if (typeof row !== "object" || row === null || typeof (row as { name?: unknown }).name !== "string" || !(row as { name: string }).name) {
        throw new Error(`M2 reader received malformed ${table} schema metadata.`);
      }
      const typed = row as { name: string; type?: unknown; notnull?: unknown; dflt_value?: unknown };
      if (columns.has(typed.name)) throw new Error(`M2 reader received duplicate ${table} schema metadata.`);
      columns.add(typed.name);
      if (typed.name === column && (typed.type !== "TEXT" || typed.notnull !== 1 || typed.dflt_value !== "'LEGACY'")) {
        throw new Error(`M2 reader received an invalid ${table}.${column} partition definition.`);
      }
    }
    const hasExpected = columns.has(column);
    const hasUnexpected = [...columns].some((value) => (value === "evidenceMode" || value === "assessmentKind") && value !== column);
    return { hasExpected, hasUnexpected };
  });
  const allAbsent = states.every(({ hasExpected, hasUnexpected }) => !hasExpected && !hasUnexpected);
  const allPresent = states.every(({ hasExpected, hasUnexpected }) => hasExpected && !hasUnexpected);
  if (allAbsent) return false;
  if (allPresent) return true;
  throw new Error("M2 reader detected a partial or mixed evidence-partition schema.");
}

export async function readRevenueEvidencePartition(database: D1DatabaseLike, requested: readonly PartitionRequest[] = REVENUE_EVIDENCE_PARTITION_TABLES): Promise<RevenueEvidencePartition> {
  if (requested.some(([table, column]) => !ALLOWED_REQUESTS.has(`${table}:${column}`))) throw new Error("M2 reader received an unsupported partition metadata request.");
  const rowsByTable = await Promise.all(requested.map(async ([table, expectedColumn]) => {
    const rows = await database.prepare(`PRAGMA table_info("${table}")`).all<unknown>();
    return { table, column: expectedColumn, rows: rows.results };
  }));
  return classifyRevenueEvidencePartitions(rowsByTable) ? "M2_HTML" : "LEGACY";
}

export function legacyPartitionPredicates(partition: RevenueEvidencePartition) {
  if (partition !== "M2_HTML") return {
    websiteCandidate: "", websiteOuter: "", qualificationCandidate: "", qualificationOuter: "",
    contactCandidate: "", contactOuter: "", verificationCandidate: "", historyWebsite: "",
    historyQualification: "", historyContact: "", historyVerification: "", assessment: "",
  };
  return {
    websiteCandidate: ` AND candidateWebsite."evidenceMode" = 'LEGACY'`,
    websiteOuter: ` AND website."evidenceMode" = 'LEGACY'`,
    qualificationCandidate: ` AND candidateQualification."evidenceMode" = 'LEGACY'`,
    qualificationOuter: ` AND qualification."evidenceMode" = 'LEGACY'`,
    contactCandidate: ` AND latestContact."evidenceMode" = 'LEGACY'`,
    contactOuter: ` AND contact."evidenceMode" = 'LEGACY'`,
    verificationCandidate: ` AND candidateVerification."evidenceMode" = 'LEGACY'`,
    historyWebsite: ` AND website."evidenceMode" = 'LEGACY'`,
    historyQualification: ` AND qualification."evidenceMode" = 'LEGACY'`,
    historyContact: ` AND contact."evidenceMode" = 'LEGACY'`,
    historyVerification: ` AND contact."evidenceMode" = 'LEGACY' AND verification."evidenceMode" = 'LEGACY'`,
    assessment: ` AND receipt."assessmentKind" = 'LEGACY'`,
  };
}
