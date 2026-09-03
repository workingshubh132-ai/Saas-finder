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
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
