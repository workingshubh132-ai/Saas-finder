import { describe, expect, it } from "vitest";
import { computeExpectedInformationGain } from "../../src/domain/claim/eig.js";
import { computeAggregateConfidence } from "../../src/domain/claim/opportunity-confidence.js";

describe("computeExpectedInformationGain", () => {
  it("worked example: high-impact/low-cost/high-uncertainty scores high", () => {
    const eig = computeExpectedInformationGain({ importance: "CRITICAL", status: "UNVERIFIED", normalizedResearchCost: 0.1 });
    expect(eig).toBeGreaterThan(0.6);
  });

  it("worked example: low-impact/medium-cost scores low", () => {
    const eig = computeExpectedInformationGain({ importance: "LOW", status: "SUPPORTED", normalizedResearchCost: 0.5 });
    expect(eig).toBeLessThan(0.2);
  });

  it("a CRITICAL claim always outranks a LOW claim at the same status/cost", () => {
    const critical = computeExpectedInformationGain({ importance: "CRITICAL", status: "WEAK", normalizedResearchCost: 0.3 });
    const low = computeExpectedInformationGain({ importance: "LOW", status: "WEAK", normalizedResearchCost: 0.3 });
    expect(critical).toBeGreaterThan(low);
  });

  it("UNVERIFIED and INSUFFICIENT_EVIDENCE carry equal, maximal uncertainty", () => {
    const unverified = computeExpectedInformationGain({ importance: "HIGH", status: "UNVERIFIED", normalizedResearchCost: 0.3 });
    const insufficient = computeExpectedInformationGain({ importance: "HIGH", status: "INSUFFICIENT_EVIDENCE", normalizedResearchCost: 0.3 });
    expect(unverified).toBe(insufficient);
  });

  it("a confidently resolved claim (SUPPORTED/CONTRADICTED) scores lower than an equally important unresolved one", () => {
    const resolved = computeExpectedInformationGain({ importance: "HIGH", status: "SUPPORTED", normalizedResearchCost: 0.3 });
    const unresolved = computeExpectedInformationGain({ importance: "HIGH", status: "UNVERIFIED", normalizedResearchCost: 0.3 });
    expect(resolved).toBeLessThan(unresolved);
  });

  it("higher research cost lowers EIG, all else equal", () => {
    const cheap = computeExpectedInformationGain({ importance: "MEDIUM", status: "WEAK", normalizedResearchCost: 0.1 });
    const expensive = computeExpectedInformationGain({ importance: "MEDIUM", status: "WEAK", normalizedResearchCost: 0.9 });
    expect(cheap).toBeGreaterThan(expensive);
  });
});

describe("computeAggregateConfidence", () => {
  it("returns null for zero claims — never fabricates a figure from nothing", () => {
    expect(computeAggregateConfidence([])).toBeNull();
  });

  it("weights CRITICAL claims far more heavily than LOW claims", () => {
    const mostlyLowHighConfidence = computeAggregateConfidence([
      { importance: "CRITICAL", confidence: 0.1 },
      { importance: "LOW", confidence: 0.9 },
      { importance: "LOW", confidence: 0.9 },
      { importance: "LOW", confidence: 0.9 },
    ]);
    // Even outnumbered 3:1 by high-confidence LOW claims, one low-confidence
    // CRITICAL claim should still pull the aggregate well below the LOW claims' own confidence.
    expect(mostlyLowHighConfidence).not.toBeNull();
    expect(mostlyLowHighConfidence as number).toBeLessThan(0.7);
  });

  it("a single claim's aggregate equals its own confidence", () => {
    expect(computeAggregateConfidence([{ importance: "HIGH", confidence: 0.65 }])).toBeCloseTo(0.65);
  });
});
