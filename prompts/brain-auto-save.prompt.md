---
agent: agent
description: Auto-summarize and handoff when context window is filling up
---

# Context Overflow Prevention

You've been working on a complex task and the context window is filling up. Before you lose important information, follow this protocol to preserve your progress.

## ⚠️ When to Use This

Use this prompt when:
- You've been in a long conversation (50+ messages)
- Working on multi-step tasks that span many tool calls
- Before starting a new major phase of work
- When you notice responses becoming less coherent

## Step 1: Save Progress to Brain

First, record all important context to the brain:

```
obsidian_brain: operation="append", filepath="Engineering/[project-name].md", content="
## [DATE] Session Summary

**Task:** [What you were working on]
**Status:** [In progress / Completed / Blocked]

### Accomplishments
- [What was done]

### Key Decisions
- [Decisions made and WHY]

### Problems Encountered
- [Issues and their solutions]

### Files Modified
- `path/to/file.ts` - [what changed]

### Next Steps
- [ ] [Remaining tasks]

### Learnings
- [Anything valuable for future sessions]

#auto-saved #[workspace-tag]
"
```

## Step 2: Save Workspace Progress

Use the same brain tool to update workspace progress:

```
obsidian_brain: operation="write", filepath="_Workspaces/[workspace]/progress.md", content="
# Current Task Progress

## Active Work
[Current focus area]

## Todo Status
- [x] Completed items
- [ ] Remaining items

## Important Context
[Anything the next session needs to know]

## Blockers
[Any issues preventing progress]
"
```

## Step 3: Create Handoff

Use the handoff tool to create a focused new thread:

```
handoff: title="Continue: [task name]", newPrompt="
Continue working on [project].

## Background
[2-3 sentence summary of what's been done]

## Current State
- Files modified: [list key files]
- Last action: [what was just done]

## Goal
[What still needs to be accomplished]

## Constraints
[Any important requirements or limitations]
"
```

## Quick Template

For fast context saves during work:

```
obsidian_brain: operation="quick_note", content="
[DATE] Mid-session checkpoint - [workspace]
Working on: [task]
Done: [accomplishments]
Next: [immediate next step]
Key file: [most important file being edited]
"
```

## Save Activity Records

The tool automatically records factual activity after every three successful saves and gives a save reminder after every 12 operations. It does not measure context usage or generate conversation summaries automatically. Invoke this prompt when you want to preserve a summary and next steps.

## Best Practices

1. **Save at meaningful milestones** - Record decisions and next steps while they are fresh
2. **Be specific** - Include file paths, function names, exact decisions
3. **Include rationale** - WHY decisions were made, not just WHAT
4. **Tag consistently** - Use #auto-saved, #workspace-name, #project-name
5. **Update, don't duplicate** - Append to existing notes when possible
