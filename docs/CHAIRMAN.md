# Chairman

M2. The first implementation of the Constitution's Chairman role
(§4, §13, §15–16): a genuinely adversarial review of a proposed
opportunity, not a second CEO/agent agreeing with itself. M1 explicitly
had no Chairman (`DECISIONS.md` #10) — ORANGE/RED decisions routed
straight to the Human Owner, with `RiskPolicy.requiresChairman` merely
recorded as metadata for a future workflow to consume. This is that
workflow's first, real form.

## What it does — and, as importantly, what it never does

`chairmanService.review({ opportunityId, reviewedBy })`
(`src/services/chairman.service.ts`):

1. Loads the opportunity, its full evidence list, and its latest score
   record.
2. Builds a prompt (`buildReviewPrompt`) that hands the model
   everything it needs — title, problem, target customer, description,
   current opportunity/confidence scores, validation level, and every
   evidence item with its source type, reliability, and confidence.
3. Calls `ModelProvider.complete()` (`AGENT_RUNTIME.md`'s
   `createModelProvider()` — same provider-agnostic seam), requiring a
   structured `ChairmanDecision` response, validated through the same
   `completeWithValidation()` (`services/model-output.ts`) that the
   Research Agent uses: one bounded corrective retry if the first
   response fails schema validation, then a hard `ModelError`.
4. Persists a `ChairmanReview` row (`decision`, `reasoning`,
   `objections[]`, `missingEvidence[]`, `confidence`, `recommendation`,
   plus which model/provider produced it) and an audit entry
   (`CHAIRMAN_REVIEW_<decision>`).

**It never decides the `ApprovalRequest`.** `chairmanService.review`
does not touch `ApprovalRequest` at all — proven directly in
`tests/integration/chairman.test.ts`'s "cannot override the Human
Owner" test, which reviews an opportunity with a pending approval
request and asserts the request is still `PENDING`, still
`reviewedBy: null`, afterward. The review is *input* the Human
Decision Queue surfaces alongside the requester's own case
(`decisionQueueService.enrich`, extended in M2 to attach the latest
`ChairmanReview`) — the Human Owner remains the only actor who can
actually move an `ApprovalRequest` (`SECURITY.md`).

It is also not an `AgentExecution` — there is no tool use, no
multi-step pipeline, so the full Agent Runtime (budgets,
`WAITING_FOR_TOOL`, step counting) doesn't apply here; it is one
bounded model call (plus at most one corrective retry) with its own
narrower shape.

## Why the schema itself makes a rubber stamp structurally impossible

```ts
const chairmanDecisionSchema = z.object({
  decision: z.enum(CHAIRMAN_DECISIONS), // APPROVE | REJECT | REQUEST_MORE_EVIDENCE | DEFER | ESCALATE_TO_HUMAN
  reasoning: z.string().min(1),
  objections: z.array(z.string().min(1)).min(1),   // ← always at least one
  missingEvidence: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  recommendation: z.string().min(1),
});
```

`objections` has `.min(1)` — a response with zero objections fails
schema validation and triggers the corrective retry, then a hard
error if it still comes back empty. The system prompt
(`CHAIRMAN_SYSTEM_PROMPT`) states this directly: "Record your
objections even if you ultimately recommend approval — never return
zero objections," alongside the five adversarial questions the
Constitution requires the Chairman to consider (what could make this
fail; what assumptions are unsupported; what evidence is missing; what
competing explanation exists; what's the strongest argument against
this). This is a real, enforced structural constraint, not a prompt
suggestion a model could quietly ignore — `tests/integration/chairman.test.ts`
asserts `objections.length > 0` even on its "can approve a strong
opportunity" case.

## Proving it isn't theater in development mode

`DevelopmentModelProvider` never fabricates reasoning
(`AGENT_RUNTIME.md`), so a fixture-mode Chairman review needs its own
honest stand-in. `buildDevChairmanFixture()` in `chairman.service.ts`
is a **deterministic, rule-based function of the opportunity's actual
data** — not a static string:

- Fewer than 2 evidence records → an objection about relying on a
  single, possibly-outlier source, plus a corresponding
  `missingEvidence` entry.
- Average evidence confidence below 0.6 → an objection naming the
  actual computed average.
- The opportunity's own `confidenceScore` below 0.5 → an objection
  naming that score.
- No `CUSTOMER`-sourced evidence at all → an objection that every
  signal is secondary, plus a `missingEvidence` entry asking for a
  direct customer interview.
- Always at least one more: "no competing-explanation analysis has
  been performed" — matching the fifth adversarial question even when
  every other check passes.
- `decision` is `REQUEST_MORE_EVIDENCE` whenever evidence is thin
  (`evidenceCount < 2` or `averageConfidence < 0.4`); otherwise
  `APPROVE` only if both `opportunityScore >= 0.6` and
  `confidenceScore >= 0.5`, else still `REQUEST_MORE_EVIDENCE`.

Every fixture-mode string is prefixed `[DEV FIXTURE]` and the
`reasoning` field states plainly that no real model call was made.
Because the output is a genuine function of real input, two different
opportunities get genuinely different reviews —
`tests/integration/chairman.test.ts`'s "different opportunities get
genuinely different reviews" test builds a weak opportunity (no
evidence) and a strong one (three high-confidence customer records,
well-scored) and asserts both the `decision` **and** the `reasoning`
text differ between them, and that the strong one reaches `APPROVE`
while the weak one reaches `REQUEST_MORE_EVIDENCE` with
`missingEvidence.length > 0`. This is the concrete, testable answer to
"how do you know dev mode isn't just a rubber stamp" — the fixture
cannot approve an opportunity it wasn't given the evidence to approve.

## Relationship to the validation-level policy

From `LEVEL_5` upward, `opportunityService.setValidationLevel` will
not proceed without a **standing `ChairmanReview` with
`decision: "APPROVE"`** for that opportunity — not merely "a review
exists," and not satisfied by an old review superseded by a later,
non-approving one (`chairmanReviewRepository.findLatestForOpportunity`
checks the *latest* row). See `VALIDATION_POLICY.md`. This is what
makes the Chairman more than advisory for the levels the Constitution
treats as significant — it is a real, enforced gate, just never one
the Chairman enforces on its own initiative; a human still has to ask
for the level change.

## Real mode

Identical code path through `AnthropicModelProvider`
(`AGENT_RUNTIME.md` / `M2_ARCHITECTURE_PROPOSAL.md` §9) once
`MODEL_PROVIDER_MODE=anthropic` and a real `ANTHROPIC_API_KEY` are
configured — `chairmanService` itself has no branch on provider mode;
`createModelProvider()` is the only place that decision is made.
