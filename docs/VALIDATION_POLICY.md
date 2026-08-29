# Validation Level Policy

M2. The formal version of the guard M1 deliberately left minimal.
M1's rule (`DECISIONS.md` #9) was "any level above `LEVEL_0` requires
at least one attached Evidence record" — a foundation guard, explicitly
not the full policy, with "which evidence mix actually justifies which
level" flagged as M2 scope. This document and
`src/domain/opportunity/validation-policy.ts` are that policy.

## The table

`VALIDATION_LEVEL_REQUIREMENTS` — one entry per level, each a
standalone, independently-adjustable policy decision:

| Level | Min evidence | Min avg confidence | Required source type | Min reliability | Human required | Chairman APPROVE required |
|---|---|---|---|---|---|---|
| LEVEL_0 | 0 | 0 | — | — | no | no |
| LEVEL_1 | 1 | 0 | — | — | no | no |
| LEVEL_2 | 2 | 0.3 | — | — | no | no |
| LEVEL_3 | 2 | 0.4 | MARKET_DATA or COMPETITOR (≥1) | — | no | no |
| LEVEL_4 | 2 | 0.5 | CUSTOMER (≥1) | MEDIUM | **yes** | no |
| LEVEL_5 | 3 | 0.6 | CUSTOMER (≥1) | HIGH | **yes** | **yes** |
| LEVEL_6 | 3 | 0.7 | EXPERIMENT (≥1) | — | **yes** | **yes** |
| LEVEL_7 | 4 | 0.75 | EXPERIMENT (≥2) | — | **yes** | **yes** |
| LEVEL_8 | 5 | 0.8 | EXPERIMENT (≥2) | — | **yes** | **yes** |

Reading the progression: `LEVEL_1`–`LEVEL_2` are quantity/confidence
only (an agent can set these on its own). `LEVEL_3` is the first to
require a *kind* of evidence, not just a count — some market or
competitor signal, still agent-settable. `LEVEL_4` is the first to
require a real customer's own evidence and the first a Human must set
(matching Constitution §14's own example, "agents must not claim
Level 6 based only on Level 1 evidence" — read as "claiming meaningful
validation is a human call, not an agent's own to make"). `LEVEL_5`
raises the customer-evidence bar to `HIGH` reliability and adds the
Chairman gate (`CHAIRMAN.md`) — this is the level the Constitution's
"significant opportunity" language is read as describing. `LEVEL_6`–`LEVEL_8`
require actual `EXPERIMENT` evidence (something was *tested*, not just
claimed) in increasing quantity and confidence, all human+Chairman
gated.

**These specific numbers are a founding policy choice**, isolated in
one file so a founder can revise them without touching enforcement
logic — exactly the same pattern M1 used for the permission→risk table
(`DECISIONS.md` #4). They are listed in the M2 final report's
"decisions requiring founder approval" section, not treated as
self-evidently correct.

## Enforcement: `checkValidationLevelRequirement`

Pure function, `src/domain/opportunity/validation-policy.ts` — zero
I/O, trivially unit-tested
(`tests/unit/validation-policy.test.ts`, all 9 levels). Takes a
requirement and the opportunity's evidence summaries, returns
`{ satisfied, reasons }`. Critically, **it reports every unmet
condition, not just the first one it finds** — evidence count,
average confidence, and required-source-type/reliability are checked
independently and every failing check adds its own specific,
human-readable reason (`"requires at least 2 evidence record(s) of
type CUSTOMER with reliability >= HIGH, has 1"`). This directly
satisfies the M2 brief's "never pretend weak evidence satisfies a
higher level" — a caller gets the real, complete list of what's
missing, not a generic "no."

## Enforcement: `opportunityService.setValidationLevel`

The service function that actually changes `Opportunity.validationLevel`
(`src/services/opportunity.service.ts`) runs, in order:

1. Look up the target level's `ValidationLevelRequirement`.
2. Summarize the opportunity's current evidence
   (`toEvidenceSummary()`) and call `checkValidationLevelRequirement`.
   Not satisfied → `ValidationError` naming every unmet reason.
   Nothing about *who* is asking matters yet — the evidence bar is
   the evidence bar regardless of actor.
3. If `requirement.requiresHumanActor` and the caller's `actor.actorType`
   isn't `HUMAN` → rejected with a message matching `/HUMAN actor/`.
   Tested directly: `tests/integration/validation-policy-enforcement.test.ts`'s
   "LEVEL_4 requires a HUMAN actor" case shows an `AGENT` actor is
   rejected even with fully sufficient evidence — the evidence check
   passing does not imply the actor check is skipped.
4. If `requirement.requiresChairmanApproval`, look up the opportunity's
   **latest** `ChairmanReview` (`chairmanReviewRepository.findLatestForOpportunity`)
   and require `decision === "APPROVE"`. No review at all, or a
   review whose decision isn't `APPROVE` (including a *stale* APPROVE
   superseded by a later non-approving review) → rejected with a
   message matching `/Chairman/`. Tested directly: LEVEL_5 is rejected
   until a fresh `APPROVE` review exists, then succeeds once one does
   (`validation-policy-enforcement.test.ts`).
5. Only once all applicable checks pass does the transition happen —
   through the same `state-machine.ts` validation-level transition
   table M1 already had, unchanged.

All checks are independent and additive: an `AGENT` actor targeting
`LEVEL_5` with zero evidence gets rejected at step 2 (evidence), not a
misleading "wrong actor type" message that implies fixing the actor
alone would be enough.

## What this replaces, and what stays the same

M1's blanket "`LEVEL_1`+ needs ≥1 evidence" is now exactly
`VALIDATION_LEVEL_REQUIREMENTS.LEVEL_1` — a special case of the
general table, not a separately-maintained rule. One pre-existing M1
test assertion (`opportunities.test.ts`, "LEVEL_2 with 1 evidence
item") legitimately changed under the stricter policy — `LEVEL_2` now
needs 2 evidence records, not 1 — and was updated to target `LEVEL_1`
instead, with the fuller policy's own dedicated test file covering the
rest (`DECISIONS.md` records this as a deliberate, expected
consequence of formalizing the policy, not a regression).

## Out of scope

Per-level required evidence weighting beyond count/confidence/type
(e.g. recency decay, source-diversity scoring beyond "at least N of
type X"), an appeals/override mechanism for a Human who disagrees with
a computed gap, and any UI for visualizing "how close is this
opportunity to LEVEL_N" — all reasonable future refinements, none
needed for M2's brief.
