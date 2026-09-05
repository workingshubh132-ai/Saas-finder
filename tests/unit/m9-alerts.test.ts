import { describe, expect, it } from "vitest";
import { ALERT_DEDUP_WINDOW_MS, isAlertSeverity, isAlertType, sameDedupKey, withinDedupWindow } from "../../src/domain/alert/alert.types.js";

describe("Company Alert dedup (docs/M9_ARCHITECTURE_PROPOSAL.md §35 — 'avoid alert spam')", () => {
  it("sameDedupKey requires all three of (alertType, resourceType, resourceId) to match", () => {
    const key = { alertType: "ANOMALY" as const, resourceType: "PRODUCT", resourceId: "p1" };
    expect(sameDedupKey(key, { ...key })).toBe(true);
    expect(sameDedupKey(key, { ...key, alertType: "INCIDENT" })).toBe(false);
    expect(sameDedupKey(key, { ...key, resourceType: "OPPORTUNITY" })).toBe(false);
    expect(sameDedupKey(key, { ...key, resourceId: "p2" })).toBe(false);
  });

  it("withinDedupWindow is true strictly inside the 24h rolling window, false at or beyond it", () => {
    const start = new Date("2026-09-01T00:00:00Z");
    expect(withinDedupWindow(start, new Date(start.getTime() + 1))).toBe(true);
    expect(withinDedupWindow(start, new Date(start.getTime() + ALERT_DEDUP_WINDOW_MS - 1))).toBe(true);
    expect(withinDedupWindow(start, new Date(start.getTime() + ALERT_DEDUP_WINDOW_MS))).toBe(false);
    expect(withinDedupWindow(start, new Date(start.getTime() + ALERT_DEDUP_WINDOW_MS + 1))).toBe(false);
  });

  it("isAlertType / isAlertSeverity fail closed on unknown strings", () => {
    expect(isAlertType("SOLAR_FLARE")).toBe(false);
    expect(isAlertSeverity("APOCALYPTIC")).toBe(false);
    expect(isAlertType("EMERGENCY_STOP")).toBe(true);
    expect(isAlertSeverity("CRITICAL")).toBe(true);
  });
});
