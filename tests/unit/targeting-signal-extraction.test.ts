import { describe, expect, it } from "vitest";
import { classifyExperimentDiscoveryOutcome } from "../../src/domain/customer-response/experiment-outcome.js";
import { extractTargetingSignals, selectTechnologySignal } from "../../src/domain/icp-profile/extract-targeting-signals.js";

describe("extractTargetingSignals", () => {
  it("finds a directly-named platform as EVIDENCED, grounded in the evidence id that named it", () => {
    const signals = extractTargetingSignals([
      { id: "ev-1", text: "Small business owners on Xero's community report payment reconciliation issues." },
    ]);

    const platformSignal = signals.find((s) => s.category === "PLATFORM" && s.label === "Xero");
    expect(platformSignal).toBeDefined();
    expect(platformSignal!.provenance).toBe("EVIDENCED");
    expect(platformSignal!.groundedEvidenceIds).toEqual(["ev-1"]);
  });

  it("2. one named platform generalizes to its category as INFERRED, never EVIDENCED, however many times that SAME platform is mentioned", () => {
    const signals = extractTargetingSignals([
      { id: "ev-1", text: "Xero users report reconciliation problems." },
      { id: "ev-2", text: "Another Xero thread about the same reconciliation issue." },
      { id: "ev-3", text: "A third Xero discussion, same complaint." },
    ]);

    const categorySignal = signals.find((s) => s.category === "WORKFLOW" && s.label.includes("Accounting/bookkeeping"));
    expect(categorySignal).toBeDefined();
    expect(categorySignal!.provenance).toBe("INFERRED"); // 3 mentions of the SAME platform never upgrade this to EVIDENCED
    expect(categorySignal!.groundedEvidenceIds.sort()).toEqual(["ev-1", "ev-2", "ev-3"]);

    // Design Requirement B's explicit UNKNOWN caveat must accompany the INFERRED generalization.
    const unknownSignal = signals.find((s) => s.provenance === "UNKNOWN" && s.label.includes("other than Xero"));
    expect(unknownSignal).toBeDefined();
    expect(unknownSignal!.groundedEvidenceIds).toEqual([]); // an UNKNOWN caveat cites no direct evidence by definition
  });

  it("promotes the category to EVIDENCED only when a SECOND, distinct platform in the same category is independently named", () => {
    const signals = extractTargetingSignals([
      { id: "ev-1", text: "Xero users report reconciliation problems." },
      { id: "ev-2", text: "QuickBooks users report the exact same reconciliation problem, unrelated thread." },
    ]);

    const categorySignal = signals.find((s) => s.category === "WORKFLOW" && s.label.includes("Accounting/bookkeeping"));
    expect(categorySignal).toBeDefined();
    expect(categorySignal!.provenance).toBe("EVIDENCED"); // two independently-named platforms is itself direct evidence for the category
    expect(categorySignal!.groundedEvidenceIds.sort()).toEqual(["ev-1", "ev-2"]);

    // No UNKNOWN caveat is needed once the category itself is directly evidenced.
    expect(signals.some((s) => s.provenance === "UNKNOWN")).toBe(false);
  });

  it("finds workflow/operational signals genuinely described in evidence text, without inventing anything absent from it", () => {
    const signals = extractTargetingSignals([
      { id: "ev-1", text: "Bank payments don't reliably match invoices/customers because names and amounts can differ." },
      { id: "ev-2", text: "Several invoices for different customers share the same amount and get mismatched during reconciliation." },
    ]);

    expect(signals.some((s) => s.label === "Payment/account reconciliation workflow" && s.provenance === "EVIDENCED")).toBe(true);
    expect(signals.some((s) => s.label === "Businesses with multiple invoices/customers to track" && s.provenance === "EVIDENCED")).toBe(true);
    expect(signals.some((s) => s.label === "Businesses receiving bank payments/transfers directly" && s.provenance === "EVIDENCED")).toBe(true);
    // Nothing in the input mentions bookkeeping specifically — must not be invented.
    expect(signals.some((s) => s.label === "Bookkeeping/accounting operations")).toBe(false);
  });

  it("returns an empty array — never a fabricated signal — when evidence text matches no known vocabulary", () => {
    const signals = extractTargetingSignals([{ id: "ev-1", text: "Customers keep losing track of their gym membership renewal dates." }]);
    expect(signals).toEqual([]);
    expect(selectTechnologySignal(signals)).toBeNull();
  });

  it("selectTechnologySignal prefers EVIDENCED over INFERRED, and never returns an ASSUMED/UNKNOWN entry", () => {
    const signals = extractTargetingSignals([
      { id: "ev-1", text: "Xero users and QuickBooks users both report reconciliation problems in unrelated threads." },
    ]);
    const selected = selectTechnologySignal(signals);
    expect(selected).not.toBeNull();
    expect(selected!.provenance).toBe("EVIDENCED");
  });
});

describe("classifyExperimentDiscoveryOutcome", () => {
  it("7. zero analyzed responses is NO_RESPONSE, never PROBLEM_NOT_PRESENT — silence is a distribution signal, not disconfirmation", () => {
    expect(classifyExperimentDiscoveryOutcome([])).toBe("NO_RESPONSE");
    expect(classifyExperimentDiscoveryOutcome([{ status: "RECEIVED", classification: null, signalTypes: [] }])).toBe("NO_RESPONSE");
  });

  it("classifies a directly-described pain response as PROBLEM_PRESENT", () => {
    const outcome = classifyExperimentDiscoveryOutcome([{ status: "ANALYZED", classification: "POSITIVE_SIGNAL", signalTypes: ["PAIN"] }]);
    expect(outcome).toBe("PROBLEM_PRESENT");
  });

  it("classifies an already-uses-a-workaround response as ALREADY_SOLVED, not PROBLEM_PRESENT", () => {
    const outcome = classifyExperimentDiscoveryOutcome([{ status: "ANALYZED", classification: "NEUTRAL", signalTypes: ["CURRENT_WORKAROUND"] }]);
    expect(outcome).toBe("ALREADY_SOLVED");
  });

  it("classifies an explicit non-interest response with no pain signal as PROBLEM_NOT_PRESENT", () => {
    const outcome = classifyExperimentDiscoveryOutcome([{ status: "ANALYZED", classification: "NOT_INTERESTED", signalTypes: [] }]);
    expect(outcome).toBe("PROBLEM_NOT_PRESENT");
  });

  it("classifies a genuinely ambiguous response as OTHER, never forced into a stronger claim", () => {
    const outcome = classifyExperimentDiscoveryOutcome([{ status: "ANALYZED", classification: "UNCLEAR", signalTypes: [] }]);
    expect(outcome).toBe("OTHER");
  });
});
