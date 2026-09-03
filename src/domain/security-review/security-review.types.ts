/** Security Review verdicts (docs/M6_ARCHITECTURE_PROPOSAL.md §16, brief §17's exact wording). */
export const SECURITY_VERDICTS = ["PASS", "PASS_WITH_WARNINGS", "FAIL"] as const;
export type SecurityVerdict = (typeof SECURITY_VERDICTS)[number];

export function isSecurityVerdict(value: string): value is SecurityVerdict {
  return (SECURITY_VERDICTS as readonly string[]).includes(value);
}

/** One deterministic-scan or model-judgment finding, always with concrete evidence — never a bare verdict (brief §17). */
export interface SecurityFinding {
  category: string;
  file: string;
  detail: string;
  evidence: string;
}
