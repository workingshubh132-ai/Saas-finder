/**
 * The CEO's product-build action set (docs/M6_ARCHITECTURE_PROPOSAL.md
 * §32) — a third, distinct decision axis alongside CEO_DECISION_ACTIONS
 * (M4) and CUSTOMER_DISCOVERY_ACTIONS (M5), asked at a different moment:
 * "given the product spec/architecture/engineering progress/QA/security/
 * customer evidence/Chairman findings so far, what should happen to
 * this product build next." Every recommendation must cite evidence/
 * claims (brief §24); it never bypasses Guardian — same zero-tool-call
 * budget every CEO entry point already uses.
 */
export const PRODUCT_BUILD_ACTIONS = ["BUILD", "CONTINUE_BUILD", "CUT_SCOPE", "REQUEST_CUSTOMER_RESEARCH", "STOP", "REQUEST_HUMAN_REVIEW"] as const;
export type ProductBuildAction = (typeof PRODUCT_BUILD_ACTIONS)[number];

export function isProductBuildAction(value: string): value is ProductBuildAction {
  return (PRODUCT_BUILD_ACTIONS as readonly string[]).includes(value);
}
