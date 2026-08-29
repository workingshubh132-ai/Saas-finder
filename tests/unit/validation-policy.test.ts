import { describe, expect, it } from "vitest";
import {
  checkValidationLevelRequirement,
  VALIDATION_LEVEL_REQUIREMENTS,
  type EvidenceSummaryItem,
} from "../../src/domain/opportunity/validation-policy.js";

const noEvidence: EvidenceSummaryItem[] = [];
const oneWeak: EvidenceSummaryItem[] = [{ sourceType: "WEB", reliability: "LOW", confidence: 0.3 }];
const twoMedium: EvidenceSummaryItem[] = [
  { sourceType: "WEB", reliability: "MEDIUM", confidence: 0.5 },
  { sourceType: "MARKET_DATA", reliability: "MEDIUM", confidence: 0.5 },
];
const strongCustomer: EvidenceSummaryItem[] = [
  { sourceType: "CUSTOMER", reliability: "HIGH", confidence: 0.9 },
  { sourceType: "CUSTOMER", reliability: "HIGH", confidence: 0.85 },
  { sourceType: "MARKET_DATA", reliability: "HIGH", confidence: 0.9 },
];
const twoExperiments: EvidenceSummaryItem[] = [
  { sourceType: "EXPERIMENT", reliability: "HIGH", confidence: 0.9 },
  { sourceType: "EXPERIMENT", reliability: "HIGH", confidence: 0.85 },
  { sourceType: "CUSTOMER", reliability: "HIGH", confidence: 0.9 },
  { sourceType: "MARKET_DATA", reliability: "HIGH", confidence: 0.9 },
  { sourceType: "MARKET_DATA", reliability: "HIGH", confidence: 0.9 },
];

describe("validation level policy — never lets weak evidence satisfy a higher level", () => {
  it("LEVEL_0 is always satisfied, even with zero evidence", () => {
    expect(checkValidationLevelRequirement(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_0, noEvidence).satisfied).toBe(true);
  });

  it("LEVEL_1 requires at least one evidence record", () => {
    expect(checkValidationLevelRequirement(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_1, noEvidence).satisfied).toBe(false);
    expect(checkValidationLevelRequirement(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_1, oneWeak).satisfied).toBe(true);
  });

  it("LEVEL_2 rejects a single weak record but accepts two medium-confidence records", () => {
    const single = checkValidationLevelRequirement(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_2, oneWeak);
    expect(single.satisfied).toBe(false);
    expect(single.reasons.some((r) => r.includes("evidence record"))).toBe(true);

    expect(checkValidationLevelRequirement(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_2, twoMedium).satisfied).toBe(true);
  });

  it("LEVEL_3 requires MARKET_DATA/COMPETITOR-type evidence specifically", () => {
    const customerOnly: EvidenceSummaryItem[] = [
      { sourceType: "CUSTOMER", reliability: "HIGH", confidence: 0.8 },
      { sourceType: "CUSTOMER", reliability: "HIGH", confidence: 0.8 },
    ];
    const result = checkValidationLevelRequirement(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_3, customerOnly);
    expect(result.satisfied).toBe(false);
    expect(result.reasons.some((r) => r.includes("MARKET_DATA"))).toBe(true);

    expect(checkValidationLevelRequirement(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_3, twoMedium).satisfied).toBe(true);
  });

  it("LEVEL_4 requires CUSTOMER evidence at MEDIUM+ reliability", () => {
    const lowReliabilityCustomer: EvidenceSummaryItem[] = [
      { sourceType: "CUSTOMER", reliability: "LOW", confidence: 0.6 },
      { sourceType: "MARKET_DATA", reliability: "MEDIUM", confidence: 0.6 },
    ];
    expect(checkValidationLevelRequirement(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_4, lowReliabilityCustomer).satisfied).toBe(false);

    const okCustomer: EvidenceSummaryItem[] = [
      { sourceType: "CUSTOMER", reliability: "MEDIUM", confidence: 0.6 },
      { sourceType: "MARKET_DATA", reliability: "MEDIUM", confidence: 0.6 },
    ];
    expect(checkValidationLevelRequirement(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_4, okCustomer).satisfied).toBe(true);
  });

  it("LEVEL_5 requires HIGH-reliability customer evidence and three records total", () => {
    expect(checkValidationLevelRequirement(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_5, twoMedium).satisfied).toBe(false);
    expect(checkValidationLevelRequirement(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_5, strongCustomer).satisfied).toBe(true);
  });

  it("LEVEL_6 requires at least one EXPERIMENT-type record", () => {
    expect(checkValidationLevelRequirement(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_6, strongCustomer).satisfied).toBe(false);
    expect(checkValidationLevelRequirement(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_6, twoExperiments).satisfied).toBe(true);
  });

  it("LEVEL_7 and LEVEL_8 require two EXPERIMENT-type records, not one", () => {
    const oneExperiment: EvidenceSummaryItem[] = [
      { sourceType: "EXPERIMENT", reliability: "HIGH", confidence: 0.9 },
      { sourceType: "CUSTOMER", reliability: "HIGH", confidence: 0.9 },
      { sourceType: "MARKET_DATA", reliability: "HIGH", confidence: 0.9 },
      { sourceType: "MARKET_DATA", reliability: "HIGH", confidence: 0.9 },
    ];
    const result = checkValidationLevelRequirement(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_7, oneExperiment);
    expect(result.satisfied).toBe(false);
    expect(result.reasons.some((r) => r.includes("EXPERIMENT"))).toBe(true);

    expect(checkValidationLevelRequirement(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_7, twoExperiments).satisfied).toBe(true);
    expect(checkValidationLevelRequirement(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_8, twoExperiments).satisfied).toBe(true);
  });

  it("reports every unmet condition at once, not just the first", () => {
    const result = checkValidationLevelRequirement(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_5, noEvidence);
    expect(result.reasons.length).toBeGreaterThan(1);
  });

  it("only LEVEL_4 and above require a human actor; only LEVEL_5 and above require Chairman approval", () => {
    expect(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_3.requiresHumanActor).toBe(false);
    expect(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_4.requiresHumanActor).toBe(true);
    expect(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_4.requiresChairmanApproval).toBe(false);
    expect(VALIDATION_LEVEL_REQUIREMENTS.LEVEL_5.requiresChairmanApproval).toBe(true);
  });
});
