import { describe, expect, it } from "vitest";
import { textSimilarity, tokenize } from "../../src/domain/signal/similarity.js";

describe("textSimilarity", () => {
  it("returns 1 for identical text", () => {
    expect(textSimilarity("Small business invoicing is a pain", "Small business invoicing is a pain")).toBe(1);
  });

  it("returns a high score for near-identical text (case/punctuation differences)", () => {
    const score = textSimilarity("Small business invoicing is a pain!", "small business invoicing is a pain");
    expect(score).toBeGreaterThan(0.9);
  });

  it("returns 0 for completely unrelated text", () => {
    const score = textSimilarity("Small business invoicing workflow", "Rocket propulsion telemetry systems");
    expect(score).toBe(0);
  });

  it("returns a value strictly between 0 and 1 for partially overlapping text", () => {
    const score = textSimilarity("small business invoicing is painful", "small business payroll is painful too");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("handles empty strings without dividing by zero", () => {
    expect(textSimilarity("", "")).toBe(1);
    expect(textSimilarity("something", "")).toBe(0);
  });

  it("tokenize is case-insensitive and strips punctuation", () => {
    expect(tokenize("Hello, World!")).toEqual(new Set(["hello", "world"]));
  });
});
