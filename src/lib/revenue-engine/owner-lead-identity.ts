import { z } from "zod";

export const OwnerLeadBusinessIdSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:_-]*$/, "Business identity contains unsupported route characters.");

export function parseOwnerLeadBusinessIdRouteParam(value: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  const result = OwnerLeadBusinessIdSchema.safeParse(decoded);
  return result.success ? result.data : null;
}

export function ownerLeadDetailPath(value: string) {
  return `/leads/${OwnerLeadBusinessIdSchema.parse(value)}`;
}
