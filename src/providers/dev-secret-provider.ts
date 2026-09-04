import type { SecretProvider } from "../domain/ports/secret-provider.js";

/**
 * DEV_FIXTURE only (docs/M7_ARCHITECTURE_PROPOSAL.md §10, §14) — an
 * in-memory store. Nothing in M7 ever puts a real credential through
 * it: every dev provider needs zero real secrets by construction.
 */
export class DevSecretProvider implements SecretProvider {
  readonly id = "DEV_FIXTURE";
  private readonly store = new Map<string, string>();

  async get(name: string): Promise<string | null> {
    return this.store.get(name) ?? null;
  }

  async set(name: string, value: string): Promise<void> {
    this.store.set(name, value);
  }
}
