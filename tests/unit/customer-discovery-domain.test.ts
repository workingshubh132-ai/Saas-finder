import { describe, expect, it } from "vitest";
import { countIndependentBusinesses } from "../../src/domain/customer-discovery/business-independence.js";
import { classifyWtp, maxWtpLevel, wtpLevelAtLeast } from "../../src/domain/customer-discovery/wtp.js";
import { CUSTOMER_VALIDATION_THRESHOLDS, evaluateCustomerValidation } from "../../src/domain/customer-discovery/validation-status.js";

describe("countIndependentBusinesses", () => {
  it("counts distinct organizations, never messages", () => {
    expect(countIndependentBusinesses(["Acme Corp", "Acme Corp", "Acme Corp"])).toBe(1);
    expect(countIndependentBusinesses(["Acme Corp", "Widgets Inc"])).toBe(2);
  });

  it("drops null/empty organizations rather than counting them as a business", () => {
    expect(countIndependentBusinesses([null, undefined, "", "  "])).toBe(0);
    expect(countIndependentBusinesses(["Acme Corp", null])).toBe(1);
  });
});

describe("classifyWtp", () => {
  it("returns NONE with no OBSERVED findings at all", () => {
    expect(classifyWtp([]).level).toBe("NONE");
    expect(classifyWtp([{ field: "PROBLEM_CONFIRMED", provenance: "INFERRED", value: "seems likely" }]).level).toBe("NONE");
  });

  it("returns WEAK for a bare OBSERVED PROBLEM_CONFIRMED", () => {
    const result = classifyWtp([{ field: "PROBLEM_CONFIRMED", provenance: "OBSERVED", value: "Yes, we deal with this weekly." }]);
    expect(result.level).toBe("WEAK");
  });

  it("returns MEDIUM for an OBSERVED FREQUENCY or VOLUME finding", () => {
    expect(classifyWtp([{ field: "FREQUENCY", provenance: "OBSERVED", value: "Every month at close." }]).level).toBe("MEDIUM");
    expect(classifyWtp([{ field: "VOLUME", provenance: "OBSERVED", value: "About 40 payments a month." }]).level).toBe("MEDIUM");
  });

  it("returns STRONG for OBSERVED existing spend, time cost, or consequence", () => {
    expect(classifyWtp([{ field: "EXISTING_SPEND", provenance: "OBSERVED", value: "We pay a bookkeeper $400/month partly for this." }]).level).toBe(
      "STRONG",
    );
    expect(classifyWtp([{ field: "TIME_COST", provenance: "OBSERVED", value: "About 8 hours a month of the ops manager's time." }]).level).toBe(
      "STRONG",
    );
  });

  it("returns VERY_STRONG only for an explicit OBSERVED willingness-to-pay statement", () => {
    const result = classifyWtp([
      { field: "EXISTING_SPEND", provenance: "OBSERVED", value: "We already pay for a tool." },
      { field: "WILLINGNESS_TO_PAY", provenance: "OBSERVED", value: "We'd pay about $50/month for this." },
    ]);
    expect(result.level).toBe("VERY_STRONG");
    expect(result.reasons[0]).toContain("$50/month");
  });

  it("never awards a level from an INFERRED or UNKNOWN finding, however strong-sounding", () => {
    const result = classifyWtp([
      { field: "WILLINGNESS_TO_PAY", provenance: "INFERRED", value: "They seem like they would probably pay for this." },
      { field: "EXISTING_SPEND", provenance: "UNKNOWN", value: "Not asked." },
    ]);
    expect(result.level).toBe("NONE");
  });

  it("picks the single highest level when multiple OBSERVED findings are present", () => {
    const result = classifyWtp([
      { field: "PROBLEM_CONFIRMED", provenance: "OBSERVED", value: "Yes." },
      { field: "FREQUENCY", provenance: "OBSERVED", value: "Monthly." },
      { field: "WILLINGNESS_TO_PAY", provenance: "OBSERVED", value: "We would pay $30/month." },
    ]);
    expect(result.level).toBe("VERY_STRONG");
  });
});

