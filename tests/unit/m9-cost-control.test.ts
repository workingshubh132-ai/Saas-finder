import { describe, expect, it } from "vitest";
import { checkCompanyBudget, DEFAULT_COMPANY_BUDGET_CEILING_USD } from "../../src/domain/company-budget/company-budget.types.js";
import { computeUtilization, isResourceCategory } from "../../src/domain/resource-allocation/resource-allocation.types.js";
import { currentPeriod } from "../../src/domain/shared/company-period.js";

describe("checkCompanyBudget — the rollup ceiling above the three existing ones (docs/M9_ARCHITECTURE_PROPOSAL.md §50)", () => {
  it("is not exceeded exactly at the ceiling, only strictly beyond it", () => {
    expect(checkCompanyBudget({ consumedUsd: DEFAULT_COMPANY_BUDGET_CEILING_USD, ceilingUsd: DEFAULT_COMPANY_BUDGET_CEILING_USD }).exceeded).toBe(false);
    expect(checkCompanyBudget({ consumedUsd: DEFAULT_COMPANY_BUDGET_CEILING_USD + 0.01, ceilingUsd: DEFAULT_COMPANY_BUDGET_CEILING_USD }).exceeded).toBe(true);
  });

  it("falls back to DEFAULT_COMPANY_BUDGET_CEILING_USD when no ceiling is given", () => {
    const result = checkCompanyBudget({ consumedUsd: 1 });
    expect(result.ceilingUsd).toBe(DEFAULT_COMPANY_BUDGET_CEILING_USD);
  });

  it("the reasoning text always names both the actual spend and the ceiling, never a vague message", () => {
    const result = checkCompanyBudget({ consumedUsd: 1000, ceilingUsd: 50 });
    expect(result.reasoning).toContain("1000.00");
    expect(result.reasoning).toContain("50.00");
  });
});

describe("computeUtilization — Resource Allocation's own consumed/allocated ratio (§23)", () => {
  it("clamps to [0, 1] — never negative, never above full utilization even if over-consumed", () => {
    expect(computeUtilization({ category: "ENGINEERING", allocated: 10, consumed: 5 })).toBeCloseTo(0.5, 10);
    expect(computeUtilization({ category: "ENGINEERING", allocated: 10, consumed: 25 })).toBe(1);
  });

  it("never divides by zero — zero allocation with zero consumption is 0% utilized, with any real consumption is fully utilized", () => {
    expect(computeUtilization({ category: "RESEARCH", allocated: 0, consumed: 0 })).toBe(0);
    expect(computeUtilization({ category: "RESEARCH", allocated: 0, consumed: 3 })).toBe(1);
  });

  it("isResourceCategory fails closed on an unknown string", () => {
    expect(isResourceCategory("LEGAL")).toBe(false);
  });
});

describe("currentPeriod — ISO-8601 week keying, Monday-start (docs/M9_ARCHITECTURE_PROPOSAL.md §50)", () => {
  it("computes the correct ISO week for known reference dates, including the year-boundary edge cases", () => {
    // 2026-09-04 (Friday) is in ISO week 36 of 2026.
    expect(currentPeriod(new Date("2026-09-04T12:00:00Z"))).toBe("2026-W36");
    // A Monday and the following Sunday fall in the same ISO week.
    expect(currentPeriod(new Date("2026-08-31T00:00:00Z"))).toBe("2026-W36");
    expect(currentPeriod(new Date("2026-09-06T23:59:59Z"))).toBe("2026-W36");
    // 2020-12-31 is ISO week 53 of 2020 (2020 has 53 ISO weeks).
    expect(currentPeriod(new Date("2020-12-31T00:00:00Z"))).toBe("2020-W53");
    // 2021-01-01 (a Friday) still falls in 2020-W53, not 2021-W01 — the classic ISO-week year-boundary trap.
    expect(currentPeriod(new Date("2021-01-01T00:00:00Z"))).toBe("2020-W53");
  });

  it("defaults to the current wall-clock time when no argument is given", () => {
    expect(currentPeriod()).toMatch(/^\d{4}-W\d{2}$/);
  });
});
