# SaaS-Finder

SaaS-Finder is the founding codebase for **VentureForge**, an AI-native company designed to continuously discover, investigate, validate, build, sell, operate, improve, and retire software businesses.

This repository is governed by [`CONSTITUTION.md`](./CONSTITUTION.md), the founding charter that defines VentureForge's mission, decision hierarchy, autonomy levels, and operating principles. Every agent, workflow, and product built in this repository is expected to operate within the boundaries that document establishes — including the evidence-first principle, the autonomy levels (GREEN/YELLOW/ORANGE/RED), and the separation of powers between the CEO, Chairman, Guardian, and Human Owner.

## Status

**M1 — the VentureForge Operating Kernel — is implemented.** It's the
smallest production-quality foundation the future company runs on: an
Agent Registry, a Task Engine, an explicit Permission model, a Risk
classification (GREEN/YELLOW/ORANGE/RED), an Approval Engine, an
Evidence Engine, an Opportunity Engine with scoring, a Memory
foundation, an Event log, an Audit log, and a Human Decision Queue —
proven end to end by a vertical slice: a research signal becomes an
evidence-backed, scored Opportunity with a governed decision request
sitting in the Human Owner's queue, with every important action
auditable.

See `docs/OPERATING_MODEL.md` for how it operates, `docs/ARCHITECTURE.md`
for how it's built, `docs/DATA_MODEL.md` for the schema,
`docs/SECURITY.md` for its threat model, and `docs/DECISIONS.md` for
why it's built this way. M1 does **not** implement the CEO, Chairman,
Guardian, sales automation, or the SaaS factory — see
`docs/OPERATING_MODEL.md` for what's deliberately out of scope.

## Quick start

```bash
npm install
cp .env.example .env
npm run prisma:migrate   # applies prisma/migrations to a local SQLite dev.db
npm run dev               # starts the kernel on :3000 (see .env for PORT)
npm test                  # unit + integration + vertical-slice tests
npm run typecheck && npm run lint && npm run build
```