describe("wtpLevelAtLeast / maxWtpLevel", () => {
  it("ranks levels correctly", () => {
    expect(wtpLevelAtLeast("STRONG", "MEDIUM")).toBe(true);
    expect(wtpLevelAtLeast("MEDIUM", "STRONG")).toBe(false);
    expect(maxWtpLevel("WEAK", "STRONG")).toBe("STRONG");
    expect(maxWtpLevel("VERY_STRONG", "NONE")).toBe("VERY_STRONG");
  });
});

describe("evaluateCustomerValidation", () => {
  it("returns UNVALIDATED with zero confirming businesses — insufficient evidence, never a guess", () => {
    const result = evaluateCustomerValidation({
      confirmingBusinessCount: 0,
      recurringOrMeasurablePainConfirmed: false,
      bestWtpLevel: "NONE",
      disqualifyingReasons: [],
    });
    expect(result.status).toBe("UNVALIDATED");
    expect(result.evidenceGaps.length).toBeGreaterThan(0);
  });

  it("returns INTERESTING with exactly one confirming business, below the STRONG threshold", () => {
    const result = evaluateCustomerValidation({
      confirmingBusinessCount: 1,
      recurringOrMeasurablePainConfirmed: true,
      bestWtpLevel: "MEDIUM",
      disqualifyingReasons: [],
    });
    expect(result.status).toBe("INTERESTING");
  });

  it("returns INTERESTING, not STRONG, when enough businesses confirm but recurring/measurable pain is not yet established", () => {
    const result = evaluateCustomerValidation({
      confirmingBusinessCount: CUSTOMER_VALIDATION_THRESHOLDS.MIN_BUSINESSES_FOR_STRONG,
      recurringOrMeasurablePainConfirmed: false,
      bestWtpLevel: "WEAK",
      disqualifyingReasons: [],
    });
    expect(result.status).toBe("INTERESTING");
    expect(result.evidenceGaps.some((g) => /recurring/i.test(g))).toBe(true);
  });

  it("returns STRONG once enough businesses confirm recurring/measurable pain, but WTP is below the BUILD_CANDIDATE bar", () => {
    const result = evaluateCustomerValidation({
      confirmingBusinessCount: CUSTOMER_VALIDATION_THRESHOLDS.MIN_BUSINESSES_FOR_STRONG,
      recurringOrMeasurablePainConfirmed: true,
      bestWtpLevel: "MEDIUM",
      disqualifyingReasons: [],
    });
    expect(result.status).toBe("STRONG");
    expect(result.evidenceGaps.some((g) => g.includes("STRONG"))).toBe(true);
  });

  it("returns BUILD_CANDIDATE only once businesses/pain/WTP all clear their thresholds", () => {
    const result = evaluateCustomerValidation({
      confirmingBusinessCount: CUSTOMER_VALIDATION_THRESHOLDS.MIN_BUSINESSES_FOR_BUILD_CANDIDATE,
      recurringOrMeasurablePainConfirmed: true,
      bestWtpLevel: "STRONG",
      disqualifyingReasons: [],
    });
    expect(result.status).toBe("BUILD_CANDIDATE");
    expect(result.evidenceGaps).toHaveLength(0);
  });

  it("returns REJECTED whenever disqualifying evidence exists, regardless of how strong everything else looks", () => {
    const result = evaluateCustomerValidation({
      confirmingBusinessCount: 5,
      recurringOrMeasurablePainConfirmed: true,
      bestWtpLevel: "VERY_STRONG",
      disqualifyingReasons: ["2 independent businesses said they do not experience this."],
    });
    expect(result.status).toBe("REJECTED");
    expect(result.reasons).toEqual(["2 independent businesses said they do not experience this."]);
  });
});
