---
description: Store decisions, learnings, and insights in your Obsidian brain
agent: agent
---

# Brain Remember Prompt

You are helping to store important information in the Obsidian brain for future reference.

## Your Task
Analyze the current conversation and extract valuable information to persist in the brain.

## What to Remember

### Decisions Made
For each significant decision:
- **Context**: What problem or situation led to this decision?
- **Decision**: What was decided?
- **Rationale**: Why was this the right choice?
- **Alternatives Considered**: What other options were evaluated?
- **Consequences**: What are the implications?

### Learnings Discovered
For each learning:
- **Problem**: What issue was encountered?
- **Root Cause**: What was the underlying cause?
- **Solution**: How was it resolved?
- **Prevention**: How to avoid this in the future?

### Code Patterns
For reusable patterns:
- **Pattern Name**: Descriptive name
- **Use Case**: When to apply this pattern
- **Implementation**: The code or approach
- **Variations**: Common modifications

## Storage Guidelines

1. **Choose the right directory**:
   - `/Engineering/[project]/` for project-specific notes
   - `/Playbooks/` for procedures
   - `/Decisions/` for ADRs
   - `/Snippets/` for code patterns

2. **Use meaningful filenames**:
   - Use kebab-case: `decision-auth-provider.md`
   - Include dates for time-sensitive: `2024-01-15-migration-plan.md`

3. **Prefer append over write**:
   - Add new entries to existing notes when relevant
   - Create new notes only for distinct topics

4. **Include metadata**:
   - Timestamps
   - Tags for categorization
   - Links to related notes

## Example Usage

To store a decision:
```
obsidian_brain: operation="append", filepath="Decisions/auth-decisions.md", content="
## [Date] - Chose JWT over Sessions

**Context**: Needed to implement authentication for the API.

**Decision**: Use JWT tokens with refresh token rotation.

**Rationale**:
- Stateless authentication for better scalability
- Works well with microservices architecture
- Built-in expiration handling

**Alternatives Considered**:
- Session-based auth (rejected: requires session storage)
- OAuth only (rejected: adds complexity for simple use cases)

**Consequences**:
- Need to implement token refresh logic
- Must secure token storage on client
"
```

Now, analyze the conversation and store valuable information in the brain.
