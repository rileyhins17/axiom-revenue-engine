export const DISCOVERY_COOLDOWN_DAYS = 90;
export const WEBSITE_AUDIT_COOLDOWN_DAYS = 60;

export type CoverageYield = {
  discovered: number;
  duplicates: number;
  qualified: number;
};

export function isCoverageRunDue(lastCompletedAt: Date | null, now = new Date()) {
  if (!lastCompletedAt) return true;
  return now.getTime() - lastCompletedAt.getTime() >= DISCOVERY_COOLDOWN_DAYS * 86_400_000;
}

export function isWebsiteAuditDue(lastAuditedAt: Date | null, now = new Date(), changeTriggered = false) {
  if (changeTriggered || !lastAuditedAt) return true;
  return now.getTime() - lastAuditedAt.getTime() >= WEBSITE_AUDIT_COOLDOWN_DAYS * 86_400_000;
}

export function isCoverageSaturated(recentRuns: CoverageYield[]) {
  if (recentRuns.length < 3) return false;
  const totals = recentRuns.slice(-3).reduce(
    (sum, run) => ({
      discovered: sum.discovered + Math.max(0, run.discovered),
      duplicates: sum.duplicates + Math.max(0, run.duplicates),
      qualified: sum.qualified + Math.max(0, run.qualified),
    }),
    { discovered: 0, duplicates: 0, qualified: 0 },
  );
  if (totals.discovered === 0) return true;
  return totals.duplicates / totals.discovered >= 0.8 && totals.qualified / totals.discovered <= 0.05;
}
