import { z } from "zod";

const LockedEngineEnvironmentSchema = z
  .object({
    ENGINE_ENVIRONMENT: z.literal("shadow"),
    ENGINE_EXECUTION_ENABLED: z.literal("false"),
    ENGINE_AUTONOMY_LEVEL: z.literal("OFF"),
    ENGINE_MAX_JOB_COST_USD: z.literal("0"),
  })
  .passthrough();

export type LockedEngineEnvironment = z.infer<typeof LockedEngineEnvironmentSchema>;

export function parseLockedEngineEnvironment(value: unknown): LockedEngineEnvironment {
  return LockedEngineEnvironmentSchema.parse(value);
}

export function engineHealth(value: unknown) {
  const result = LockedEngineEnvironmentSchema.safeParse(value);
  return {
    service: "axiom-revenue-engine-core",
    environment: result.success ? result.data.ENGINE_ENVIRONMENT : "invalid",
    state: result.success ? "LOCKED" : "SAFETY_STOP",
    executionEnabled: false,
    autonomyLevel: "OFF",
    queueConsumerAttached: false,
    schedulesAttached: false,
    maxJobCostUsd: 0,
  } as const;
}
