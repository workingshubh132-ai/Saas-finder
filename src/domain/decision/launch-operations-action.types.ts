/**
 * The CEO's launch & operations action set
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §28) — a fourth, distinct decision
 * axis alongside CEO_DECISION_ACTIONS (M4), CUSTOMER_DISCOVERY_ACTIONS
 * (M5), and PRODUCT_BUILD_ACTIONS (M6), asked once a Product is
 * READY_FOR_DEPLOYMENT or already LIVE: "what should happen to this
 * product's launch or ongoing operation next." REQUEST_HUMAN_REVIEW is
 * added beyond the brief's own list for consistency — every other CEO
 * action set ends with an honest-escalation option. Every
 * recommendation must cite real claim/evidence ids; these are
 * recommendations only, never execution permissions
 * (docs/SAAS_FACTORY.md's own precedent, unchanged).
 */
export const LAUNCH_OPERATIONS_ACTIONS = [
  "LAUNCH",
  "DELAY_LAUNCH",
  "REDUCE_COST",
  "CHANGE_PRICING",
  "RUN_ACQUISITION_EXPERIMENT",
  "REQUEST_CUSTOMER_RESEARCH",
  "IMPROVE_PRODUCT",
  "PAUSE_PRODUCT",
  "KILL_PRODUCT",
  "REQUEST_HUMAN_REVIEW",
] as const;
export type LaunchOperationsAction = (typeof LAUNCH_OPERATIONS_ACTIONS)[number];

export function isLaunchOperationsAction(value: string): value is LaunchOperationsAction {
  return (LAUNCH_OPERATIONS_ACTIONS as readonly string[]).includes(value);
}
