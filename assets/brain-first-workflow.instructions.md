---
description: >
  Brain-first workflow enforcement. Use when starting any task, making decisions,
  or finishing work — defines the mandatory search/save cadence and the hook that
  enforces it.
applyTo: "**"
---

# Brain-First Workflow (enforced)

The Obsidian brain instruction is guidance only. This file adds the cadence, and
the `brain_guard` hook installed alongside it enforces that cadence
deterministically.

## 1. Search before anything else

Before writing code or running commands:

```
obsidian_brain: operation="search", query="<topic of the task>"
```

Found notes → read and build on them. Nothing found → proceed, but you must save
an entry before finishing.

## 2. Save as you go — do not batch

Every 3–5 tool calls, ask: *"Did I discover something worth keeping?"* If yes,
capture it immediately with `quick_note` or `append`. Context can reset at any
moment; anything not written is lost.

The hook watches `_Inbox/session-activity-log.md` in the vault and injects a
reminder when a session reaches 5 tool calls with no save recorded.

## 3. Save a summary before finishing

Before `task_complete`, append an entry covering context, what was accomplished,
key findings, files changed, and next steps. The `Stop` hook blocks completion
once per session when no save was recorded.

## Pre-completion checklist

- [ ] Brain searched at the start
- [ ] Mid-task insights captured, not just the final summary
- [ ] Summary entry written for this session
- [ ] Entry includes timestamp, context, findings, and changes
- [ ] The entry alone explains what was done and why

## Where things go

| What to store | Where |
|---------------|-------|
| Project notes, architecture, findings | `Engineering/<project>.md` |
| Decisions with rationale | `Decisions/<project>-decisions.md` |
| Reusable patterns and snippets | `Snippets/<topic>.md` |
| How-to guides and procedures | `Playbooks/<workflow>.md` |
| Fast captures | `_Inbox/` via `quick_note` |
