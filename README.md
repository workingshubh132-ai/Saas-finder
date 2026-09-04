# SaaS-Finder

SaaS-Finder is the founding codebase for **VentureForge**, an AI-native company designed to continuously discover, investigate, validate, build, sell, operate, improve, and retire software businesses.

This repository is governed by [`CONSTITUTION.md`](./CONSTITUTION.md), the founding charter that defines VentureForge's mission, decision hierarchy, autonomy levels, and operating principles. Every agent, workflow, and product built in this repository is expected to operate within the boundaries that document establishes — including the evidence-first principle, the autonomy levels (GREEN/YELLOW/ORANGE/RED), and the separation of powers between the CEO, Chairman, Guardian, and Human Owner.

## Status

**M1 through M7 are implemented**, each layered on the same unmodified
Guardian/Agent-Runtime kernel M1 established:

- **M1 — Operating Kernel**: Agent Registry, Task Engine, Permission
  model, Risk classification (GREEN/YELLOW/ORANGE/RED), Approval
  Engine, Evidence Engine, Opportunity Engine, Memory, Event log,
  Audit log, Human Decision Queue.
- **M2 — Agent Execution + Governance Brain**: authenticated
  identities, a bounded/budgeted Agent Runtime, a real model-provider
  seam, a Research Agent, and the Chairman's first adversarial review.
- **M3 — Opportunity Intelligence Engine**: real research-source
  adapters, signal clustering, Problem/Competitor/Market analysis, and
  opportunity generation with kill-risk scoring.
- **M4 — Decision Intelligence Engine**: claim extraction and
  validation, the CEO's own reasoning, Investment Memos, and the
  KILL/PREPARE_REVIEW decision-queue wiring.
- **M5 — Customer Discovery Intelligence**: ICP targeting, prospect
  research, human-approved outreach drafts (never autonomous sending),
  response analysis, and Customer Discovery Memos.
- **M6 — SaaS Factory** (`docs/SAAS_FACTORY.md`): a real code-generation
  and test pipeline in an isolated workspace — Product Strategist
  through Engineering/Code-Review/QA/Security agents — ending at a
  human go/no-go decision, never an autonomous deploy.
- **M7 — Launch & Operations Engine** (`docs/LAUNCH_OPERATIONS.md`):
  launch planning, pricing, go-to-market, deployment, and billing —
  every consequential action split into agent PLAN, human APPROVE, and
  a separate human-only EXECUTE step; no autonomous deployment,
  billing activation, or spend.

See `docs/OPERATING_MODEL.md` for how it operates, `docs/ARCHITECTURE.md`
for how it's built, `docs/DATA_MODEL.md` for the M1 schema (each
milestone's own `docs/M*_ARCHITECTURE_PROPOSAL.md` documents its own
schema additions), `docs/SECURITY.md` for the full threat model across
all seven milestones, and `docs/DECISIONS.md` for why it's built this
way.

## Quick start

```bash
npm install
cp .env.example .env
npm run prisma:migrate   # applies prisma/migrations to a local SQLite dev.db
npm run dev               # starts the kernel on :3000 (see .env for PORT)
npm test                  # unit + integration + vertical-slice tests
npm run typecheck && npm run lint && npm run build
```
