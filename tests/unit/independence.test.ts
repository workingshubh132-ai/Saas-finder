import { describe, expect, it } from "vitest";
import { classifyIndependence } from "../../src/domain/claim/independence.js";

describe("classifyIndependence", () => {
  it("classifies zero or one item as UNKNOWN — never certain from a single source", () => {
    expect(classifyIndependence([]).level).toBe("UNKNOWN");
    expect(classifyIndependence([{ evidenceId: "e1", source: "hacker_news", sourceType: "WEB", sourceGroupKey: "g1" }]).level).toBe("UNKNOWN");
  });

  it("classifies distinct sourceGroupKeys as KNOWN independent", () => {
    const result = classifyIndependence([
      { evidenceId: "e1", source: "hacker_news", sourceType: "WEB", sourceGroupKey: "thread-1" },
      { evidenceId: "e2", source: "hacker_news", sourceType: "WEB", sourceGroupKey: "thread-2" },
    ]);
    expect(result.level).toBe("KNOWN");
  });

  it("classifies the same sourceGroupKey as KNOWN *not* independent", () => {
    const result = classifyIndependence([
      { evidenceId: "e1", source: "hacker_news", sourceType: "WEB", sourceGroupKey: "thread-1" },
      { evidenceId: "e2", source: "hacker_news", sourceType: "WEB", sourceGroupKey: "thread-1" },
    ]);
    expect(result.level).toBe("KNOWN");
    expect(result.reasoning).toMatch(/NOT be independent/);
  });

  it("classifies different sources with no resolvable group key as LIKELY, not KNOWN", () => {
    const result = classifyIndependence([
      { evidenceId: "e1", source: "hacker_news", sourceType: "WEB", sourceGroupKey: null },
      { evidenceId: "e2", source: "stack_exchange", sourceType: "WEB", sourceGroupKey: null },
    ]);
    expect(result.level).toBe("LIKELY");
  });

  it("classifies the same source/type with no group key as UNKNOWN — never defaults to KNOWN", () => {
    const result = classifyIndependence([
      { evidenceId: "e1", source: "hacker_news", sourceType: "WEB", sourceGroupKey: null },
      { evidenceId: "e2", source: "hacker_news", sourceType: "WEB", sourceGroupKey: null },
    ]);
    expect(result.level).toBe("UNKNOWN");
  });
});
