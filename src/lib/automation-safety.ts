export type AutomationPhase = "intake" | "queue" | "send" | "follow_up";

export type AutomationSafetyEnvironment = {
  AUTONOMOUS_INTAKE_ENABLED: boolean;
  AUTONOMOUS_QUEUE_ENABLED: boolean;
  AUTONOMOUS_SEND_ENABLED: boolean;
  AUTONOMOUS_MAX_SENDS_PER_DAY: number;
  AUTONOMOUS_MAX_FOLLOW_UP_SENDS_PER_DAY: number;
};

export type AutomationSafetySettings = {
  enabled: boolean;
  globalPaused: boolean;
  emergencyPaused: boolean;
  intakePaused: boolean;
  followUpsPaused: boolean;
};

export type AutomationSafetyDecision =
  | { allowed: true; phase: AutomationPhase }
  | { allowed: false; phase: AutomationPhase; reason: string };

/**
 * Single fail-closed phase gate shared by every legacy entrypoint while the
 * durable Workflow engine is built. Missing policy is always blocked.
 */
export function evaluateAutomationSafety(input: {
  env: AutomationSafetyEnvironment | null | undefined;
  phase: AutomationPhase;
  settings: AutomationSafetySettings | null | undefined;
}): AutomationSafetyDecision {
  const { env, phase, settings } = input;

  if (!env) return { allowed: false, phase, reason: "environment_policy_unavailable" };
  if (!settings) return { allowed: false, phase, reason: "database_policy_unavailable" };
  if (!settings.enabled) return { allowed: false, phase, reason: "automation_disabled" };
  if (settings.emergencyPaused) return { allowed: false, phase, reason: "emergency_stop_active" };
  if (settings.globalPaused) return { allowed: false, phase, reason: "global_pause_active" };

  if (phase === "intake") {
    if (!env.AUTONOMOUS_INTAKE_ENABLED) return { allowed: false, phase, reason: "intake_switch_off" };
    if (settings.intakePaused) return { allowed: false, phase, reason: "intake_pause_active" };
  }

  if (phase === "queue" && !env.AUTONOMOUS_QUEUE_ENABLED) {
    return { allowed: false, phase, reason: "queue_switch_off" };
  }

  if (phase === "send" || phase === "follow_up") {
    if (!env.AUTONOMOUS_SEND_ENABLED) return { allowed: false, phase, reason: "send_switch_off" };
    if (env.AUTONOMOUS_MAX_SENDS_PER_DAY <= 0) return { allowed: false, phase, reason: "send_cap_zero" };
  }

  if (phase === "follow_up") {
    if (settings.followUpsPaused) return { allowed: false, phase, reason: "follow_up_pause_active" };
    if (env.AUTONOMOUS_MAX_FOLLOW_UP_SENDS_PER_DAY <= 0) {
      return { allowed: false, phase, reason: "follow_up_cap_zero" };
    }
  }

  return { allowed: true, phase };
}
