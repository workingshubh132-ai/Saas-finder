import { describe, expect, it } from "vitest";
import { verifyContactType } from "../../src/domain/prospect-research/contact-type.js";
import { capProspectCandidateConfidence } from "../../src/domain/prospect-research/confidence.js";

describe("verifyContactType — WhatsApp verification rules", () => {
  it("A. a phone number is NOT automatically classified as WhatsApp", () => {
    const result = verifyContactType({
      claimedType: "WHATSAPP",
      contactSource: "Phone number listed on the business's public contact page.",
      publicContactChannel: "+1-555-0100",
    });
    expect(result).toBe("PHONE");
  });

  it("B. WHATSAPP is verified when the contact channel itself is a wa.me deep link", () => {
    const result = verifyContactType({
      claimedType: "WHATSAPP",
      contactSource: "Contact button on the business homepage.",
      publicContactChannel: "https://wa.me/15550100",
    });
    expect(result).toBe("WHATSAPP");
  });

  it("C. WHATSAPP is verified when the source text explicitly names WhatsApp", () => {
    const result = verifyContactType({
      claimedType: "WHATSAPP",
      contactSource: "The business's contact page has a labeled WhatsApp button.",
      publicContactChannel: "+1-555-0100",
    });
    expect(result).toBe("WHATSAPP");
  });

  it("D. a claimed EMAIL/PHONE/CONTACT_FORM/DIRECTORY/OTHER type passes through unchanged", () => {
    expect(verifyContactType({ claimedType: "EMAIL", contactSource: "Contact page.", publicContactChannel: "info@example.com" })).toBe("EMAIL");
    expect(verifyContactType({ claimedType: "CONTACT_FORM", contactSource: "Website contact form.", publicContactChannel: "https://example.com/contact" })).toBe("CONTACT_FORM");
  });

  it("E. an unrecognized claimed type falls back to OTHER rather than throwing", () => {
    expect(verifyContactType({ claimedType: "CARRIER_PIGEON", contactSource: "x", publicContactChannel: "y" })).toBe("OTHER");
  });
});

describe("capProspectCandidateConfidence", () => {
  it("caps confidence at 0.4 when no item is OBSERVED", () => {
    expect(capProspectCandidateConfidence(0.95, [{ provenance: "INFERRED" }, { provenance: "UNKNOWN" }])).toBeLessThanOrEqual(0.4);
    expect(capProspectCandidateConfidence(0.95, [])).toBeLessThanOrEqual(0.4);
  });

  it("allows a higher confidence, still capped at 0.9, once at least one item is OBSERVED", () => {
    expect(capProspectCandidateConfidence(0.95, [{ provenance: "OBSERVED" }])).toBeLessThanOrEqual(0.9);
    expect(capProspectCandidateConfidence(0.7, [{ provenance: "OBSERVED" }, { provenance: "INFERRED" }])).toBe(0.7);
  });

  it("never returns a value outside [0, 0.9]", () => {
    expect(capProspectCandidateConfidence(-1, [{ provenance: "OBSERVED" }])).toBeGreaterThanOrEqual(0);
    expect(capProspectCandidateConfidence(5, [{ provenance: "OBSERVED" }])).toBeLessThanOrEqual(0.9);
  });
});
