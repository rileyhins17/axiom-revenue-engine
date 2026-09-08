import { z } from "zod";
const id = z.string().min(1).max(256);
// SQLite CURRENT_TIMESTAMP is UTC even without a suffix. Do not interpret it
// as the browser's local timezone (which shifts the displayed send time).
export const legacyTimeSchema = z.string().max(64)
  .regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/)
  .transform(value => value.replace(" ","T") + (/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? "" : "Z"))
  .refine(value => Number.isFinite(Date.parse(value)))
  .transform(value => new Date(value).toISOString());
export const legacyEmailSchema = z.object({
  source: z.literal("LEGACY_OUTREACH_EMAIL"), id, leadId: z.number().int().positive(),
  senderEmail: z.string().max(512), recipientEmail: z.string().max(512), subject: z.string().max(2048),
  bodyPlain: z.string().max(32768).nullable(),
  bodyUnavailable: z.enum(["NOT_REQUESTED", "NO_PLAIN_TEXT", "TOO_LARGE"]).nullable(),
  status: z.string().max(64), sentAt: legacyTimeSchema, failureRecorded: z.boolean(),
  businessName: z.string().max(2048).nullable(), city: z.string().max(512).nullable(),
}).strict();
export type LegacyEmail = z.infer<typeof legacyEmailSchema>;
