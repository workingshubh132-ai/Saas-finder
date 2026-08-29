import "dotenv/config";

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  /**
   * Allow-list of identities permitted to act as the Human Owner
   * (review approvals, grant agent permissions). Fails closed: with no
   * identities configured, the kernel refuses to start rather than let
   * every caller through. See docs/SECURITY.md.
   */
  humanOwnerIds: parseList(process.env.HUMAN_OWNER_IDS),
} as const;

export function assertConfigValid(): void {
  if (config.humanOwnerIds.length === 0) {
    throw new Error(
      "HUMAN_OWNER_IDS must name at least one Human Owner identity (see .env.example). Refusing to start.",
    );
  }
}
