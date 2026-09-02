# Customer Discovery Intelligence

M5. Moves the system from PUBLIC EVIDENCE → OPPORTUNITY → VALIDATION
(M3-M4) to REAL CUSTOMER EVIDENCE → CUSTOMER VALIDATION → UPDATED
THESIS — five new agents, two new hard human gates, and the same
unmodified M4 Evidence Validator/CEO/Chairman/memo machinery, now fed
real customer responses alongside public evidence. Full rationale in
`docs/M5_ARCHITECTURE_PROPOSAL.md`; the specific decisions this build
made along the way are in `docs/DECISIONS.md` #43-49.

## The hard boundary this whole milestone answers to

VentureForge must never autonomously send an email, DM, or message of
any kind; never spend money, purchase a lead list, or create an
external account; never bypass a platform restriction or scrape
prohibited/private data; never mass-message; never negotiate or accept
payment. It may research from permitted public sources, identify
candidate ICPs, generate prospect lists, draft messages, and recommend
next actions — the send/accept/negotiate step always belongs to the
Human Owner. This is not a policy statement trusted to hold — see
"Structural, not just policy" below for how it's actually enforced.
Full 16-category review: `docs/SECURITY.md`, M5 section.

## The pipeline

```
Opportunity/Claims (M3-M4, unchanged)
  → ICP Analyst                         (who to talk to)
  → Prospect Researcher                 (real candidates, real provenance)
  → Prospect Qualification              (does this one fit)
  → OutreachExperiment.approve()        ── HARD GATE 1 (Human Owner)
  → Message Drafter                     (drafts, never sends)
  → ApprovalRequest (RED) → applyDecision → markContacted
                                         ── HARD GATE 2 (Human Owner, twice:
                                            approve the text, then confirm
                                            it was actually sent by them)
  → CustomerResponse (human pastes it in)
  → Response Analyst                    (classify + extract CustomerEvidence)
  → Evidence Validator (M4, unmodified) (signal-routed, filtered pool)
  → Claim confidence recalculation (M4, unmodified)
  → CEO.recommendCustomerDiscoveryAction
  → Chairman.review (extended)
  → CustomerDiscoveryMemo.compile → recordHumanDecision
```

## ICP Analyst — `src/services/icp-analyst.service.ts`

Zero tool calls (`ICP_ANALYST_BUDGET.maxToolCalls: 0`) — synthesizes
industry/companySize/role/problemExposure/likelyFrequency/geography/
technology/exclusions from an opportunity's own claims and evidence,
never from nothing. Every field carries a `fieldGrounding` entry
(`EVIDENCED` + real claim ids, or `ASSUMED` + an empty list) — never
invented specificity. Historized: every run creates a new `IcpProfile`
row, never overwrites an earlier targeting decision. `icpClaimService.wireForIcpProfile`
wires role/problemExposure/likelyFrequency back into real `Claim` rows,
idempotently (`extractedFrom: "ICP_PROFILE.<id>.<field>"` dedup key).

## Prospect Researcher + Qualification

`prospect-researcher.service.ts` (`PROSPECT_RESEARCHER_BUDGET.maxToolCalls: 1`)
— the same Guardian-gated, read-only `SourceSearchTool` the Competitor
Analyst already uses; never a new harvesting capability. Anti-spoofing:
the model reports a `sourceIndex` into the search results it was
actually given, never a raw URL string — an out-of-range index or a
result with no real URL is silently dropped rather than trusted.
Deduplicates by `sourceUrl` across runs. No personal-contact field
exists on `Prospect` at all — `publicContactChannel` is documented and
reviewed as business-public-only.

