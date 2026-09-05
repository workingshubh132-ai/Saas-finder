import { describe, expect, it } from "vitest";
import { BUILD_GATE_MINIMUM_LEVEL, classifyValidationLevel, isCustomerValidationLevel, meetsLevel } from "../../src/domain/real-world/validation-threshold.js";

describe("classifyValidationLevel (docs/M10_REAL_WORLD_AUDIT.md brief Part 11)", () => {
  it("never treats generic positive interest above MEDIUM, even with enthusiastic classification", () => {
    expect(classifyValidationLevel({ classification: "POSITIVE_SIGNAL", describesCurrentWorkaround: false, agreedToTrial: false, agreedToPay: false })).toBe("MEDIUM");
  });

  it("returns WEAK for a NOT_INTERESTED / NOISE / UNCLEAR response with no other signal", () => {
    expect(classifyValidationLevel({ classification: "NOT_INTERESTED", describesCurrentWorkaround: false, agreedToTrial: false, agreedToPay: false })).toBe("WEAK");
    expect(classifyValidationLevel({ classification: "NOISE", describesCurrentWorkaround: false, agreedToTrial: false, agreedToPay: false })).toBe("WEAK");
  });

  it("requires the explicit describesCurrentWorkaround fact for STRONG — classification alone cannot reach it", () => {
    expect(classifyValidationLevel({ classification: "REQUEST_FOR_DETAILS", describesCurrentWorkaround: false, agreedToTrial: false, agreedToPay: false })).toBe("MEDIUM");
    expect(classifyValidationLevel({ classification: "REQUEST_FOR_DETAILS", describesCurrentWorkaround: true, agreedToTrial: false, agreedToPay: false })).toBe("STRONG");
  });

  it("agreeing to a trial outranks describing a workaround, and agreeing to pay outranks both", () => {
    expect(classifyValidationLevel({ classification: "INTEREST", describesCurrentWorkaround: true, agreedToTrial: true, agreedToPay: false })).toBe("VERY_STRONG");
    expect(classifyValidationLevel({ classification: "INTEREST", describesCurrentWorkaround: true, agreedToTrial: true, agreedToPay: true })).toBe("EXTREMELY_STRONG");
  });

  it("meetsLevel is a correct, non-strict ordinal comparison", () => {
    expect(meetsLevel("EXTREMELY_STRONG", BUILD_GATE_MINIMUM_LEVEL)).toBe(true);
    expect(meetsLevel("VERY_STRONG", BUILD_GATE_MINIMUM_LEVEL)).toBe(true);
    expect(meetsLevel("STRONG", BUILD_GATE_MINIMUM_LEVEL)).toBe(false);
    expect(meetsLevel("WEAK", "WEAK")).toBe(true);
  });

  it("isCustomerValidationLevel rejects an unknown string", () => {
    expect(isCustomerValidationLevel("VERY_STRONG")).toBe(true);
    expect(isCustomerValidationLevel("SUPER_STRONG")).toBe(false);
  });
});
