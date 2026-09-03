import type { Permission } from "../permission/permission.js";
import type { RiskLevel } from "./risk-level.js";

/**
 * Starting risk classification for each permission — the concrete
 * answer to "action -> risk level" (Constitution §6). This is a
 * founding POLICY decision, not derived logic, and the Constitution
 * does not map these 11 permissions to the 4 autonomy levels 1:1
 * itself (its examples are broader activities, e.g. "external
 * outreach", not permission names). Every mapping below is justified
 * in docs/DECISIONS.md and is expected to be reviewed by the founder
 * (see "Decisions requiring founder approval" in the M1 report).
 *
 * Nothing else in the codebase should hardcode a risk level for an
 * action — always resolve it through getPermissionRiskLevel.
 */
export const PERMISSION_RISK_LEVEL: Readonly<Record<Permission, RiskLevel>> = {
  // GREEN — internal, reversible, matches Constitution §8 GREEN examples
  // (research, evidence collection, opportunity discovery, monitoring).
  READ_WEB: "GREEN",
  READ_DATABASE: "GREEN",
  WRITE_DATABASE: "GREEN",
  // M6 (docs/M6_ARCHITECTURE_PROPOSAL.md §1) — GREEN because their blast
  // radius is structurally confined to one disposable factory workspace
  // directory, never VentureForge's own filesystem/secrets/network/
  // production. WRITE_FILES/EXECUTE_CODE below stay YELLOW unchanged —
  // this is a narrower, separately-justified capability, not a loosening
  // of those two.
  WRITE_WORKSPACE_FILES: "GREEN",
  RUN_WORKSPACE_COMMAND: "GREEN",

  // YELLOW — external-facing or meaningfully resource-consuming, matches
  // §8 YELLOW examples (external outreach, external account creation,
  // major deployment) or is a conservative default for a broad
  // capability grant (EXECUTE_CODE, WRITE_FILES) pending founder review.
  EXECUTE_CODE: "YELLOW",
  WRITE_FILES: "YELLOW",
  SEND_EXTERNAL_MESSAGE: "YELLOW",
  CREATE_EXTERNAL_ACCOUNT: "YELLOW",
  DEPLOY_APPLICATION: "YELLOW",

  // ORANGE — sensitive infrastructure/security surface, matches §8
  // ORANGE's "significant infrastructure changes".
  ACCESS_SECRET: "ORANGE",
  MODIFY_CONFIGURATION: "ORANGE",

  // RED — irreversible external commitment by default, matches §8 RED's
  // "major financial transfers". M2 may tier this by amount; M1 keeps
  // it conservative and uniform (Constitution §21, Capital Discipline).
  SPEND_MONEY: "RED",
};

export function getPermissionRiskLevel(permission: Permission): RiskLevel {
  return PERMISSION_RISK_LEVEL[permission];
}
