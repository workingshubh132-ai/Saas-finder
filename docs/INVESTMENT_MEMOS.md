# Investment Memos

M4. The milestone's literal final product. Full rationale in
`docs/M4_ARCHITECTURE_PROPOSAL.md` §17.

> "Not an AI essay. The Human Owner should be able to read one."

## Zero new model calls

`src/services/investment-memo.service.ts`. Every field is
deterministically pulled from data that already exists by the time a
`CeoRecommendation` and a `ChairmanReview` of it both exist for the
same opportunity — no third "memo-writing" agent, which would risk the
exact fabrication Part 44 forbids (a memo-writer could "improve" on a
weak CEO argument) for no informational gain.

## Body (`InvestmentMemo.content`, JSON)

Opportunity/Problem/Customer/why-this-matters, evidence (with an
independent-source count), WTP evidence, market context, competitors,
differentiation, distribution, buildability, attractiveness score,
confidence, kill risk (+ reasons), Validator findings per claim,
contradicting evidence per claim, largest unresolved assumptions,
evidence gaps, next-best-research-question, the CEO's own
recommendation, and the Chairman's own recommendation. `humanDecision`
starts `"PENDING"` — the memo is compiled *before* the human decides,
not after.

## The two mandatory fields — never generic

- **`strongestArgumentAgainst`** — deterministically the Chairman's
  own top-ranked objection (`ChairmanReview.objections[0]`, parsed
  from the same array `chairmanDecisionSchema` already requires to be
  non-empty — a real objection, never a placeholder).
- **`investmentThesis`** — deterministically the CEO's own `reasoning`
  field, which is itself required to cite specific claim ids
  (`ceoDecisionSchema`), so this is evidence-grounded by construction,
  not free narrative.

Both are promoted to their own columns (not buried in the JSON blob)
specifically so they're queryable without parsing — `tests/integration/investment-memo.test.ts`
asserts both trace back to the real Chairman/CEO rows they were
compiled from.

## The closing block

`recommendation` (`"{CEO action} (Chairman: {decision})"`),
`confidence` (the CEO's own), `keyReason` (the action plus the cited
claim types), `biggestRisk` (the top kill-risk reason when one exists,
else the same top Chairman objection), `nextAction`
(`Opportunity.nextBestResearchQuestion`, or "Awaiting Human decision"
when none remains).

## Immutable, historized

`InvestmentMemo` is append-only (`investment_memos` table) — a re-run
after new evidence is always a new row, never an edit, so it stays
clear which exact memo a given human decision was actually made
against. `DecisionRecord.investmentMemoId` links back to the specific
memo a human read.

## API

`GET /api/opportunities/:id/investment-memos`, `GET
/api/investment-memos/:id`, `POST /api/ceo-recommendations/:id/investment-memo`
(compiles a memo for a given CEO recommendation + a specific Chairman
review of it).
