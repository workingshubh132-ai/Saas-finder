import type { SecretProvider } from "../domain/ports/secret-provider.js";
import { DevSecretProvider } from "./dev-secret-provider.js";

/** Mirrors deployment-provider-factory.ts. Only DevSecretProvider exists in M7 (docs/M7_ARCHITECTURE_PROPOSAL.md §10). */
const instance = new DevSecretProvider();

export function createSecretProvider(): SecretProvider {
  return instance;
}
