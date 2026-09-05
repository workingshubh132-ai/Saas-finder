import { describe, expect, it } from "vitest";
import { isPortfolioBucket, mapBusinessHealthToPortfolioBucket, PORTFOLIO_BUCKETS } from "../../src/domain/company-state/company-state.types.js";

const BUSINESS_HEALTH_STATES = ["UNKNOWN", "EARLY", "PROMISING", "HEALTHY", "STAGNATING", "DECLINING", "CRITICAL"];

describe("mapBusinessHealthToPortfolioBucket — Constitution §19's vocabulary restated for a company-wide read (docs/M9_ARCHITECTURE_PROPOSAL.md §22)", () => {
  it("maps every real BusinessHealth.state to exactly one PORTFOLIO_BUCKETS value, never throwing", () => {
    for (const state of BUSINESS_HEALTH_STATES) {
      expect(PORTFOLIO_BUCKETS).toContain(mapBusinessHealthToPortfolioBucket(state));
    }
  });

  it("HEALTHY is the only state mapping to WINNERS, matching the M8 dev fixture's own HEALTHY -> SCALE rule", () => {
    expect(mapBusinessHealthToPortfolioBucket("HEALTHY")).toBe("WINNERS");
    for (const state of BUSINESS_HEALTH_STATES) {
      if (state === "HEALTHY") continue;
      expect(mapBusinessHealthToPortfolioBucket(state)).not.toBe("WINNERS");
    }
  });

  it("CRITICAL maps to KILL_CANDIDATES", () => {
    expect(mapBusinessHealthToPortfolioBucket("CRITICAL")).toBe("KILL_CANDIDATES");
  });

  it("EARLY and UNKNOWN both fall back to UNCERTAIN, never a fabricated confident bucket", () => {
    expect(mapBusinessHealthToPortfolioBucket("EARLY")).toBe("UNCERTAIN");
    expect(mapBusinessHealthToPortfolioBucket("UNKNOWN")).toBe("UNCERTAIN");
  });

  it("an unrecognized state also falls back to UNCERTAIN rather than throwing", () => {
    expect(mapBusinessHealthToPortfolioBucket("SOME_FUTURE_STATE")).toBe("UNCERTAIN");
  });

  it("isPortfolioBucket fails closed on an unknown string", () => {
    expect(isPortfolioBucket("SLEEPER_HITS")).toBe(false);
  });
});
