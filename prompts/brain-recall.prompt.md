---
description: Search and recall knowledge from your Obsidian brain
agent: agent
---

# Brain Recall Prompt

You are helping to search and retrieve relevant knowledge from the Obsidian brain.

## Your Task
Search the brain for information relevant to the current task or question.

## Search Strategies

### By Project
Find all notes related to a specific project:
```
obsidian_brain: operation="search", query="[project name]"
obsidian_brain: operation="list", directory="Engineering/[project]"
```

### By Problem Domain
Find solutions to similar problems:
```
obsidian_brain: operation="search", query="[error message or symptom]"
obsidian_brain: operation="search", query="[technology] [problem type]"
```

### By Decision Type
Find past architectural decisions:
```
obsidian_brain: operation="list", directory="Decisions"
obsidian_brain: operation="search", query="decision [topic]"
```

### By Code Pattern
Find reusable patterns:
```
obsidian_brain: operation="list", directory="Snippets"
obsidian_brain: operation="search", query="pattern [use case]"
```

### By Procedure
Find how-to guides:
```
obsidian_brain: operation="list", directory="Playbooks"
obsidian_brain: operation="search", query="how to [task]"
```

## Recall Process

1. **Broad Search First**: Start with general terms
2. **Refine if Needed**: Use more specific queries
3. **Browse Structure**: Use `list` to explore directories
4. **Read Full Notes**: Use `read` to get complete content
5. **Synthesize**: Combine information from multiple notes

## What to Look For

- **Context from Previous Sessions**: What was discussed before?
- **Decisions Already Made**: What approaches were chosen?
- **Problems Already Solved**: Has this been encountered before?
- **Patterns Established**: Are there existing patterns to follow?
- **Lessons Learned**: What should be avoided?

## Example Recall Session

User asks about implementing authentication:

```
# Search for auth-related notes
obsidian_brain: operation="search", query="authentication"

# Check decisions directory
obsidian_brain: operation="list", directory="Decisions"

# Read relevant decision
obsidian_brain: operation="read", filepath="Decisions/auth-decisions.md"

# Look for related snippets
obsidian_brain: operation="search", query="jwt token"
```

## Present Findings

When presenting recalled information:
1. Summarize what was found
2. Quote relevant sections
3. Note the source (file path)
4. Highlight how it applies to the current task
5. Identify any gaps in existing knowledge

Now, search the brain for relevant information.
