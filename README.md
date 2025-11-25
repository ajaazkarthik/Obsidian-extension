# Obsidian Brain - Global Agent Memory

A VS Code extension that provides global knowledge persistence for AI agents using an Obsidian vault, with integrated filesystem operations and chat history search. Works across all workspaces as a second brain without external MCP dependencies.

## Features

### 🧠 Obsidian Brain Tool
Global knowledge store using an Obsidian vault that persists across ALL workspaces.

- **search** - Find notes matching a query
- **list** - Browse vault structure
- **read** - Get note content
- **write** - Create/overwrite notes
- **append** - Add to existing notes

### 📁 Integrated Filesystem Tool
File operations without external MCP dependency.

- **read_file** - Read single file with optional head/tail
- **read_multiple_files** - Parallel file reads
- **write_file** - Create/overwrite files
- **list_directory** - List directory contents
- **directory_tree** - Recursive JSON tree view
- **move_file** - Move/rename files
- **search_files** - Glob pattern search
- **create_directory** - Create directories
- **get_file_info** - Get file metadata

### 📜 Chat History Tool
Search and browse VS Code chat history across ALL workspaces.

- **search** - Full-text search with date/workspace filters
- **list_sessions** - Browse sessions with previews
- **read_session** - Read complete conversations
- **get_stats** - Statistics about chat history
- **export_session** - Export to Obsidian vault
- **rebuild_index** - Force refresh index

## Installation

1. Install from the VS Code Marketplace
2. Configure your Obsidian vault path in settings
3. Start using the tools in Copilot Chat!

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `obsidianBrain.vaultPath` | Path to your Obsidian vault | `C:\workspace\obsidian-vault` |
| `obsidianBrain.filesystemAllowedDirectories` | Additional directories for filesystem access | `[]` |

## Commands

- **Obsidian Brain: Check Obsidian MCP Connection** - Verify MCP status
- **Obsidian Brain: Open Obsidian Vault** - Open vault in VS Code
- **Obsidian Brain: Show Allowed Filesystem Directories** - View allowed paths
- **Obsidian Brain: Search Chat History** - Search past conversations
- **Obsidian Brain: Get Chat History Statistics** - View chat stats

## Vault Organization

The extension expects your vault to be organized with these directories:

```
vault/
├── Engineering/     # Project-specific notes
├── Playbooks/       # Procedures and how-tos
├── Decisions/       # Architecture Decision Records
└── Snippets/        # Reusable code patterns
```

## Usage with AI Agents

The tools are designed to work seamlessly with GitHub Copilot and other AI agents:

1. **Always search first** - Before starting any task, search the brain for context
2. **Record as you go** - Store decisions, learnings, and insights
3. **Update before completing** - Persist results and next steps

## Prompt Files

The extension includes several prompt files for common operations:

- `brain-remember` - Store decisions and learnings
- `brain-recall` - Search and retrieve knowledge
- `brain-summarize` - Create conversation summaries

## License

MIT

## Contributing

Contributions welcome! Please submit issues and pull requests on GitHub.
