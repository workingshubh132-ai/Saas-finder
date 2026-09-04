import type { DeploymentProvider } from "../domain/ports/deployment-provider.js";
import { DevDeploymentProvider } from "./dev-deployment-provider.js";

/**
 * The one place that decides which DeploymentProvider implementation
 * the runtime talks to — mirrors createModelProvider()'s own seam
 * (docs/M2_ARCHITECTURE_PROPOSAL.md §9). A single module-level
 * instance: DevDeploymentProvider holds in-memory state a later
 * status()/rollback() call must see (docs/M7_ARCHITECTURE_PROPOSAL.md
 * §7-8), so callers must always get the same instance back within one
 * process. Only DevDeploymentProvider exists in M7 — a real provider
 * would be selected here via config, exactly like
 * model-provider-factory.ts, once one is implemented and a Founder has
 * explicitly approved enabling it (brief Section 0).
 */
const instance = new DevDeploymentProvider();

export function createDeploymentProvider(): DeploymentProvider {
  return instance;
}
