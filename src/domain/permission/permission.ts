/** Capability/permission vocabulary (Constitution §7). */
export const PERMISSIONS = [
  "READ_WEB",
  "WRITE_FILES",
  "EXECUTE_CODE",
  "READ_DATABASE",
  "WRITE_DATABASE",
  "SEND_EXTERNAL_MESSAGE",
  "CREATE_EXTERNAL_ACCOUNT",
  "DEPLOY_APPLICATION",
  "SPEND_MONEY",
  "ACCESS_SECRET",
  "MODIFY_CONFIGURATION",
  // M6 (docs/M6_ARCHITECTURE_PROPOSAL.md §1, §29) — deliberately narrower
  // than WRITE_FILES/EXECUTE_CODE above, which stay YELLOW and permanently
  // ungranted: these two are structurally confined to one disposable,
  // gitignored factory workspace directory (no secrets, no network, no
  // production access), which is what actually justifies GREEN rather than
  // a loosening of the original two broader permissions.
  "WRITE_WORKSPACE_FILES",
  "RUN_WORKSPACE_COMMAND",
  // M7 (docs/M7_ARCHITECTURE_PROPOSAL.md §30) — none of these is ever
  // granted to any agent (mirroring SPEND_MONEY/SEND_EXTERNAL_MESSAGE's
  // own "declared but never granted" precedent): every M7 EXECUTE step
  // is a human-actor-only service method, never an agent tool call, so
  // no agent needs to hold any of them. Declared for classification
  // (ApprovalRequest.riskLevel values, CEO/Chairman reasoning
  // references) and so a real grant is fail-closed-DENIED rather than
  // fail-closed-UNKNOWN if anything ever tried.
  "DEPLOY_PRODUCTION",
  "CREATE_BILLING",
  "ACTIVATE_BILLING",
  "MODIFY_PRODUCTION",
  "ACCESS_PRODUCTION_DATA",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
