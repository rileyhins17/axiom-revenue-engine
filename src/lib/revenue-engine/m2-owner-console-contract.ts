import { z } from "zod";
import { PrivateKwM2OwnerLeadDetailResponseSchema } from "./private-kw-m2-owner-projection";
import { PrivateKwM2ResearchReportSchema } from "./private-kw-m2-terminal-report";

export const LocalM2OwnerConsoleSchema = z.object({
  status: z.literal("VERIFIED_LOCAL"), verifiedAt: z.string().datetime({ offset: true }),
  manifestId: z.string().min(1).max(200), manifestSize: z.literal(10),
  selectedCount: z.number().int().min(1).max(10),
  entries: z.array(z.object({
    businessId: z.string().min(1).max(128), businessName: z.string().min(1).max(256),
    sourceUrl: z.string().url().refine((url) => /^https?:\/\//i.test(url)),
    status: z.enum(["COMPLETE", "RESEARCH_REVIEW", "BLOCKED", "PENDING", "UNAVAILABLE"]),
    reason: z.string().min(1).max(300).nullable(),
    detail: PrivateKwM2OwnerLeadDetailResponseSchema.nullable(),
    research: PrivateKwM2ResearchReportSchema.nullable(),
  }).strict()).min(1).max(10),
}).strict().superRefine((value, ctx) => {
  if (value.entries.length !== value.selectedCount || new Set(value.entries.map((entry) => entry.businessId)).size !== value.entries.length) {
    ctx.addIssue({ code: "custom", message: "M2 review must account for each selected business exactly once." });
  }
  for (const entry of value.entries) {
    if ((entry.status === "COMPLETE") !== (entry.detail !== null)
      || (entry.status === "RESEARCH_REVIEW") !== (entry.research !== null)
      || (entry.detail && entry.detail.business.id !== entry.businessId)
      || (entry.research && entry.research.business.id !== entry.businessId)) {
      ctx.addIssue({ code: "custom", message: "M2 review outcome and evidence do not match." });
    }
  }
});

export type VerifiedLocalM2OwnerConsole = z.infer<typeof LocalM2OwnerConsoleSchema>;
export type LocalM2OwnerConsoleResult = VerifiedLocalM2OwnerConsole | { status: "UNAVAILABLE"; reason: string };
