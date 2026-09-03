/**
 * QA verdicts (docs/M6_ARCHITECTURE_PROPOSAL.md §15). Distinct from
 * Security's PASS/PASS_WITH_WARNINGS/FAIL only in label —
 * PASS_WITH_GAPS names what QA specifically produces: a report that
 * found missing test coverage worth noting but not blocking (brief
 * §16's "QA must not merely run existing tests — it should identify
 * missing tests").
 */
export const QA_VERDICTS = ["PASS", "PASS_WITH_GAPS", "FAIL"] as const;
export type QaVerdict = (typeof QA_VERDICTS)[number];

export function isQaVerdict(value: string): value is QaVerdict {
  return (QA_VERDICTS as readonly string[]).includes(value);
}
