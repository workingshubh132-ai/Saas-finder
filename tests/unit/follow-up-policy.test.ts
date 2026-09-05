import { describe, expect, it } from "vitest";
import { checkFollowUpEligibility, MAX_FOLLOW_UPS, MIN_FOLLOW_UP_DELAY_MS } from "../../src/domain/autonomous-operations/follow-up-policy.js";

const NOW = new Date("2026-01-15T00:00:00.000Z");

describe("checkFollowUpEligibility", () => {
  it("is eligible with no prior messages and no response yet", () => {
    const result = checkFollowUpEligibility({ priorMessageCount: 0, lastSentAt: null, latestResponseClassification: null, now: NOW });
    expect(result.eligible).toBe(true);
  });

  it(`is eligible at exactly the ${MAX_FOLLOW_UPS}-message bound`, () => {
    const result = checkFollowUpEligibility({ priorMessageCount: MAX_FOLLOW_UPS, lastSentAt: null, latestResponseClassification: null, now: NOW });
    expect(result.eligible).toBe(true);
  });

  it(`is ineligible once priorMessageCount exceeds ${MAX_FOLLOW_UPS}`, () => {
    const result = checkFollowUpEligibility({ priorMessageCount: MAX_FOLLOW_UPS + 1, lastSentAt: null, latestResponseClassification: null, now: NOW });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/follow-up bound/);
  });

  it.each(["NOT_INTERESTED", "NEGATIVE_SIGNAL", "OBJECTION"] as const)("is ineligible after a %s response — treated as an explicit stop signal", (classification) => {
    const result = checkFollowUpEligibility({ priorMessageCount: 1, lastSentAt: null, latestResponseClassification: classification, now: NOW });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain(classification);
  });

  it.each(["POSITIVE_SIGNAL", "NEUTRAL", "QUESTION"] as const)("is not stopped by a %s response — only the three named classifications stop contact", (classification) => {
    const result = checkFollowUpEligibility({ priorMessageCount: 1, lastSentAt: null, latestResponseClassification: classification, now: NOW });
    expect(result.eligible).toBe(true);
  });

  it("is ineligible before the minimum delay has elapsed since the last send", () => {
    const lastSentAt = new Date(NOW.getTime() - (MIN_FOLLOW_UP_DELAY_MS - 60 * 60 * 1000));
    const result = checkFollowUpEligibility({ priorMessageCount: 1, lastSentAt, latestResponseClassification: null, now: NOW });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/minimum delay/i);
  });

  it("is eligible once the minimum delay has fully elapsed", () => {
    const lastSentAt = new Date(NOW.getTime() - (MIN_FOLLOW_UP_DELAY_MS + 60 * 60 * 1000));
    const result = checkFollowUpEligibility({ priorMessageCount: 1, lastSentAt, latestResponseClassification: null, now: NOW });
    expect(result.eligible).toBe(true);
  });

  it("checks the follow-up bound before the stop-classification check", () => {
    const result = checkFollowUpEligibility({ priorMessageCount: MAX_FOLLOW_UPS + 1, lastSentAt: null, latestResponseClassification: "NOT_INTERESTED", now: NOW });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/follow-up bound/);
  });
});
