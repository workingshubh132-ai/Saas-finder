# The CEO

M4. Bounded reasoning over already-validated claims — deciding what
should happen next for one opportunity, never re-deriving evidence
itself. Full rationale in `docs/M4_ARCHITECTURE_PROPOSAL.md` §12-16.

## Zero tool calls, by construction and by grant

`src/services/ceo-reasoning.service.ts`. Budget: `{ maxSteps: 2,
maxToolCalls: 0, maxModelCalls: 1, maxRetries: 1, maxDurationMs:
15_000 }` — the same `maxToolCalls: 0` shape `opportunity-analyst.service.ts`
already uses for its own synthesis-only step. The CEO's registered
`Agent` additionally holds **zero `AgentPermission` grants** — two
independent enforcement layers for the same guarantee: even a bug that
attempted `handle.callTool()` would be denied by `authorizationService.authorize()`
regardless of the budget ceiling (`tests/integration/ceo-reasoning.test.ts`
asserts `execution.toolCallCount === 0` directly).

The CEO reasons only over data that already exists by the time it
runs: the opportunity's claims, their latest `ValidationReport`s,
current score/confidence/kill-risk, and unresolved `EvidenceGap`s. It
never talks to an external source — that's the Evidence Validator's
job, already done.

## Exactly six actions — no more

`domain/decision/decision-action.types.ts`: `KILL, DEPRIORITIZE,
INVESTIGATE, VALIDATE_CUSTOMER, PREPARE_REVIEW, HUMAN_REVIEW`. None
performs, or triggers, any real-world effect by itself:

| Action | What actually happens | Human gate? |
|---|---|---|
| `KILL` | Creates an `ApprovalRequest` (`KILL_OPPORTUNITY`, risk `ORANGE`) — never mutates `Opportunity.status` itself. | Yes. |
| `DEPRIORITIZE` | Lowers the opportunity's research-queue priority. | No — same autonomy class M3's queue prioritization already runs at. |
| `INVESTIGATE` | Boosts `ResearchQueueItem`s for the highest-EIG claims via the unchanged `researchQueueService`. | No. |
| `VALIDATE_CUSTOMER` | **Recommendation only** — the Human Owner personally talks to a customer next. VentureForge never contacts anyone itself. | N/A — no system action exists to gate. |
| `PREPARE_REVIEW` | Compiles the Investment Memo and creates an `ApprovalRequest` (`REVIEW_INVESTMENT_MEMO`, risk `YELLOW`). | Yes. |
| `HUMAN_REVIEW` | Creates an `ApprovalRequest` (`REVIEW_OPPORTUNITY`) with no strong recommendation either way — an honest "I cannot confidently resolve this," not a failure. | Yes. |

Every `CeoRecommendation` must cite at least one real `claimId`
(`ceoDecisionSchema`'s `citedClaimIds.min(1)`) — the direct
implementation of "never recommend KILL with only a bare score as
justification."

## Prioritization — a documented formula, not "sort by score"

`domain/decision/priority.ts`, covering all eight factors the M4 brief
names:

```
decisionPriority =
    0.20 · opportunityScore              // attractiveness
  + 0.15 · (1 − confidenceScore)         // confidence
  + 0.20 · killRiskScore                 // kill risk — fail fast
  + 0.15 · topEvidenceGapImpactScore     // evidence gaps
  + 0.15 · maxClaimEIG                   // expected information gain
  − 0.10 · estimatedResearchCost         // research cost
  + 0.10 · timeSensitivityScore          // time sensitivity (placeholder)
  + 0.05 · strategicFitScore             // strategic fit (placeholder)
```

`estimatedResearchCost`/`timeSensitivityScore`/`strategicFitScore` are
honest, documented `0.5` placeholders — no real cost/urgency/portfolio
model exists yet, matching the exact `estimatedResearchCost`
precedent M3's research-queue formula already carries
(`docs/DECISIONS.md`). Computed by `ceo-reasoning.service.ts` itself,
never asked of the model, and stored on `CeoRecommendation.priorityScore`
alongside the qualitative action/reasoning.

## Historized, never overwritten

`CeoRecommendation` (`ceo_recommendations` table) is append-only,
mirroring `ChairmanReview`/`OpportunityScoreRecord` — a re-run is
always a new row.

## API

`GET /api/opportunities/:id/ceo-recommendations`, `GET
/api/ceo-recommendations/:id`, `POST /api/ceo-recommendations/:id/request-approval`
(wires KILL/PREPARE_REVIEW/HUMAN_REVIEW to the approval queue — see
`DECISION_INTELLIGENCE.md`), `POST /api/decision-cycles` (runs the
CEO as one step of a bounded cycle).
