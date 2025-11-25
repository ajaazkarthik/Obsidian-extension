---
description: Summarize and store current conversation context
agent: agent
---

# Brain Summarize Prompt

You are helping to create a summary of the current conversation for future reference.

## Your Task
Create a comprehensive summary of the conversation and store it in the brain.

## Summary Template

```markdown
# Session Summary - [Date]

## Objective
What the user was trying to accomplish.

## Context
- **Workspace/Project**: [Name]
- **Technologies**: [List]
- **Related Notes**: [[links]]

## Key Accomplishments
1. First accomplishment
2. Second accomplishment
3. Third accomplishment

## Decisions Made

### Decision 1: [Title]
- **Choice**: What was decided
- **Rationale**: Why this was chosen

### Decision 2: [Title]
- **Choice**: What was decided
- **Rationale**: Why this was chosen

## Technical Details

### Implementation Notes
Key technical details worth remembering.

### Code Changes
Summary of significant code changes:
- File: `path/to/file.ts` - Description of change
- File: `path/to/other.ts` - Description of change

### Dependencies
Any new dependencies or tools introduced.

## Problems Encountered
- **Problem 1**: Description
  - **Solution**: How it was resolved
- **Problem 2**: Description
  - **Solution**: How it was resolved

## Learnings
1. Key learning point
2. Another learning
3. Best practice discovered

## Next Steps
- [ ] Task to continue
- [ ] Follow-up action
- [ ] Future consideration

## Tags
#project-name #technology #topic
```

## Storage Location

Store summaries in: `/Engineering/Sessions/[project]-[date].md`

Or append to an existing project file: `/Engineering/[project]/sessions.md`

## Guidelines

1. **Be Concise but Complete**: Include all important details
2. **Use Concrete Examples**: Reference specific files, functions, decisions
3. **Link Related Notes**: Connect to existing knowledge
4. **Include Timestamps**: Date all entries
5. **Add Actionable Next Steps**: Make it easy to continue

## Example Usage

```
obsidian_brain: operation="write", filepath="Engineering/Sessions/api-auth-2024-01-15.md", content="
# Session Summary - 2024-01-15

## Objective
Implement JWT authentication for the REST API.

## Context
- **Project**: Backend API
- **Technologies**: Node.js, Express, jsonwebtoken
- **Related Notes**: [[Decisions/auth-decisions]]

## Key Accomplishments
1. Implemented JWT token generation
2. Created auth middleware
3. Added refresh token rotation

## Decisions Made

### Decision 1: Token Storage
- **Choice**: HTTP-only cookies for access token
- **Rationale**: Prevents XSS attacks, automatic inclusion in requests

## Technical Details

### Implementation Notes
- Access tokens expire in 15 minutes
- Refresh tokens expire in 7 days
- Token rotation on each refresh

## Next Steps
- [ ] Add rate limiting to auth endpoints
- [ ] Implement password reset flow
- [ ] Add OAuth providers

## Tags
#api #authentication #jwt #security
"
```

Now, analyze this conversation and create a comprehensive summary.
