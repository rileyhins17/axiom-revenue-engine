import {
  OwnerLeadProjectionSchema,
  type OwnerLeadProjection,
} from "@/lib/revenue-engine/owner-lead-projection";

// Operational stop state is deliberately separate from the sealed qualification
// snapshot. A stop changes which owner action is safe, not the evidence scores.
export type OwnerLeadStopState = "CLEAR" | "STOPPED" | "UNAVAILABLE";

export function applyOwnerLeadStopState(
  lead: OwnerLeadProjection,
  state: OwnerLeadStopState,
): OwnerLeadProjection {
  if (state === "CLEAR") return lead;
  const unavailable = state === "UNAVAILABLE";
  return OwnerLeadProjectionSchema.parse({
    ...lead,
    attention: "BLOCKED",
    ownerActionable: false,
    route: {
      channel: "RESEARCH",
      readiness: "RESEARCH_REQUIRED",
      contactPointId: null,
      label: unavailable ? "Stop status unavailable" : "Do not contact",
      reason: unavailable
        ? "The business stop record could not be checked. Do not contact until it is restored."
        : "An owner stop is recorded for this business. Do not contact through any channel.",
    },
  });
}
