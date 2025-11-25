---
agent: agent
---

# Brain Compression & Cleanup

Compress and optimize your Obsidian brain to reduce redundancy while preserving essential knowledge.

## Your Task

1. **List all directories** in the brain vault
2. **Review each area** for bloat and redundancy
3. **Consolidate** related information
4. **Archive or delete** outdated content
5. **Reorganize** misplaced notes

## Step-by-Step Process

### Step 1: Survey the Brain
```
obsidian_brain: operation="list"
obsidian_brain: operation="list", directory="Engineering"
obsidian_brain: operation="list", directory="Playbooks"
obsidian_brain: operation="list", directory="Decisions"
obsidian_brain: operation="list", directory="Snippets"
obsidian_brain: operation="list", directory="_Inbox"
```

### Step 2: Process _Inbox
The `_Inbox/` folder contains quick notes that need organization:
- Read each note in _Inbox
- Move to appropriate directory (Engineering, Playbooks, Decisions, Snippets)
- Or merge with existing notes using append

### Step 3: Consolidate Duplicates
For each directory:
- Identify notes covering similar topics
- Merge them into single, comprehensive notes
- Delete the redundant originals

### Step 4: Clean Up
- Remove notes that are no longer relevant
- Update outdated information
- Add dates to entries missing timestamps
- Ensure consistent formatting

## Compression Guidelines

- **Preserve**: Critical decisions, unique learnings, reusable patterns
- **Consolidate**: Similar topics, related projects, overlapping procedures  
- **Archive**: Old project notes → move to `_Archive/[project]/`
- **Delete**: Duplicate info, temporary notes, outdated context

## Output Format

After compression, provide:
1. Summary of changes made
2. Notes consolidated or deleted
3. Current vault structure
4. Recommendations for future organization

## Example Consolidation

Before:
```
Engineering/
  project-a-auth.md
  project-a-auth-fix.md
  project-a-jwt-issues.md
```

After:
```
Engineering/
  project-a-authentication.md  (consolidated, comprehensive)
```
