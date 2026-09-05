# M10 Real-World Boundary

The classification and provider registry M10's brief Part 4 and Part 36
ask for. Grounded entirely in `docs/M10_REAL_WORLD_AUDIT.md`'s verified
findings — nothing here is aspirational.

## The four labels

`src/domain/real-world/reality.types.ts` — `RealityLabel`:

| Label | Means | Example this build |
|---|---|---|
| `REAL` | Genuinely touched the outside world, or reflects genuine external content | A `Signal` sourced from a real WebSearch result with a real, dereferenceable URL; a `WebhookDelivery` with `signatureValid: true` from an actual payment provider |
| `DEV_FIXTURE` | A deterministic, clearly-labeled stand-in — never presented as real | Every CEO/Chairman reasoning call in this environment (`MODEL_PROVIDER_MODE=development`); every `Dev*Provider` deployment/billing/revenue result |
| `HUMAN_ACTION` | Requires the actual Human Owner to act outside this system | Sending an approved outreach message through their own channel; creating a real Stripe product in Stripe's own dashboard |
| `SIMULATED` | A modeled scenario, not claimed as either real or a fixture stand-in for something specific | Not used by this build's own M10 experiment — flagged here for completeness per the brief; nothing in this codebase currently needs it, and inventing a use would be padding |

This is a different axis from `MetricValueKind`
(OBSERVED/ESTIMATED/INFERRED/PREDICTED, M8) — that classifies how
grounded a *number* is; `RealityLabel` classifies whether an *action*
actually happened in the real world. Both can appear on the same
record without conflict (a `REAL` webhook delivery produces an
`OBSERVED` revenue metric).

Storage: embedded as a `realWorld: RealWorldTag` key inside an existing
free-form `metadata` JSON column (`Signal.metadata`, `Opportunity.metadata`)
rather than a new column on every table this build already has one on.
`OperatingCycle` has no metadata column, so it gets a real FK
(`realWorldExperimentId`) instead — the one schema change this
milestone's traceability chain needed
(`docs/M10_REAL_WORLD_AUDIT.md` §38).

`buildRealWorldTag()` refuses to construct a `REAL` or `HUMAN_ACTION`
tag with an empty provenance note — "trust me" is not a substitute for
saying how something was actually obtained.

## Provider registry (brief Part 36)

| Provider | Purpose | Credential required | This environment | Human-approval requirement | Dev fixture | Production readiness |
|---|---|---|---|---|---|---|
| Anthropic (model) | CEO/Chairman/analyst reasoning | `ANTHROPIC_API_KEY` | Not set — `MODEL_PROVIDER_MODE=development`. `api.anthropic.com` **is** reachable from this container (this session's own calls depend on it) | None beyond the existing Guardian/risk gates on the action a recommendation feeds into | `DevelopmentModelProvider`, complete | `AnthropicModelProvider` is a real, complete implementation — the only provider in this registry that could go real in this exact environment given a real key |
| Hacker News (Algolia) | Real signal discovery | None (public, keyless) | Reachable in principle; **blocked by this container's egress proxy** (`docs/M10_REAL_WORLD_AUDIT.md`) | None — `READ_WEB`/GREEN already covers it | `DevelopmentSource` | Real adapter exists and is unit-tested; unreachable here only because of network policy, not code |
| Stack Exchange | Real signal discovery | None (public, keyless) | Same as Hacker News | None | `DevelopmentSource` | Same as Hacker News |
| Payment (Stripe or equivalent) | Real billing/revenue | Real API key + real webhook signing secret | No real implementation exists (`DevBillingProvider` only); `api.stripe.com` also blocked by this container's egress proxy | `assertHumanActor`-gated activation already exists (`ACTIVATE_BILLING`); a human would additionally have to create the real product/price directly in the provider's own dashboard (`HUMAN_ACTION`, not this system) | `DevBillingProvider`, complete | Not started — building a real adapter this session could not itself exercise (still network-blocked) would be effort spent with no way to verify it; see `docs/M10_REAL_WORLD_AUDIT.md`'s recommendation on this session's inbound `SESSION_INGRESS_URL` as the one plausible real path (a real provider's webhook calling *into* this container, which the outbound egress block does not affect) |
| Email/SMTP or equivalent outreach channel | Sending a real drafted message | Real account credentials | None configured; not needed — see below | Every send is `HUMAN_ACTION` by design (`messageApprovalService.markContacted`'s own doc comment: "no programmatic send capability anywhere in this codebase for this call to trigger") | N/A — M5 was already built with no fixture send path at all | Correctly, permanently out of scope for autonomous execution; this is the intended end-state, not a gap |
| Hosting/deployment target | Making a built product actually reachable | Real hosting account | No real implementation exists (`DevDeploymentProvider` only, explicitly "can never reach anything real"); any real target would also need outbound egress this container doesn't have | `assertHumanActor`-gated `EXECUTE` already exists | `DevDeploymentProvider`, complete | Not started, same reasoning as payment |
| Monitoring / analytics / secrets / revenue / product-usage / customer-data | M7/M8 read-side intelligence | Real provider-specific credentials | No real implementation for any of them | N/A (read-only) | `Dev*Provider` for each, complete | Not started — all six share the exact same "never built, mirrors billing/deployment" pattern (`docs/M10_REAL_WORLD_AUDIT.md`) |

No credential above is pretended into existence. Where a row says "not
started," that is because building a real adapter this session cannot
itself reach (confirmed by direct network test, not assumed) would add
code with no way to verify it works — the opposite of this milestone's
own Part 51 priority (real value over line count).

## What this means operationally for M10

- **Signals**: real, WebSearch-sourced content, ingested through the
  unmodified `signalService.ingest()` path, tagged
  `{ reality: "REAL", note: "sourced via operator WebSearch — this
  container's own egress proxy blocks the live HN/SE adapters" }`.
- **Reasoning** (CEO/Chairman/analysts): tagged `DEV_FIXTURE` throughout
  — this was already true for every prior milestone and M10 does not
  change it. The *evidence* the reasoning operates over is real even
  when the reasoning engine itself is a fixture; the two are independent
  and both are labeled honestly.
- **Customer contact**: drafting is real work by real (fixture-reasoning)
  agents over real prospect data where available; the send itself is
  `HUMAN_ACTION`, never attempted by this session.
- **Payment**: `BLOCKED — REAL PAYMENT PROVIDER NOT CONFIGURED` per the
  brief's own Part 42 wording, for the structural reasons in the
  provider table above — not a missing feature, a missing (and in this
  container, unreachable) credential.
