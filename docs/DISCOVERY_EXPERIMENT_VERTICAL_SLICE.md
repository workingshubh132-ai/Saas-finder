# Discovery Experiment — the first real-world vertical slice

Connects VentureForge's existing, already-implemented pipeline — real
research → Signal → SignalCluster → Opportunity → ICP → Prospect →
Qualification → OutreachMessage draft → human approval — into one
callable orchestration, adding only what was genuinely missing: richer
per-prospect research output (contact-channel typing, workflow signals,
pain hypotheses) and the glue that chains the existing steps together.
No new discovery engine, no dashboard, no autonomous send.

## What already existed, reused unchanged

- `signalService`/`signalClusteringService` (M3), `problemAnalystService`
  (M3), `opportunityAnalystService`/`opportunity.service.ts` (M3/M4).
- `icpAnalystService.run()` (M5) — Opportunity → IcpProfile.
- `prospectQualificationService.run()` (M5) — Prospect → QUALIFIED/
  REJECTED/UNQUALIFIED, unmodified.
- `messageDrafterService.run()` (M5) — requires an already-`ACTIVE`
  `OutreachExperiment` and a `QUALIFIED` prospect; drafts research-only
  messages; enforces daily rate limits. Unmodified.
- `messageApprovalService.requestApproval()` / `outboundMessageService`
  (M5/Phase A) — the human gate and every governance control (approval
  binding/freshness, Emergency Stop, Company Budget, rate limits,
  idempotency, provider-mode boundary). **Zero changes.**
- `FindingProvenance` (`OBSERVED | INFERRED | UNKNOWN`,
  `src/domain/customer-discovery/provenance.ts`, added for the
  Customer Discovery + Validation layer) — reused verbatim for
  workflow signals and pain hypotheses, rather than a second taxonomy.
- `RealityLabel`/`buildRealWorldTag()` (M10) — reused verbatim.
- "Guardian" = the existing `authorizationService` gating every tool
  call (confirmed via `prospect-researcher.service.ts`'s own doc
  comment — not a separate module).

## What was genuinely missing, and is all this slice adds

1. **`prospectResearcherService`'s extraction schema had no
   industry/location/website/contact-type/workflow-signal/pain-
   hypothesis fields.** Extended additively — every existing field
   (`sourceIndex`, `organization`, `role`, `publicContactChannel`,
   `reasonForMatch`) is untouched, in meaning and in the tests that
   already covered it (all pre-existing `prospect-researcher.test.ts`
   tests still pass unmodified).
2. **No deterministic WhatsApp-verification guard existed.** Added
   (`src/domain/prospect-research/contact-type.ts`,
   `verifyContactType()`): a claimed `WHATSAPP` type is downgraded to
   `PHONE` unless the contact channel itself is a `wa.me`/
   `api.whatsapp.com` deep link, or the researcher's own extracted
   source text explicitly names WhatsApp. A phone number is never
   auto-classified as WhatsApp — checked structurally, not merely
   requested of the model.
3. **No orchestration chained discovery → qualification → draft →
   approval into one call with one structured report.** Added
   `discoveryExperimentService.run()` — glue and reporting only; it
   contains no research, qualification, or drafting logic of its own.

## Data model

