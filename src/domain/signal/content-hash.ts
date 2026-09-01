import { createHash } from "node:crypto";

/** The exact-duplicate key (docs/M3_ARCHITECTURE_PROPOSAL.md §5) — same hashing primitive as domain/shared/tokens.ts. */
export function computeContentHash(title: string, content: string): string {
  return createHash("sha256").update(`${title.trim()}\n${content.trim()}`).digest("hex");
}
