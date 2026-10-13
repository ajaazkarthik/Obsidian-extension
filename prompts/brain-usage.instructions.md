---
description: Instructions for using the Obsidian brain for global knowledge persistence
applyTo: "**"
---

# Obsidian Brain - MANDATORY Usage Protocol

IMPORTANT: ALWAYS SEARCH YOUR BRAIN BEFORE DOING ANYTHING ELSE.

You have a global knowledge store via `obsidian_brain`. This is your SECOND BRAIN that persists across ALL workspaces and conversations.

## ⚠️ BRAIN PROTOCOL (MANDATORY)

1. **SEARCH FIRST** - Before starting ANY task, search your brain for relevant context. You may have solved this before in another workspace.
2. **RECORD AS YOU GO** - As you make progress, record decisions, learnings, and solutions in your brain.
3. **ASSUME INTERRUPTION** - Your context window might reset at any moment. Any learning NOT recorded in your brain is LOST FOREVER across ALL future sessions and ALL workspaces.

## ⚠️ MID-TASK CHECKPOINTS (CRITICAL)

Every 3-5 tool calls, ask yourself:
- Did I make a decision? → `obsidian_brain: append` to Decisions/
- Did I solve a problem? → `obsidian_brain: append` to Engineering/
- Did I learn something reusable? → `obsidian_brain: append` to Playbooks/ or Snippets/
- Did I encounter and fix an error? → THIS IS VALUABLE, RECORD IT NOW

**DO NOT BATCH UPDATES FOR THE END.** The value is in capturing insights AS THEY HAPPEN.

## Workspace Progress and Global Knowledge

Use `obsidian_brain` for both workspace progress and reusable knowledge. Store project progress in `_Workspaces/[workspace]/` notes, and long-term decisions, solutions and patterns in the main vault directories.

## ⚠️ COMPLETION CHECKLIST (BEFORE FINISHING)

Before completing ANY task, you MUST update brain with:
- [ ] What was accomplished (summary)
- [ ] Key decisions made and WHY
- [ ] Problems encountered and solutions
- [ ] Lessons learned / gotchas
- [ ] Reusable patterns discovered

## Save Activity Checkpoints

Every third successful write, append, quick_note, str_replace or insert appends a timestamped activity checkpoint to `_Inbox/session-activity-log.md`. It records the save count and up to 20 recent saves. Duplicate quick notes do not count as saves. Every 12 operations, the tool reminds you to save useful progress.

These records contain file activity, not conversation summaries or context measurements. Use `brain-auto-save` explicitly when you want to record accomplishments, decisions and next steps.

## Vault Organization

| Directory | What Goes Here |
|-----------|----------------|
| `_Inbox/` | Quick notes (use `quick_note` operation) - organize later |
| `_Workspaces/` | Workspace progress notes using `obsidian_brain` |
| `_Archive/` | Old notes moved here for reference |
| `/Engineering/` | Project notes, architecture, technical details |
| `/Playbooks/` | How-to guides, procedures, workflows |
| `/Decisions/` | Architecture Decision Records (ADRs) |
| `/Snippets/` | Reusable code patterns and templates |

## Operations Quick Reference

### Brain Tool (Global Knowledge)
| Operation | When to Use |
|-----------|-------------|
| `search` | ALWAYS do this first - find relevant past knowledge |
| `list` | Browse vault structure to find where to add |
| `read` | Read inline, capped at 7,000 characters by default; pass a larger explicit `max_chars` if truncated |
| `append` | Add to existing notes (PREFERRED) |
| `write` | Create new notes (use sparingly) |
| `quick_note` | Content-routed capture with session deduplication; no filepath needed |
| `str_replace` | Edit specific text in existing note |
| `insert` | Add content at specific line |
| `delete` | Remove a note |
| `move` | Reorganize notes between directories |
| `summarize_note` | Get a factual TL;DR, structure and canonical tags |
| `list_recent` | List recently modified notes with an optional limit |
| `auto_tag` | Suggest tags or apply suggestions at confidence >=60% |
| `related_notes` | Explicitly retrieve shared-tag notes, with an optional limit; no LLM calls |

Search uses `limit` (default 15); related notes and recent notes default to 10. Search shows at most eight tags per hit while preserving all tags in the index.

## Quick Capture Pattern

When you need to record something quickly without deciding where it goes:
```
obsidian_brain: operation="quick_note", content="[Your insight here]"
```
This uses content-based routing to Engineering/, Decisions/, Playbooks/, Snippets/, or `_Inbox/`, with a timestamp and random suffix. Use brain-manager to organize later.

## Recording Format

When appending to brain, include:
```markdown
## [YYYY-MM-DD] Brief Title

**Context**: What situation led to this
**Decision/Solution**: What was done
**Rationale**: Why this approach
**Tags**: #relevant #tags
```

Remember: Your brain persists across ALL workspaces FOREVER. Every insight you record makes you smarter for all future work. The more you use it, the more valuable it becomes.
