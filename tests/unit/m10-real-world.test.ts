import { describe, expect, it } from "vitest";
import { buildRealWorldTag, isRealityLabel, isRealWorldExperimentStatus, parseRealWorldTag } from "../../src/domain/real-world/reality.types.js";

describe("RealityLabel (docs/M10_REAL_WORLD_BOUNDARY.md)", () => {
  it("accepts exactly the four defined labels", () => {
    expect(isRealityLabel("REAL")).toBe(true);
    expect(isRealityLabel("DEV_FIXTURE")).toBe(true);
    expect(isRealityLabel("HUMAN_ACTION")).toBe(true);
    expect(isRealityLabel("SIMULATED")).toBe(true);
    expect(isRealityLabel("FAKE")).toBe(false);
  });
});

describe("buildRealWorldTag", () => {
  it("refuses a REAL tag with an empty provenance note", () => {
    expect(() => buildRealWorldTag({ reality: "REAL", experimentId: null, note: "" })).toThrow();
    expect(() => buildRealWorldTag({ reality: "REAL", experimentId: null, note: "   " })).toThrow();
  });

  it("refuses a HUMAN_ACTION tag with an empty provenance note", () => {
    expect(() => buildRealWorldTag({ reality: "HUMAN_ACTION", experimentId: null, note: "" })).toThrow();
  });

  it("allows an empty note for DEV_FIXTURE/SIMULATED — no real-world claim to substantiate", () => {
    expect(() => buildRealWorldTag({ reality: "DEV_FIXTURE", experimentId: null, note: "" })).not.toThrow();
    expect(() => buildRealWorldTag({ reality: "SIMULATED", experimentId: null, note: "" })).not.toThrow();
  });

  it("constructs a valid REAL tag with a real note", () => {
    const tag = buildRealWorldTag({ reality: "REAL", experimentId: "exp_1", note: "Sourced via WebSearch." });
    expect(tag).toEqual({ reality: "REAL", experimentId: "exp_1", note: "Sourced via WebSearch." });
  });
});

describe("parseRealWorldTag", () => {
  it("round-trips a tag embedded under metadata.realWorld", () => {
    const tag = buildRealWorldTag({ reality: "REAL", experimentId: "exp_1", note: "test" });
    const metadata = { points: 42, realWorld: tag };
    expect(parseRealWorldTag(metadata)).toEqual(tag);
  });

  it("returns null for metadata with no realWorld key — never throws on pre-M10 data", () => {
    expect(parseRealWorldTag({ points: 42 })).toBeNull();
    expect(parseRealWorldTag(null)).toBeNull();
    expect(parseRealWorldTag("not an object")).toBeNull();
  });

  it("returns null for a malformed realWorld value rather than throwing", () => {
    expect(parseRealWorldTag({ realWorld: { reality: "NOT_A_LABEL", experimentId: null, note: "x" } })).toBeNull();
    expect(parseRealWorldTag({ realWorld: { reality: "REAL", experimentId: 42, note: "x" } })).toBeNull();
    expect(parseRealWorldTag({ realWorld: "a string, not an object" })).toBeNull();
  });
});

describe("RealWorldExperimentStatus", () => {
  it("accepts exactly RUNNING/COMPLETED/ABANDONED", () => {
    expect(isRealWorldExperimentStatus("RUNNING")).toBe(true);
    expect(isRealWorldExperimentStatus("COMPLETED")).toBe(true);
    expect(isRealWorldExperimentStatus("ABANDONED")).toBe(true);
    expect(isRealWorldExperimentStatus("PAUSED")).toBe(false);
  });
});
