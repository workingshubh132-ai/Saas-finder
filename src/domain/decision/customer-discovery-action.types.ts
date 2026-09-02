/**
 * The CEO's customer-discovery action set
 * (docs/M5_ARCHITECTURE_PROPOSAL.md §20) — a distinct decision axis
 * from CEO_DECISION_ACTIONS (decision-action.types.ts, M4), asked at a
 * different moment ("what customer-discovery step is worth taking
 * next" vs. "what should happen to this opportunity overall").
 * Justified down from the brief's seven to five: TEST_WTP/TEST_PROBLEM/
 * TEST_URGENCY collapse into one parameterized TEST_CLAIM, since M4's
 * own Expected Information Gain formula (domain/claim/eig.ts) already
 * picks which claim is worth testing next better than a hardcoded
 * action-per-claim-type would.
 */
export const CUSTOMER_DISCOVERY_ACTIONS = ["RUN_CUSTOMER_DISCOVERY", "REFINE_ICP", "TEST_CLAIM", "STOP_EXPERIMENT", "REQUEST_HUMAN_REVIEW"] as const;
export type CustomerDiscoveryAction = (typeof CUSTOMER_DISCOVERY_ACTIONS)[number];

export function isCustomerDiscoveryAction(value: string): value is CustomerDiscoveryAction {
  return (CUSTOMER_DISCOVERY_ACTIONS as readonly string[]).includes(value);
}
