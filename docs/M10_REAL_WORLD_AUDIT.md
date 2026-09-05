# M10 Real-World Audit

Phase 0 gate for M10 (docs/M10_REAL_WORLD_AUDIT.md — this file, per the
M10 brief's own Part 3). Every claim below was verified directly against
this repository's code and this specific runtime environment on
2026-09-05 — nothing here is carried over from a prior milestone's own
final report without re-checking it. Where a prior report's claim held
up, it's cited; where reality is more restrictive than a prior report
implied, that's called out explicitly.

## Executive summary

**Two independent facts, verified empirically, decide almost everything
else in this document:**

1. **Every external provider in this codebase — except the model
   provider and the two research-source adapters — has only ever had a
   dev-fixture implementation.** Deployment, billing, secrets,
   monitoring, analytics, revenue, product usage, customer data: each
   one's factory hard-returns its `Dev*Provider` singleton with no real
   alternative and no env-var switch (`grep -rn "DEV_FIXTURE only\|Only Dev.*Provider exists" src/providers` —
   12 hits, zero real implementations). This was already stated plainly
   in each provider's own doc comment across M7/M8; M10 is the first
   milestone that actually needs one of them to be real.
2. **This specific environment's network egress proxy blocks every
   external domain except a narrow developer-infrastructure allowlist.**
   Verified directly: `curl` to `hn.algolia.com`, `api.stackexchange.com`,
   `api.stripe.com`, and even `example.com` all fail identically —
   `CONNECT tunnel failed, response 403` / `connect_rejected (organization
   policy)`. The proxy's own status endpoint confirms the allowlist
   (`noProxy`) covers only package registries and Anthropic's own API —
   no general web domain, real or research-only. This is a property of
   *this* environment's configured network policy
   (`docs/M10_REAL_WORLD_AUDIT.md` — see "This environment's network
   reality" below), not of the adapters' code, and not something this
   session may try to route around (that would mean evading an access
   control, which Part 5 of the M10 brief and this build's own security
   discipline both forbid).

Consequence: in *this* environment, no code this session writes — real
provider implementation or not — can make a live outbound call to any
real payment processor, email/SMTP relay, hosting/deployment API, or
even the two already-real, keyless research APIs M3 already built. This
is not a credentials gap alone; it is a network-reachability wall in
front of every one of them. Section 4's REAL/DEV FIXTURE/HUMAN
ACTION/SIMULATED boundary (`docs/M10_REAL_WORLD_BOUNDARY.md`) is designed
around this fact rather than pretending it isn't there.

## Method

For each milestone: read the actual service/provider code (not the
milestone's own final-report prose), and for anything claiming to reach
the outside world, find its factory/config switch and confirm what it
resolves to right now. Network claims were tested with a direct `curl`
through this session's own egress proxy, not assumed from a comment.

## Per-milestone findings

### M1 — Foundation
Identity, permissions, audit, approval state machine: all real,
in-process, DB-backed logic — no external dependency of any kind. Fully
real today, no blockers.

### M2 — Runtime
`config.modelProviderMode` (`src/config.ts`) defaults to `"development"`
— confirmed via `.env`/`.env.example`, no `ANTHROPIC_API_KEY` present
anywhere in this environment. Every agent execution in this build's
history (CEO, Chairman, every analyst, every M6 factory agent) has run
against `DevelopmentModelProvider`, a deterministic, clearly
`[DEV FIXTURE]`-labeled function of its own input — never a real model
call. `AnthropicModelProvider` is a real, complete implementation
(`src/providers/anthropic-model-provider.ts`) that would work if
`MODEL_PROVIDER_MODE=anthropic` and a real key were set — but note that
even then, the *outbound* call would need `api.anthropic.com`
specifically reachable, which it is (it's on this proxy's own
allowlist — this session's own model calls depend on it) — so the model
provider is the **one external dependency in this entire system that
could plausibly go real in this exact environment**, if the Human Owner
supplies a real key. Nothing currently does.

The Guardian permission/risk/tool-execution/budget system: real,
in-process, no external dependency, unchanged since M2.

### M3 — Opportunity intelligence
`RESEARCH_TOOL_MODE` defaults to `"development"` (`DevelopmentSource`,
fixture). `HackerNewsSource`/`StackExchangeSource` are real, complete,
keyless, ToS-compliant implementations (`docs/SOURCE_ADAPTERS.md`) —
**but confirmed unreachable from this environment** (see network test
above). Sourced from public, unmoderated content — reliability capped at
`MEDIUM` even when live. Everything downstream of raw signal collection
(dedup, clustering, problem analysis, competitor/market analysis,
opportunity generation/scoring, kill-risk) is real deterministic/
model-based logic with no external dependency of its own — it operates
identically on real signal content or dev-fixture content, which is
exactly the seam M10 needs (see `docs/M10_REAL_WORLD_BOUNDARY.md`).

### M4 — Decision intelligence
Claim extraction, Evidence Validator, confidence recalibration, CEO
reasoning, Chairman review, Investment Memo: all real logic, gated
entirely on the model-provider mode above (dev-fixture today). No other
external dependency.

### M5 — Customer discovery
ICP Analyst, Prospect Researcher (reuses M3's source adapters — same
reachability finding applies), qualification, Message Drafter: real
logic, model-provider-gated. **Outreach send: already correctly designed
for exactly M10's constraint, with zero changes needed.**
`messageApprovalService.markContacted`'s own doc comment
(`src/services/message-approval.service.ts:103-112`) states this
plainly: *"There is no programmatic send capability anywhere in this
codebase for this call to trigger — the Human Owner personally sends the
approved text through their own channel, then confirms it here."* M5's
human gate was never a placeholder for a future auto-send feature; it is
the permanent, correct boundary. Response ingestion is already
manual-entry by design (`docs/DECISIONS.md`, task history) for the same
reason — a real prospect's real reply arrives outside this system and
must be entered, not fetched.

### M6 — SaaS factory
Product Strategist/Architect/UX agents: model-provider-gated (fixture
today). Engineering/Code Review/QA/Security agents: the *reasoning* is
model-provider-gated, but the actual workspace file writes and command
execution (`WriteWorkspaceFileTool`/`RunWorkspaceCommandTool`,
`src/tools/register-tools.ts:36-41`) are **always real** — "no dev-fixture
variant... a real, disposable workspace write/command is already safe
and cheap." This means a product the factory builds is a genuinely real,
runnable, typechecked, tested codebase on disk today, even while the
*decisions* about what to build in it come from dev-fixture reasoning.
That distinction — real artifact, fixture-driven authorship — is exactly
what M10's REAL/DEV FIXTURE classification needs to represent per-field,
not per-product.

### M7 — Launch & operations
Every one of the six M7 provider ports (deployment, billing, secrets,
monitoring, analytics, and the M8-added revenue/product-usage/
customer-data ports built alongside it) resolves to its `Dev*Provider`
singleton unconditionally — confirmed by reading every
`*-provider-factory.ts` in `src/providers/`. None has a live branch to
even attempt; this isn't "misconfigured," it's "never built," stated
plainly in each file's own comment (e.g.
`src/providers/billing-provider-factory.ts:8`: *"Only DevBillingProvider
exists in M7"*). `DevDeploymentProvider` is explicit about its own
ceiling: *"in-memory, zero network calls, can never reach anything
real"* (`src/providers/dev-deployment-provider.ts:22`). PLAN → HUMAN
APPROVAL → EXECUTE is real and correctly gated; what EXECUTE actually
*does* has never touched anything outside this process.

### M8 — Revenue & growth intelligence
Deterministic metric engine, anomaly detection, business health scoring,
portfolio analysis: real logic — but it has only ever computed over
`BusinessMetric` rows that themselves originated from
`DevRevenueProvider`/`DevProductUsageProvider`/`DevCustomerDataProvider`
(same "Dev-only" finding as M7). `docs/COMPANY_CONTROL_PLANE.md` already
says this plainly for cash position specifically ("permanently UNKNOWN,
no real payment processor exists anywhere in this codebase") — this
audit confirms the same is true of every other M8 input, not only cash.

### M9 — Control plane
`controlPlaneService` and the OperatingCycle machinery: real, in-process,
no external dependency — verified in the prior milestone's own work this
session already did. It coordinates the above services faithfully
whether they're operating on real or fixture underlying data; M9 adds no
new real/fixture exposure of its own.

## This environment's network reality

Tested directly against this session's own egress proxy
(`curl -sS "$HTTPS_PROXY/__agentproxy/status"` plus direct `curl` calls),
2026-09-05:

| Target | Result |
|---|---|
| `hn.algolia.com` (M3's real HN source) | Blocked — `403` at CONNECT |
| `api.stackexchange.com` (M3's real SE source) | Blocked — `403` at CONNECT |
| `api.stripe.com` (a plausible real billing provider) | Blocked — `403` at CONNECT |
| `example.com` (generic control) | Blocked — `403` at CONNECT |
| `api.anthropic.com` (this session's own model calls) | Allowed (on the proxy's `noProxy` list) |

The allowlist is a short, specific list of developer infrastructure
(npm/pypi/crates/Go module proxies, Anthropic's own API endpoints,
internal cluster addresses) — not a blocklist of specific
"real-world"-flavored domains. **No arbitrary external HTTPS domain is
reachable from this container today**, whether the caller is
VentureForge's own Node process or a raw shell command. This is a
network policy chosen for this environment
(`docs/M10_REAL_WORLD_AUDIT.md`'s own environment-configuration
documentation — see the Claude Code on the web docs on network
policies), not a defect in this session's tooling.

One narrow exception exists: this session's own `WebSearch` tool (backed
by Anthropic's hosted search infrastructure, not this container's direct
egress path) returns real search results — real titles, real
dereferenceable URLs, and a real synthesized snippet — for public queries.
`WebFetch`, which does route through this container's own egress proxy,
is blocked identically to raw `curl` (`EGRESS_BLOCKED`, confirmed against
both `hn.algolia.com` and a plain `news.ycombinator.com` URL). WebSearch
is therefore the **only** channel in this environment through which
genuinely real external-world content can enter VentureForge today.

## What this means for M10 in this environment

- **Real market discovery is possible, narrowly.** VentureForge's own
  live source adapters cannot run here. What can run: real signals
  sourced through the operator's (this session's) `WebSearch` tool,
  carrying real titles/URLs/snippets, ingested through the *exact same*
  `signalService.ingest()` path the live adapter would use — never
  hand-written or invented content. This is documented as its own,
  distinct REAL provenance in `docs/M10_REAL_WORLD_BOUNDARY.md` (not
  the same thing as `RESEARCH_TOOL_MODE=live`, and never presented as
  such).
- **Real customer contact already has the right shape and needs no new
  code.** Draft, qualify, and prepare through the system; the actual
  send is the Human Owner's own action through their own channel,
  exactly as M5 already requires. This session cannot and must not
  attempt to send a real message to a real stranger on the internet on
  the user's behalf.
- **Real payment is structurally blocked in this environment**,
  independent of whether a real `BillingProvider` gets written this
  milestone. Even a complete, real Stripe-backed implementation could not
  make its own outbound API call from this container. Per the M10
  brief's own Part 42, the honest result is
  `BLOCKED — REAL PAYMENT PROVIDER NOT CONFIGURED`, and per Part 36, no
  credential is pretended into existence to avoid saying so.
- **Real product hosting is equally blocked** — there is no reachable
  real deployment target from this container today, for the same
  network reason.

None of this is a reason to stop. The M10 brief itself (Part 50) defines
`REAL_CUSTOMER_VALIDATED` with an honest, specific blocker as a complete,
non-failing outcome when `FIRST_REAL_REVENUE` isn't reachable — this
audit is what makes that determination possible instead of guessed. The
rest of M10 proceeds on exactly that basis: push every step as far into
"real" as this environment genuinely allows, and report the wall
precisely where it's hit rather than papering over it.
