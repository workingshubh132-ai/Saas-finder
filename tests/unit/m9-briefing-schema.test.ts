import { describe, expect, it } from "vitest";
import { briefingContentSchema, briefingStatementSchema, isEmptyBriefing } from "../../src/domain/briefing/briefing.types.js";

const EMPTY_SECTIONS = {
  COMPANY: [],
  PORTFOLIO: [],
  REVENUE: [],
  GROWTH: [],
  RISKS: [],
  OPPORTUNITIES: [],
  EXPERIMENTS: [],
  DECISIONS_REQUIRED: [],
  CEO_TOP_RECOMMENDATIONS: [],
  CHAIRMAN_CONCERNS: [],
  LESSONS_FROM_LAST_PERIOD: [],
};

describe("briefingStatementSchema — every important statement must be evidence-backed (docs/M9_ARCHITECTURE_PROPOSAL.md §46)", () => {
  it("rejects a statement with an empty citedIds array — prose with nothing real to cite cannot be constructed", () => {
    expect(() => briefingStatementSchema.parse({ statement: "Revenue is strong.", citedIds: [] })).toThrow();
  });

  it("accepts a statement citing at least one real id", () => {
    const parsed = briefingStatementSchema.parse({ statement: "Revenue is strong.", citedIds: ["product-1"] });
    expect(parsed.citedIds).toEqual(["product-1"]);
  });

  it("rejects an empty statement string, even with real citedIds", () => {
    expect(() => briefingStatementSchema.parse({ statement: "", citedIds: ["x"] })).toThrow();
  });
});

describe("briefingContentSchema — the eleven-section structure plus status (§46)", () => {
  it("accepts every section empty with status NO_ACTION_REQUIRED — a real, honest, valid output (M9 brief §36)", () => {
    const parsed = briefingContentSchema.parse({ ...EMPTY_SECTIONS, status: "NO_ACTION_REQUIRED" });
    expect(parsed.status).toBe("NO_ACTION_REQUIRED");
  });

  it("rejects status ACTION_REQUIRED paired with any other made-up status string", () => {
    expect(() => briefingContentSchema.parse({ ...EMPTY_SECTIONS, status: "URGENT" })).toThrow();
  });

  it("rejects a whole section missing entirely, never silently defaulting it to empty", () => {
    const { COMPANY: _omitted, ...withoutCompany } = EMPTY_SECTIONS;
    expect(() => briefingContentSchema.parse({ ...withoutCompany, status: "NO_ACTION_REQUIRED" })).toThrow();
  });
});

describe("isEmptyBriefing", () => {
  it("is true exactly when DECISIONS_REQUIRED is empty, regardless of every other section", () => {
    expect(isEmptyBriefing({ DECISIONS_REQUIRED: [] })).toBe(true);
    expect(isEmptyBriefing({ DECISIONS_REQUIRED: [{ statement: "x", citedIds: ["y"] }] })).toBe(false);
  });
});
