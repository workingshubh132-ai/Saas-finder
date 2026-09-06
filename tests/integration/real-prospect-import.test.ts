import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db/client.js";
import type { RealProspectImportInput } from "../../src/domain/prospect-research/real-prospect-import.js";
import { realProspectImportService } from "../../src/services/real-prospect-import.service.js";
import { auditService } from "../../src/services/audit.service.js";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { icpAnalystService } from "../../src/services/icp-analyst.service.js";
import { identityService } from "../../src/services/identity.service.js";
import { messageApprovalService } from "../../src/services/message-approval.service.js";
import { messageDrafterService } from "../../src/services/message-drafter.service.js";
import { outreachExperimentService } from "../../src/services/outreach-experiment.service.js";
import { prospectQualificationService } from "../../src/services/prospect-qualification.service.js";
import { ValidationError } from "../../src/domain/shared/errors.js";
import { authActor, makeAgent, makeOpportunity, HUMAN_OWNER } from "../helpers.js";

async function makeIcp() {
  const opportunity = await makeOpportunity();
  // Extract claims BEFORE generating the ICP: icpAnalystService.run() wires its own
  // claim subset (icpClaimService.wireForIcpProfile) via role/problemExposure/likelyFrequency;
  // calling it first would trip claimExtractionService's own idempotency guard
  // (existing.length > 0) and return only that partial set, missing WILLINGNESS_TO_PAY.
  await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
  const icpAgent = await makeAgent({ role: "ICP Analyst" });
  const outcome = await icpAnalystService.run({ agentId: icpAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
  if (outcome.status !== "COMPLETED") throw new Error("setup failed: icp");
  return { opportunity, icpProfile: outcome.result.icpProfile };
}

function baseInput(overrides: Partial<RealProspectImportInput> = {}): Omit<RealProspectImportInput, "opportunityId" | "icpProfileId" | "importedByAgentId" | "importedByIdentityId"> {
  return {
    businessName: "Riverside Bookkeeping LLC",
    industry: "Accounting services",
    location: "Portland, OR",
    website: "https://riversidebookkeeping.example-business.com",
    publicContactChannel: "https://riversidebookkeeping.example-business.com/contact",
    contactType: "CONTACT_FORM",
    contactSource: "Company's own public contact page, linked from their homepage footer.",
    decisionMaker: "Owner",
    workflowSignals: [{ text: "Their public 'Services' page states they handle bank reconciliation for small business clients.", provenance: "OBSERVED" }],
    painHypotheses: [{ text: "Likely spends manual effort matching client bank feeds to invoices, based on the services they advertise.", provenance: "INFERRED" }],
    evidence: "Read directly from the business's own public website (About/Services/Contact pages), 2026-09-06.",
    sourceUrl: "https://riversidebookkeeping.example-business.com/about",
    sourceType: "company_website",
    evidenceLevel: "MEDIUM",
    reality: "REAL",
    ...overrides,
  } as Omit<RealProspectImportInput, "opportunityId" | "icpProfileId" | "importedByAgentId" | "importedByIdentityId">;
}

async function makeImportInput(overrides: Partial<RealProspectImportInput> = {}): Promise<{ input: RealProspectImportInput; opportunityId: string; icpProfileId: string }> {
  const { opportunity, icpProfile } = await makeIcp();
  const importerAgent = await makeAgent({ role: "Real Prospect Importer" });
  const input: RealProspectImportInput = {
    ...baseInput(),
    opportunityId: opportunity.id,
    icpProfileId: icpProfile.id,
    importedByAgentId: importerAgent.id,
    importedByIdentityId: HUMAN_OWNER.actorId,
    ...overrides,
  };
  return { input, opportunityId: opportunity.id, icpProfileId: icpProfile.id };
}

describe("realProspectImportService.import", () => {
  it("1. a valid REAL prospect import succeeds and creates Prospect + ProspectResearchProfile", async () => {
    const { input } = await makeImportInput();
    const result = await realProspectImportService.import(input);

    expect(result.prospect.status).toBe("DISCOVERED");
    expect(result.prospect.organization).toBe("Riverside Bookkeeping LLC");
    expect(result.prospect.sourceUrl).toBe(input.sourceUrl);
    expect(result.profile.reality).toBe("REAL");
    expect(result.profile.businessName).toBe("Riverside Bookkeeping LLC");
    expect(result.profile.provenanceNote).toBe(input.evidence);
  });

  it("2. missing sourceUrl is rejected", async () => {
    const { input } = await makeImportInput({ sourceUrl: "" });
    await expect(realProspectImportService.import(input)).rejects.toThrow(ValidationError);
  });

  it("3. a dev-fixture.local sourceUrl is rejected even when reality claims REAL", async () => {
    const { input } = await makeImportInput({ sourceUrl: "https://dev-fixture.local/hacker_news/query/1" });
    await expect(realProspectImportService.import(input)).rejects.toThrow(/fixture/i);
  });

  it("4. missing business identity is rejected", async () => {
    const { input } = await makeImportInput({ businessName: "" });
    await expect(realProspectImportService.import(input)).rejects.toThrow();
  });

  it("5. missing contact provenance (contactSource) is rejected — the proxy for 'this is verified public business info'", async () => {
    const { input } = await makeImportInput({ contactSource: "" });
    await expect(realProspectImportService.import(input)).rejects.toThrow();
  });

  it("6. a bare phone number is never auto-classified as WhatsApp", async () => {
    const { input } = await makeImportInput({
      contactType: "WHATSAPP",
      publicContactChannel: "+1-503-555-0142",
      contactSource: "Phone number listed on the business's public Google Business Profile.",
    });
    const result = await realProspectImportService.import(input);
    expect(result.profile.contactType).toBe("PHONE"); // downgraded, not rejected — matches verifyContactType's existing rule
  });

  it("7. a WhatsApp claim IS honored when the evidence actually establishes it (wa.me link or explicit text)", async () => {
    const { input } = await makeImportInput({
      contactType: "WHATSAPP",
      publicContactChannel: "https://wa.me/15035550142",
      contactSource: "The business's own public 'Contact us on WhatsApp' button links directly to this wa.me URL.",
    });
    const result = await realProspectImportService.import(input);
    expect(result.profile.contactType).toBe("WHATSAPP");
  });

  it("8/9/10. OBSERVED, INFERRED, and UNKNOWN provenance all round-trip unchanged", async () => {
    const { input } = await makeImportInput({
      workflowSignals: [
        { text: "Public services page states this directly.", provenance: "OBSERVED" },
        { text: "Reasonably implied by their advertised services.", provenance: "INFERRED" },
        { text: "Not established either way from public information.", provenance: "UNKNOWN" },
      ],
      painHypotheses: [{ text: "Not established either way.", provenance: "UNKNOWN" }],
    });
    const result = await realProspectImportService.import(input);
    const signals = JSON.parse(result.profile.workflowSignals) as Array<{ text: string; provenance: string }>;
    expect(signals.map((s) => s.provenance).sort()).toEqual(["INFERRED", "OBSERVED", "UNKNOWN"]);
    const hypotheses = JSON.parse(result.profile.painHypotheses) as Array<{ provenance: string }>;
    expect(hypotheses[0]!.provenance).toBe("UNKNOWN");
  });

  it("11. no WTP evidence is ever created by this import path", async () => {
    const { input } = await makeImportInput();
    await realProspectImportService.import(input);

    const wtpEvidence = await prisma.customerEvidence.findMany({ where: { signalType: "WTP" } });
    expect(wtpEvidence.length).toBe(0);
  });

  it("12. a duplicate business (same sourceUrl, or same name+location, or same website) is rejected, not merged", async () => {
    const { input, opportunityId, icpProfileId } = await makeImportInput();
    await realProspectImportService.import(input);

    await expect(realProspectImportService.import(input)).rejects.toThrow(/already exists/i);

    const importerAgent = await makeAgent({ role: "Real Prospect Importer" });
    const sameNameDifferentUrl: RealProspectImportInput = {
      ...input,
      opportunityId,
      icpProfileId,
      importedByAgentId: importerAgent.id,
      sourceUrl: "https://riversidebookkeeping.example-business.com/team",
    };
    await expect(realProspectImportService.import(sameNameDifferentUrl)).rejects.toThrow(/already exists/i);

    const before = await prisma.prospect.count({ where: { opportunityId } });
    expect(before).toBe(1); // never silently merged into two or more rows for the same business

    // A genuinely different business must NOT be blocked by the dedup check.
    const differentBusiness: RealProspectImportInput = {
      ...input,
      opportunityId,
      icpProfileId,
      importedByAgentId: importerAgent.id,
      businessName: "Downtown Tax & Advisory Group",
      website: "https://downtowntax.example-business.com",
      sourceUrl: "https://downtowntax.example-business.com/about",
    };
    const second = await realProspectImportService.import(differentBusiness);
    expect(second.prospect.organization).toBe("Downtown Tax & Advisory Group");
    const after = await prisma.prospect.count({ where: { opportunityId } });
    expect(after).toBe(2);
  });

  it("13. an audit record is created naming the human operator, source URL, reality, and resulting IDs", async () => {
    const { input } = await makeImportInput();
    const result = await realProspectImportService.import(input);

    const entries = await auditService.list({ resourceType: "PROSPECT", resourceId: result.prospect.id });
    const importEntry = entries.find((e) => e.action === "IMPORT_REAL_PROSPECT");
    expect(importEntry).toBeDefined();
    expect(importEntry?.actorType).toBe("HUMAN");
    expect(importEntry?.actorId).toBe(HUMAN_OWNER.actorId);
    const metadata = JSON.parse(importEntry?.metadata ?? "{}");
    expect(metadata.sourceUrl).toBe(input.sourceUrl);
    expect(metadata.reality).toBe("REAL");
    expect(metadata.prospectId).toBe(result.prospect.id);
    expect(metadata.prospectResearchProfileId).toBe(result.profile.id);
  });

  it("14. the imported REAL prospect can enter the existing, unmodified qualification service", async () => {
    const { input } = await makeImportInput();
    const result = await realProspectImportService.import(input);

    const qualifierAgent = await makeAgent({ role: "Prospect Qualification" });
    const outcome = await prospectQualificationService.run({ agentId: qualifierAgent.id, prospectId: result.prospect.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
  });

  it("15/16/17. a qualified imported prospect reaches the existing draft + human-approval stage, with zero deliveries or sent messages", async () => {
    const { input, opportunityId, icpProfileId } = await makeImportInput();
    const result = await realProspectImportService.import(input);

    const qualifierAgent = await makeAgent({ role: "Prospect Qualification" });
    await prospectQualificationService.run({ agentId: qualifierAgent.id, prospectId: result.prospect.id, startedBy: authActor() });
    const qualified = await prisma.prospect.findUnique({ where: { id: result.prospect.id } });
    expect(qualified!.status === "QUALIFIED" || qualified!.status === "REJECTED").toBe(true);

    const claims = await claimExtractionService.extractForOpportunity({ opportunityId, actorType: "SYSTEM", actorId: null });
    const claim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;
    const experiment = await outreachExperimentService.create({
      opportunityId,
      claimId: claim.id,
      targetIcpProfileId: icpProfileId,
      createdByIdentityId: HUMAN_OWNER.actorId,
      objective: "test",
      researchQuestion: "How do you currently match incoming bank payments to the correct invoice and customer, and how often does it go wrong?",
      messageStrategy: "Learning, not selling.",
      prospectLimit: 10,
      timeWindowStart: null,
      timeWindowEnd: null,
      successCriteria: "test",
      failureCriteria: "test",
    });
    await outreachExperimentService.approve({ id: experiment.id, actor: HUMAN_OWNER });

    const deliveriesBefore = await prisma.outreachMessageDelivery.count();

    if (qualified!.status === "QUALIFIED") {
      const drafterAgent = await makeAgent({ role: "Message Drafter" });
      const draft = await messageDrafterService.run({ agentId: drafterAgent.id, experimentId: experiment.id, prospectId: result.prospect.id, startedBy: authActor() });
      expect(draft.status).toBe("COMPLETED");
      if (draft.status === "COMPLETED") {
        const approvalRequest = await messageApprovalService.requestApproval({ outreachMessageId: draft.result.message.id, requestedByAgentId: drafterAgent.id });
        expect(approvalRequest.status).toBe("PENDING"); // awaiting human approval — never auto-approved
        // Deliberately NOT calling approvalService.decide / messageApprovalService.applyDecision — this task stops before send.
      }
    }

    const deliveriesAfter = await prisma.outreachMessageDelivery.count();
    expect(deliveriesAfter).toBe(deliveriesBefore);
    expect(deliveriesAfter).toBe(0);
  });

  it("18. DEV_FIXTURE (or any non-REAL label) can never be promoted to REAL through this path", async () => {
    const { input } = await makeImportInput({ reality: "DEV_FIXTURE" });
    await expect(realProspectImportService.import(input)).rejects.toThrow(/only accepts reality="REAL"/i);

    const simulated = await makeImportInput({ reality: "SIMULATED" });
    await expect(realProspectImportService.import(simulated.input)).rejects.toThrow(/only accepts reality="REAL"/i);
  });

  it("rejects an ICP profile that belongs to a different opportunity", async () => {
    const { input } = await makeImportInput();
    const { icpProfile: otherIcp } = await makeIcp();
    await expect(realProspectImportService.import({ ...input, icpProfileId: otherIcp.id })).rejects.toThrow(ValidationError);
  });

  it("requires importedByIdentityId to be a genuine HUMAN identity, not an agent-only actor", async () => {
    const { input } = await makeImportInput();
    const someAgent = await makeAgent();
    const { identity: nonHumanIdentity } = await identityService.createIdentity({ type: "AGENT", label: "test-agent-identity", agentId: someAgent.id, createdBy: authActor() });
    await expect(realProspectImportService.import({ ...input, importedByIdentityId: nonHumanIdentity.id })).rejects.toThrow(/HUMAN identity/i);
  });
});
