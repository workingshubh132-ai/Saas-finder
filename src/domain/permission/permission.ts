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
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
