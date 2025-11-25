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

## ⚠️ WHEN TO USE BRAIN vs MEMORY

| Use `memory` tool for: | Use `obsidian_brain` for: |
|------------------------|---------------------------|
| Current task progress | Learnings that apply to ANY project |
| Workspace-specific context | Decisions worth remembering forever |
| Temporary scratch notes | Solutions to problems you might face again |
| Branch-specific state | Code patterns and snippets |
| This session's status | Knowledge that has long-term value |

**Rule of thumb**: If you'd want to remember this in 6 months when working on a different project, put it in the BRAIN.

## ⚠️ COMPLETION CHECKLIST (BEFORE FINISHING)

Before completing ANY task, you MUST update brain with:
- [ ] What was accomplished (summary)
- [ ] Key decisions made and WHY
- [ ] Problems encountered and solutions
- [ ] Lessons learned / gotchas
- [ ] Reusable patterns discovered

## 🔴 CONTEXT OVERFLOW PREVENTION (AUTO-SAVE)

**Long conversations WILL lose context.** When you notice ANY of these signs, IMMEDIATELY save progress:

| Warning Sign | Action |
|--------------|--------|
| 50+ messages in conversation | `quick_note` with checkpoint |
| Complex multi-step task | Update memory after each major step |
| Response quality declining | Full summarize to brain + handoff |
| Forgetting earlier context | Re-read memory, then save current state |
| About to start new phase | Checkpoint current progress first |

### Quick Checkpoint Pattern
Every 15-20 tool calls, do a quick save:
```
obsidian_brain: operation="quick_note", content="
Checkpoint - [workspace] - [task]
Done: [1-2 accomplishments]
Current: [what you're working on]
Key file: [most important file]
"
```

### Full Save Pattern (For Long Sessions)
When context is getting full:
1. Save to brain: `obsidian_brain: append` to Engineering/[project].md
2. Update memory: `memory: create` with current state
3. Create handoff if needed: use `handoff` tool

**DON'T WAIT UNTIL IT'S TOO LATE.** Context loss = lost work.

## Vault Organization

| Directory | What Goes Here |
|-----------|----------------|
| `_Inbox/` | Quick notes (use `quick_note` operation) - organize later |
| `_Workspaces/` | Auto-managed workspace memory (via `memory` tool) |
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
| `read` | Get full content of a specific note |
| `append` | Add to existing notes (PREFERRED) |
| `write` | Create new notes (use sparingly) |
| `quick_note` | Fast capture to _Inbox - just provide content, no filepath needed |
| `str_replace` | Edit specific text in existing note |
| `insert` | Add content at specific line |
| `delete` | Remove a note |
| `move` | Reorganize notes between directories |

### Memory Tool (Workspace-Specific)
| Command | When to Use |
|---------|-------------|
| `view` | Check existing memory for this workspace |
| `create` | Create new memory file |
| `str_replace` | Update existing memory content |
| `insert` | Add to memory at specific line |
| `delete` | Remove memory file |
| `rename` | Move/rename memory files |

## Quick Capture Pattern

When you need to record something quickly without deciding where it goes:
```
obsidian_brain: operation="quick_note", content="[Your insight here]"
```
This auto-saves to `_Inbox/` with a timestamp. Use brain-manager to organize later.

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
