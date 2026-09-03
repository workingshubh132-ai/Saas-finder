import { describe, expect, it } from "vitest";
import { computeCostEstimate } from "../../src/domain/product/cost-estimate.js";
import { compileDeploymentPlan, compileRollbackPlan } from "../../src/domain/product/deployment-plan.js";

describe("computeCostEstimate", () => {
  it("scales development cost with the real engineering task count", () => {
    const a = computeCostEstimate({ engineeringTaskCount: 2, externalDependencyCount: 0 });
    const b = computeCostEstimate({ engineeringTaskCount: 4, externalDependencyCount: 0 });
    expect(b.estimatedDevelopmentCostUsd).toBeGreaterThan(a.estimatedDevelopmentCostUsd);
    expect(b.estimatedDevelopmentCostUsd).toBe(a.estimatedDevelopmentCostUsd * 2);
  });

  it("scales operating cost with the real external dependency count, above a nonzero base", () => {
    const zero = computeCostEstimate({ engineeringTaskCount: 1, externalDependencyCount: 0 });
    const two = computeCostEstimate({ engineeringTaskCount: 1, externalDependencyCount: 2 });
    expect(zero.estimatedOperatingCostUsd).toBeGreaterThan(0);
    expect(two.estimatedOperatingCostUsd).toBeGreaterThan(zero.estimatedOperatingCostUsd);
  });

  it("never returns a negative estimate for zero tasks/dependencies", () => {
    const result = computeCostEstimate({ engineeringTaskCount: 0, externalDependencyCount: 0 });
    expect(result.estimatedDevelopmentCostUsd).toBe(0);
    expect(result.estimatedOperatingCostUsd).toBeGreaterThanOrEqual(0);
  });
});

describe("compileDeploymentPlan / compileRollbackPlan", () => {
  it("embeds the real architecture's own deployment strategy and health check, never a generic placeholder", () => {
    const plan = compileDeploymentPlan({ productName: "Test Product", deploymentStrategy: "A specific real strategy string", healthCheck: "GET /health returns 200" });
    expect(plan).toContain("A specific real strategy string");
    expect(plan).toContain("GET /health returns 200");
    expect(plan).toContain("PLAN only");
  });

  it("never contains language implying an actual deploy action was taken", () => {
    const plan = compileDeploymentPlan({ productName: "Test Product", deploymentStrategy: "x", healthCheck: "y" });
    expect(plan.toLowerCase()).not.toMatch(/deployed successfully|now live|deployment complete/);
  });

  it("compiles a real rollback plan naming the product", () => {
    const rollback = compileRollbackPlan({ productName: "Test Product" });
    expect(rollback).toContain("Test Product");
    expect(rollback.length).toBeGreaterThan(0);
  });
});
