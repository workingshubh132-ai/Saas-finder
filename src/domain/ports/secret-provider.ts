/**
 * Seam for reading/writing a provider credential
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §10, §14) — M7's own dev providers
 * need zero real secrets, so DevSecretProvider only ever stores
 * clearly-fake, clearly-labeled values. A real implementation, if ever
 * added, still never persists a credential to the database or exposes
 * it through any agent-reachable tool — it loads from process.env at
 * process start, exactly like model-provider-factory.ts already does.
 */
export interface SecretProvider {
  readonly id: string;
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
}
