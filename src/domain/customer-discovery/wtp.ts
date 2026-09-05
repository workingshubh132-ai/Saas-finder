/**
 * Willingness-to-pay classification (Phase 4) — deterministic, no
 * model call. Every level must be backed by a specific OBSERVED
 * finding; an INFERRED or UNKNOWN finding never contributes, so a
 * level can never be awarded merely because an analyst thinks the
 * customer would probably pay (the brief's own explicit requirement).
 */
export const WTP_LEVELS = ["NONE", "WEAK", "MEDIUM", "STRONG", "VERY_STRONG"] as const;
export type WtpLevel = (typeof WTP_LEVELS)[number];

export function isWtpLevel(value: string): value is WtpLevel {
  return (WTP_LEVELS as readonly string[]).includes(value);
}

const WTP_LEVEL_RANK: Record<WtpLevel, number> = { NONE: 0, WEAK: 1, MEDIUM: 2, STRONG: 3, VERY_STRONG: 4 };

export function wtpLevelAtLeast(level: WtpLevel, floor: WtpLevel): boolean {
  return WTP_LEVEL_RANK[level] >= WTP_LEVEL_RANK[floor];
}

export function maxWtpLevel(a: WtpLevel, b: WtpLevel): WtpLevel {
  return WTP_LEVEL_RANK[a] >= WTP_LEVEL_RANK[b] ? a : b;
}

/** The minimal shape classifyWtp() needs from a finding — decoupled from the Prisma row shape so this stays a pure, easily-testable function. */
export interface WtpFindingInput {
  readonly field: string;
  readonly provenance: string;
  readonly value: string;
}

export interface WtpClassification {
  readonly level: WtpLevel;
  readonly reasons: string[];
}

/**
 * Only OBSERVED findings are ever considered. Checked from the
 * strongest level down, so the result is always the single highest
 * level any real, observed finding actually supports.
 */
export function classifyWtp(findings: readonly WtpFindingInput[]): WtpClassification {
  const observed = findings.filter((f) => f.provenance === "OBSERVED" && f.value.trim().length > 0);
  const byField = (field: string) => observed.filter((f) => f.field === field);

  const wtpStatements = byField("WILLINGNESS_TO_PAY");
  if (wtpStatements.length > 0) {
    return {
      level: "VERY_STRONG",
      reasons: wtpStatements.map((f) => `Explicit stated willingness to pay (OBSERVED WILLINGNESS_TO_PAY): "${f.value}"`),
    };
  }

  const existingSpend = byField("EXISTING_SPEND");
  const timeCost = byField("TIME_COST");
  const consequence = byField("CONSEQUENCE");
  if (existingSpend.length > 0 || timeCost.length > 0 || consequence.length > 0) {
    const reasons: string[] = [];
    for (const f of existingSpend) reasons.push(`Existing spend already allocated to this problem (OBSERVED EXISTING_SPEND): "${f.value}"`);
    for (const f of timeCost) reasons.push(`Staff/employee time already allocated to this problem (OBSERVED TIME_COST): "${f.value}"`);
    for (const f of consequence) reasons.push(`Concrete economic consequence of the problem (OBSERVED CONSEQUENCE): "${f.value}"`);
    return { level: "STRONG", reasons };
  }

  const frequency = byField("FREQUENCY");
  const volume = byField("VOLUME");
  if (frequency.length > 0 || volume.length > 0) {
    const reasons: string[] = [];
    for (const f of frequency) reasons.push(`Specific recurring frequency stated (OBSERVED FREQUENCY): "${f.value}"`);
    for (const f of volume) reasons.push(`Specific volume stated (OBSERVED VOLUME): "${f.value}"`);
    return { level: "MEDIUM", reasons };
  }

  const problemConfirmed = byField("PROBLEM_CONFIRMED");
  if (problemConfirmed.length > 0) {
    return {
      level: "WEAK",
      reasons: problemConfirmed.map((f) => `General agreement the problem exists (OBSERVED PROBLEM_CONFIRMED): "${f.value}"`),
    };
  }

  return { level: "NONE", reasons: ["No OBSERVED finding relevant to willingness to pay yet."] };
}