One new table, `ProspectResearchProfile` (1:1 with `Prospect`, `onDelete: Cascade`):
`businessName, industry, location, website, contactType, contactSource,
decisionMaker, workflowSignals (JSON), painHypotheses (JSON),
confidence, reality, provenanceNote, createdByAgentId`. Written once,
by `prospectResearcherService`, in the same execution that creates the
`Prospect` it belongs to — no extra tool or model call. `industry`,
`location`, and `website` are always either a real value drawn from the
search-result text or the literal string `"UNKNOWN"` — never a guess
(the same "UNKNOWN" sentinel convention already used elsewhere in this
codebase, e.g. `icpAnalystService`'s honestly-ASSUMED fields).

`workflowSignals`/`painHypotheses` are JSON arrays of
`{text, provenance: OBSERVED | INFERRED | UNKNOWN}`. Confidence is
never trusted raw from the model:
`capProspectCandidateConfidence()` (`src/domain/prospect-research/confidence.ts`)
caps it at 0.4 unless at least one signal is `OBSERVED` — a candidate
backed by zero directly-observed evidence cannot report high
confidence, regardless of what the model itself claims.

## REAL vs DEV_FIXTURE

`config.researchToolMode` (`"development" | "live"`, already existed —
the exact flag the M3 source adapters key off of) decides the
`ProspectResearchProfile.reality` tag: `"live"` → `REAL`,
`"development"` (this environment's current, unconfigured state) →
`DEV_FIXTURE`. `buildRealWorldTag()` is reused for its one real
enforcement (a `REAL` tag requires a non-empty provenance note). No
fixture output is ever silently reported as `REAL` — every returned
candidate carries its actual `reality` and `provenanceNote`.

## Contact discovery (Phase 4 rules, enforced)

`Prospect.publicContactChannel` is populated exactly as before — a
real, dereferenceable public business channel (never a personal
email/phone, never guessed). `ProspectResearchProfile.contactType`/
`contactSource` add typing and provenance on top. Allowed types:
`EMAIL, CONTACT_FORM, PHONE, WHATSAPP, DIRECTORY, OTHER`.
`decisionMaker` is a public role/title only (e.g. "Owner") — the system
prompt instructs the model never to invent a private individual's name,
and no field on `Prospect` ever held a personal-name column to begin
with.

## `discoveryExperimentService.run({opportunityId, experimentId, targetCount})`

Requires the `OutreachExperiment` to already exist and already be
`ACTIVE` (a human already approved it via the existing
`outreachExperimentService.approve` — this command never creates or
approves an experiment itself; it throws if the experiment is not yet
`ACTIVE`, rather than bypassing that gate).

Orchestration, entirely by calling existing services:
1. Finds or generates the opportunity's `IcpProfile` (`icpAnalystService.run()`, only if none exists yet).
2. Calls `prospectResearcherService.run()` in a small bounded loop (at most 5 iterations, stopping immediately once a call finds zero *new* prospects — its search query is deterministic, so a repeated identical call cannot find more) until `targetCount` is reached or exhausted.
3. Calls `prospectQualificationService.run()` on every newly discovered prospect.
4. For each `QUALIFIED` prospect: `messageDrafterService.run()`, then `messageApprovalService.requestApproval()`. A single candidate's failure (e.g. a daily rate limit already hit) is caught and reported on that candidate — it never aborts the batch.
5. Assembles the report below. **No external message is ever sent by this command — `messagesSent` is always, literally, `0`.**

Report shape: `businessesResearched, signalsDiscovered, clustersTouched`
(read from the opportunity's own upstream `Problem`/`SignalCluster` —
this command does not re-run signal ingestion or clustering, which are
separate, already-existing pipelines), `prospectsDiscovered,
prospectsQualified, contactChannelsDiscovered, outreachDraftsCreated,
approvalsRequired, qualifiedCandidates[], rejectedCandidates[],
messagesSent: 0`. Every candidate in the two arrays carries its
`businessName, industry, location, website, publicContactChannel,
contactType, contactSource, decisionMaker, workflowSignals,
painHypotheses, evidence, evidenceLevel, opportunityId,
qualificationStatus, qualificationReason, confidence, reality,
provenanceNote` — fully traceable back to the `Prospect` and
`ProspectResearchProfile` rows it was built from.

## Safety (Phase 8, verified by tests, not just documentation)

1. No invented businesses — every `Prospect` still requires a real, dereferenceable `sourceUrl` (unchanged M5 rule).
2. No invented contacts — `publicContactChannel` is unchanged; `contactType` is verified, never trusted.
3. No private contact discovery — the system prompt and the existing tool boundary are unchanged; `decisionMaker` is a role/title, not a person's name.
4. No automatic external communication — `discoveryExperimentService` never imports `outboundMessageService`; `messagesSent` is a literal `0` in every report.
5. No fixture → REAL promotion — `reality` is derived once, from `config.researchToolMode`, and only ever downgrades trust, never upgrades it.
6. No evidence laundering — `capProspectCandidateConfidence()` caps confidence without an `OBSERVED` signal; `verifyContactType()` downgrades an unverified WhatsApp claim.
7. No opportunity → prospect assumption without qualification — every discovered prospect is run through the unmodified `prospectQualificationService` before any draft is attempted.
8. No WTP inference from public research — nothing in this slice writes a `WILLINGNESS_TO_PAY`-signal-type `CustomerEvidence`; that remains exclusively the Customer Discovery + Validation layer's own, post-contact concern.
9. No customer validation from prospect qualification — `customerValidationService` (commit `6264ffc`) is untouched and untriggered by this slice.
10. No automatic BUILD decision — this slice never touches `Opportunity.validationLevel` or any CEO/Chairman recommendation.

## Files

- `src/domain/prospect-research/{contact-type,confidence}.ts` (new).
- `src/services/prospect-researcher.service.ts` — additive extension only.
- `src/services/discovery-experiment.service.ts` (new).
- `src/db/repositories/prospect-research-profile.repository.ts` (new).
- `src/api/routes/discovery-experiments.routes.ts`, mounted in `src/api/app.ts`.
- `prisma/migrations/20260906061132_discovery_vertical_slice/`.
- Tests: `tests/unit/prospect-research-domain.test.ts`, `tests/integration/discovery-experiment.test.ts`, plus additive cases in `tests/integration/prospect-researcher.test.ts`.

## Exact next command for an operator

```
POST /api/discovery-experiments/run
{ "opportunityId": "...", "experimentId": "...", "targetCount": 5 }
```

Requires the experiment to already be `ACTIVE`
(`outreachExperimentService.create` then `.approve`, both unchanged,
human-gated). Returns the report above. Approving and sending any
resulting drafted message remains a fully separate, human-gated step
through the unmodified `messageApprovalService`/`outboundMessageService`.
