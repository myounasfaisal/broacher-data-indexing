# Archive — historical documents

Nothing in this folder describes the current system. The single source of truth is
[ARCHITECTURE.md](../../ARCHITECTURE.md); setup lives in [readme.md](../../readme.md).

These files were moved here on **2026-07-26**, when the architecture docs were
consolidated after the migration from the in-memory `jobs.py` queue to the
Postgres-backed DB-worker pipeline. They are kept for provenance — why decisions were
made, and what the system used to be. Relative links *inside* these files point at the
old repo root and are mostly broken; that is expected.

| File | What it was |
|---|---|
| `new_architecture.md` | Current-state description of the DB-worker pipeline, written just after the migration. The most accurate of the old docs — folded into `ARCHITECTURE.md`. |
| `nasir-data-indexing-architecture.md` | The design doc that proposed the DB-worker pipeline (extraction, cross-page context, supplier resolution). |
| `IMPLEMENTATION_BRIEF.md` | Build spec for that migration. Assumed a Node/TypeScript worker; the implementation is Python. |
| `nasir-migration-plan.md` | Migration plan from the in-memory queue. Complete. |
| `context_from_younas.md` | Session handoff covering the migration work. |
| `HANDOFF.md` | Operational session handoff — project facts, run instructions, open UI issues. Its architecture summary is pre-migration. |
| `IMPECCABLE_CONTEXT.md`, `impeccable-UI-Improvments/` | Frontend design-session context and notes. The design system itself is `DESIGN.md`. |
| `CHANGES.md`, `changes.json` | Narrative and machine-readable change logs, parts 1–18. |
| `PROPOSAL.md` | Client-facing project proposal (July 2026). |
| `MOBILE_APP_SPEC.md` | Spec for a mobile app that was never built. |
