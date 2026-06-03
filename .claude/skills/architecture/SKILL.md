# Architecture Skill

Use this skill when adding or changing core systems in the Dota 2 AI Coach project.

## Workflow

1. Read CLAUDE.md first.
2. Inspect current project structure before editing.
3. Identify affected systems:
   - GSI listener
   - rules engine
   - event timeline
   - SQLite schema
   - match history
   - long-term trends
   - dashboard
   - post-game summary
4. Propose a small implementation plan.
5. Prefer additive changes over risky rewrites.
6. Add or update database migrations when schema changes.
7. Add or update tests.
8. Update README if user-facing behavior changes.
9. Update CLAUDE.md if this is a major design decision.
10. After implementation, explain:
   - files changed
   - how to test
   - any migration notes

## Project Rules

- Do not read Dota memory.
- Do not automate gameplay.
- Do not infer hidden enemy information.
- Do not use external APIs unless explicitly requested.
- Preserve existing GSI, history, event timeline, and dashboard behavior.
- Use soft exclusion for irrelevant matches; never physically delete match data by default.