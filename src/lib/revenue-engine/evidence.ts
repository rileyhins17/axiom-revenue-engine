import { z } from "zod";

export const EvidenceMethodSchema = z.enum([
  "deterministic_dom",
  "browser_render",
  "http_probe",
  "source_api",
  "visual_ai",
  "owner_review",
]);

export const EvidenceClaimSchema = z.object({
  claimId: z.string().min(1),
  observation: z.string().trim().min(1).max(500),
  sourceUrl: z.string().url(),
  capturedAt: z.string().datetime({ offset: true }),
  method: EvidenceMethodSchema,
  confidence: z.number().min(0).max(100),
  auditVersion: z.string().min(1),
  artifactRef: z.string().min(1).nullable(),
  conversionCritical: z.boolean(),
  category: z.enum([
    "availability",
    "mobile",
    "navigation",
    "offer_clarity",
    "conversion_action",
    "form",
    "trust",
    "local_relevance",
    "performance",
    "seo",
    "other",
  ]),
});

export type EvidenceClaim = z.infer<typeof EvidenceClaimSchema>;

export function isSupportedEvidenceClaim(claim: EvidenceClaim) {
  return claim.confidence >= 80 && claim.auditVersion.trim().length > 0 && claim.observation.trim().length > 0;
}