`prospect-qualification.service.ts` (zero tool calls) — never a bare
score: `qualificationStatus` (`QUALIFIED`/`REJECTED`/`UNQUALIFIED`) +
`icpFit` + a real `reasonForMatch` + an honest `unknowns` list.
`qualificationStatus` and the coarser lifecycle `status` are
deliberately two different fields, not redundant (`docs/DECISIONS.md`
#46) — both `REJECTED` and `UNQUALIFIED` collapse to lifecycle
`status: "REJECTED"`, but a human reading the record still sees which
one it was.

## The two hard gates

**Gate 1 — `outreachExperimentService.approve`.** `OutreachExperiment`
starts `PENDING_APPROVAL`; only a verified `HUMAN` actor
(`assertHumanActor`) can move it to `ACTIVE`. No message may be drafted
before this. `DEFAULT_OUTREACH_LIMITS` (`src/domain/outreach-experiment/outreach-limits.ts`)
— `maxProspectsPerExperiment: 25`, `maxMessagesPerExperimentPerDay: 10`,
`maxMessagesPerDestinationSourcePerDay: 5`, `maxActiveExperimentsPerOpportunity: 3`
— checked in application code *before* creating the next
`Prospect`/`OutreachMessage`, never a client-side convention.

**Gate 2 — message approval, `message-approval.service.ts`.**
`messageDrafterService` drafts (zero tool calls, requires the
experiment `ACTIVE` and the prospect `QUALIFIED`; computes a real
Expected Information Gain via M4's own unmodified `computeExpectedInformationGain`;
moves the prospect `QUALIFIED → APPROVED_FOR_DRAFT → DRAFT_READY`).
`requestApproval` creates a `RED`-risk `ApprovalRequest` (stricter than
M4's `KILL` at `ORANGE` — this is the first M1-M5 action touching a
real person outside the system) bound to the exact message id.
`applyDecision` turns a decided request into `APPROVED_TO_CONTACT`/
`REJECTED`. `markContacted` — Human-Owner-only record-keeping,
re-verifies the bound `ApprovalRequest` is actually `APPROVED` and
still points at this exact message, never trusts `message.status`
alone — confirms the Human Owner personally sent the already-approved
text through their own channel. **There is no programmatic send
capability anywhere in this codebase for it to trigger.**

## Structural, not just policy

- `SEND_EXTERNAL_MESSAGE` (declared since M1) has exactly two
  references in `src/` — its own two declaration sites — and zero
  grant call sites, ever.
- `outreach-message.repository.ts` exposes `create`/`findById`/
  `listForExperiment`/`countFor*`/`updateStatus`/`attachApprovalRequest`/
  `markContacted` only — no method anywhere can change `content`,
  `prospectId`, `experimentId`, or `reasoning` once a message exists.
- ICP Analyst, Prospect Qualification, Message Drafter, and Response
  Analyst hold **zero** permission grants, matching the CEO's own
  precedent — each additionally has `maxToolCalls: 0`, so even a fully
  "successful" prompt injection against one of their model calls can
  only change a field's *wording*, never trigger a tool call.

## Response ingestion + Response Analyst — the third untrusted-input category

`customerResponseService.record` — Human-Owner-only manual transcription
(brief's own explicit "no connector, human pastes it in" allowance);
requires the message already `CONTACTED`. `response-analyst.service.ts`
(zero tool calls) classifies into `POSITIVE_SIGNAL`/`NEGATIVE_SIGNAL`/
`NEUTRAL`/`QUESTION`/`OBJECTION`/`REQUEST_FOR_DETAILS`/`INTEREST`/
`NOT_INTERESTED`/`NOISE`/`UNCLEAR` — `UNCLEAR` is a first-class, honest
outcome, never forced positive or negative. `rawContent` is placed only
in the `messages` array passed to the model, never the `systemPrompt`;
a dedicated test seeds a literal prompt-injection string and asserts
zero tool calls resulted. `relatedClaimType` is force-cleared to `null`
in code for every extraction except an `OBJECTION`, regardless of what
a compromised model call claims — structural enforcement of "never
treat interest as payment intent," not a prompt instruction alone.

## Signal-type routing — the milestone's most safety-critical table

`src/domain/customer-evidence/signal-routing.ts`:
`CUSTOMER_SIGNAL_ELIGIBLE_CLAIM_TYPES` maps each `CustomerSignalType`
to the `ClaimType`s it may ever validate (e.g. `INTEREST` →
`CUSTOMER_PROBLEM` only, never `WILLINGNESS_TO_PAY`; `OBJECTION`'s
eligibility instead follows its own per-extraction `relatedClaimType`).
Enforced in `evidence-validator.service.ts` by **removing** ineligible
customer evidence from the candidate pool *before* the Validator's
prompt is even built — a structural filter, not a prompt instruction a
model could drift on. `evidenceValidatorService` is otherwise the
exact, unmodified M4 component: it does not know or care whether an
`Evidence` row came from a customer response or a web search.

Independence (`domain/claim/independence.ts`) gained `organizationKey`
alongside the existing `sourceGroupKey` — two responses from the same
prospect's *organization* are one organization's worth of
corroboration, never two independent customers, mirroring
`sourceGroupKey`'s own precedent exactly. (A real vacuous-`KNOWN`
regression here was caught by this build's own dedicated unit tests
before shipping — see `docs/DECISIONS.md`/the independence test suite.)

## CEO + Chairman — the same components, a second question

`ceoReasoningService.recommendCustomerDiscoveryAction` — a second,
distinct entry point on the same agent row and `ceo_recommendations`
table M4 already uses, asking "what customer-discovery step is worth
taking next" rather than M4's "what should happen to this opportunity."
Five actions (not the brief's literal seven — `docs/DECISIONS.md`,
M5 proposal §33): `RUN_CUSTOMER_DISCOVERY`, `TEST_CLAIM`, `REFINE_ICP`,
`STOP_EXPERIMENT` (fires once an active experiment collects
`negativeCount >= 3` **and** `independentOrganizations >= 3` — counted
from distinct prospect *organizations*, not raw response count), and
`REQUEST_HUMAN_REVIEW`. Recommends only — it never itself creates an
`OutreachExperiment`, even for `RUN_CUSTOMER_DISCOVERY`
(`docs/DECISIONS.md` #47).

`chairmanService.review` gained real customer-discovery inputs (active
experiment, responses, independent-organization count, customer
evidence, the latest customer-discovery-flavored CEO recommendation)
and three new adversarial checks: customer evidence supporting a
`WILLINGNESS_TO_PAY` claim whose `signalType` isn't `WTP`/
`CURRENT_SPENDING` (verifying the routing table actually held, not
assuming it did); ≥2 responses from ≤1 independent organization (weak
corroboration); negative/`NOT_INTERESTED` responses the CEO's own
reasoning doesn't appear to account for.

## Customer Discovery Memo — `customer-discovery-memo.service.ts`

Compiled with **zero new model calls**, mirroring `investmentMemoService.compile`
exactly — every field pulled from already-persisted data: prospects
contacted, responses (raw + classification), independent-organization
count, problem/WTP/urgency/negative evidence text (grouped by
`CustomerSignalType`), claims strengthened/weakened (a claim counts as
strengthened when its current status is `SUPPORTED` *and* customer
evidence is part of what supports it in its latest `ValidationReport`;
weakened analogously for `CONTRADICTED`/`WEAK`/`CONFLICTED`), remaining
uncertainty (every contacted prospect's own `unknowns`), the CEO's and
Chairman's own verdicts, and `human: "PENDING"` until
`recordHumanDecision` (`APPROVE`/`REJECT`/`MORE_RESEARCH`/`REFINE_ICP`/
`STOP`, idempotent, Human-Owner-only) is called.

## Calibration

`calibrationService.summarizeCustomerDiscovery()` — the exact same
`summarizeCalibration` bucketing function M4's own calibration uses
(`domain/decision/calibration.ts`), now also fed
`CustomerDiscoveryMemo.confidence` vs. `.humanDecision` (positive label
`"APPROVE"`, passed explicitly rather than assumed —
`docs/DECISIONS.md` #49). A memo with `humanDecision: null` (not yet
decided) is excluded, not treated as "not approved." Read-only; never
feeds back into any scoring formula or prompt automatically.
`GET /api/customer-discovery-memos/calibration-summary`.

## API

`icp-profiles` (`GET /:id`, `POST /` runs the analyst),
`prospects` (`GET /:id`, `POST /` runs the researcher, `POST /:id/qualify`,
`POST /:id/do-not-contact` — Human-Owner-only, the one explicit way to
pull a prospect out of the pipeline at any point),
`outreach-experiments` (`GET /:id`, `GET /:id/messages`, `POST /`,
`POST /:id/approve` — gate 1, `POST /:id/status`; every route here is
Human-Owner-only, the one M5 router that doesn't split reads from the
privileged gate — a deliberate, documented asymmetry, not an oversight:
`docs/SECURITY.md`/`docs/DECISIONS.md` #43),
`outreach-messages` (`GET /:id`, `POST /` drafts, `POST /:id/request-approval`,
`POST /apply-decision`, `POST /:id/mark-contacted` — gate 2),
`customer-responses` (`GET /:id`, `POST /` records — Human-Owner-only,
`POST /:id/analyze` runs the Response Analyst),
`customer-discovery-memos` (`GET /calibration-summary`, `GET /:id`,
`POST /` compiles, `POST /:id/decide` — Human-Owner-only), plus
`opportunities` sub-resources (`/icp-profiles`, `/prospects`,
`/outreach-experiments`, `/customer-discovery-memos`,
`/customer-evidence`, `POST /:id/ceo-customer-discovery-recommendation`).
No route in this codebase exposes any capability that could send an
external message — confirmed by `tests/integration/api-m5.test.ts`.

## Testing

331 tests across 66 files, including two mandatory end-to-end capstone
tests (`tests/integration/m5-end-to-end.test.ts`) driving the full real
pipeline — no mocked services, no hardcoded outcomes: a positive path
(real spending-language response → `WILLINGNESS_TO_PAY` genuinely
`SUPPORTED`, confidence increases, CEO never recommends `STOP_EXPERIMENT`)
and a negative path (3 independent organizations each independently say
they wouldn't pay → claim genuinely `CONTRADICTED`, confidence
decreases, CEO recommends `STOP_EXPERIMENT`, Chairman independently
`REJECT`s, human `STOP`s).
