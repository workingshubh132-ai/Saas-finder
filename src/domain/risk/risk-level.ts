/**
 * VentureForge's four autonomy levels (Constitution §8). This is the
 * one enum every other risk-bearing entity (Agent, Task, ApprovalRequest)
 * points at — never store risk as an arbitrary string elsewhere.
 */
export const RISK_LEVELS = ["GREEN", "YELLOW", "ORANGE", "RED"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export function isRiskLevel(value: string): value is RiskLevel {
  return (RISK_LEVELS as readonly string[]).includes(value);
}

export interface RiskPolicy {
  readonly level: RiskLevel;
  readonly label: string;
  readonly description: string;
  /** Must a human decision be recorded before this action executes? */
  readonly requiresApproval: boolean;
  /**
   * Does this level call for Chairman-level governance in addition to
   * the Human Owner? Recorded as metadata for M2 (no Chairman agent
   * exists yet in M1 — the Human Owner's approval already satisfies
   * the Constitution's ultimate authority, §2). See docs/DECISIONS.md.
   */
  readonly requiresChairman: boolean;
  /**
   * Even once approved, may the system execute the action itself, or
   * must a human carry it out directly (Constitution §8, RED: "AI may
   * prepare everything but cannot independently execute the action")?
   */
  readonly autoExecutableAfterApproval: boolean;
}

export const RISK_POLICY: Readonly<Record<RiskLevel, RiskPolicy>> = {
  GREEN: {
    level: "GREEN",
    label: "Autonomous",
    description: "Agents may execute without human intervention when properly authorized.",
    requiresApproval: false,
    requiresChairman: false,
    autoExecutableAfterApproval: true,
  },
  YELLOW: {
    level: "YELLOW",
    label: "Approval Required",
    description: "The system may prepare the action but must obtain approval before execution.",
    requiresApproval: true,
    requiresChairman: false,
    autoExecutableAfterApproval: true,
  },
  ORANGE: {
    level: "ORANGE",
    label: "Chairman + Human",
    description: "Requires additional governance beyond ordinary approval.",
    requiresApproval: true,
    requiresChairman: true,
    autoExecutableAfterApproval: true,
  },
  RED: {
    level: "RED",
    label: "Human Only",
    description: "AI may prepare everything but cannot independently execute the action.",
    requiresApproval: true,
    requiresChairman: false,
    autoExecutableAfterApproval: false,
  },
};

export function getRiskPolicy(level: RiskLevel): RiskPolicy {
  return RISK_POLICY[level];
}
