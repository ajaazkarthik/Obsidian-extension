# Obsidian Brain VS Code Extension - Complete Development Prompt

## OBJECTIVE

Create a VS Code extension called "Obsidian Brain - Global Agent Memory" that provides three AI Language Model Tools:
1. **obsidian_brain** - Global knowledge persistence using an Obsidian vault
2. **integrated_filesystem** - File operations without external MCP dependency
3. **chat_history** - Search and browse VS Code chat history across all workspaces

This extension is designed for publishing to the VS Code Marketplace.

---

## EXTENSION METADATA

```json
{
  "name": "obsidian-brain",
  "publisher": "YOUR_PUBLISHER_ID",
  "displayName": "Obsidian Brain - Global Agent Memory",
  "description": "Global knowledge persistence for AI agents using Obsidian vault, with integrated filesystem operations and chat history search. Works across all workspaces as a second brain without external MCP dependencies.",
  "version": "1.6.0",
  "license": "MIT",
  "engines": {
    "vscode": "^1.95.0"
  },
  "categories": ["AI", "Chat"],
  "enabledApiProposals": ["chatParticipantPrivate"],
  "activationEvents": ["onStartupFinished"],
  "main": "./out/extension.js"
}
```

---

## PROJECT STRUCTURE

```
obsidian-brain/
├── package.json
├── tsconfig.json
├── src/
│   ├── extension.ts           # Entry point
│   ├── brainTool.ts           # obsidian_brain tool implementation
│   ├── filesystemBackend.ts   # Filesystem operations for vault
│   ├── filesystemTool.ts      # integrated_filesystem tool
│   └── chatHistoryTool.ts     # chat_history tool
└── prompts/
    ├── brain-usage.instructions.md
    ├── brain-remember.prompt.md
    ├── brain-recall.prompt.md
    └── brain-summarize.prompt.md
```

---

## TOOL 1: obsidian_brain

### Purpose
Global knowledge store using Obsidian vault that persists across ALL workspaces. Acts as a "second brain" for AI agents.

### Operations
| Operation | Description | Required Parameters |
|-----------|-------------|---------------------|
| `search` | Find notes matching a query | `query` |
| `list` | Browse vault structure | `directory` (optional) |
| `read` | Get note content | `filepath` |
| `write` | Create/overwrite note | `filepath`, `content` |
| `append` | Add to existing note | `filepath`, `content` |

### Model Description (for AI agents)
```
Global knowledge store using Obsidian vault that persists across ALL workspaces. CRITICAL: ALWAYS search the brain BEFORE starting any task to restore context from previous sessions across all workspaces. As you work, record progress, decisions, and learnings in the brain. Before completing any task, update the brain with results and insights. This is your second brain - use it to maintain continuity across conversations and workspaces. Operations: 'search' (find relevant notes), 'list' (browse vault structure), 'read' (get note content), 'write' (create/overwrite note), 'append' (add to existing note). The vault is organized into: /Engineering/ (project-specific), /Playbooks/ (procedures), /Decisions/ (ADRs), /Snippets/ (code patterns). IMPORTANT: Always check if Obsidian MCP is available first. If unavailable, inform the user to ensure MCP servers are running.
```

### Implementation Details

1. **Dual Backend Strategy**:
   - Primary: Try Obsidian MCP tools if available (`mcp_mcp-obsidian_obsidian_*`)
   - Fallback: Direct filesystem access via `vscode.workspace.fs`

2. **Vault Path Configuration**:
   - Default: `C:\workspace\obsidian-vault`
   - Configurable via `obsidianBrain.vaultPath` setting

3. **Search Implementation** (FilesystemBackend):
   - Recursively scan all `.md` files in vault
   - Case-insensitive text matching
   - Return filename, matches with context (150 chars around match)
   - Skip hidden files/directories (starting with `.`)

### Input Schema
```json
{
  "type": "object",
  "properties": {
    "operation": {
      "type": "string",
      "enum": ["search", "list", "read", "write", "append"]
    },
    "query": { "type": "string" },
    "filepath": { "type": "string" },
    "content": { "type": "string" },
    "directory": { "type": "string" }
  },
  "required": ["operation"]
}
```

---

## TOOL 2: integrated_filesystem

### Purpose
Integrated filesystem operations without requiring external MCP server configuration. Provides all common file operations directly within VS Code.

### Operations
| Operation | Description | Required Parameters |
|-----------|-------------|---------------------|
| `read_file` | Read single file | `path`, optional `head`/`tail` |
| `read_multiple_files` | Parallel file reads | `paths` (array) |
| `write_file` | Create/overwrite file | `path`, `content` |
| `list_directory` | List directory contents | `path` |
| `directory_tree` | Recursive JSON tree | `path` |
| `move_file` | Move/rename files | `source`, `destination` |
| `search_files` | Glob pattern search | `path`, `pattern` |
| `create_directory` | Create directories | `path` |
| `get_file_info` | Get file metadata | `path` |

### Security: Allowed Directories
The tool validates all paths against allowed directories:
1. All workspace folders
2. User home directory (`USERPROFILE` or `HOME`)
3. Common roots: `C:\workspace`, `C:\Users`, `C:\repos`, `D:\workspace`, `D:\repos`
4. Custom directories from setting: `obsidianBrain.filesystemAllowedDirectories`

### Implementation Details

1. **Path Validation**: All operations check if path is within allowed directories
2. **Parallel Reads**: `read_multiple_files` uses `Promise.all` for efficiency
3. **Head/Tail Support**: `read_file` can return first N or last N lines
4. **Glob to Regex**: Convert glob patterns (`*.ts`, `**/*.json`) to regex for search
5. **Directory Tree**: Recursive with max depth of 5, skip hidden files

### Input Schema
```json
{
  "type": "object",
  "properties": {
    "operation": {
      "type": "string",
      "enum": ["read_file", "read_multiple_files", "write_file", "list_directory", "directory_tree", "move_file", "search_files", "create_directory", "get_file_info"]
    },
    "path": { "type": "string" },
    "paths": { "type": "array", "items": { "type": "string" } },
    "content": { "type": "string" },
    "pattern": { "type": "string" },
    "source": { "type": "string" },
    "destination": { "type": "string" },
    "head": { "type": "number" },
    "tail": { "type": "number" }
  },
  "required": ["operation"]
}
```

---

## TOOL 3: chat_history

### Purpose
Search and browse VS Code chat history across ALL workspaces. Indexes all Copilot/agent chat sessions stored by VS Code.

### Operations
| Operation | Description | Required Parameters |
|-----------|-------------|---------------------|
| `search` | Full-text search with filters | `query`, optional date/workspace filters |
| `list_sessions` | Browse sessions with previews | optional filters |
| `read_session` | Read complete conversation | `session_id` |
| `get_stats` | Statistics about chat history | none |
| `export_session` | Export to Obsidian vault | `session_id` |
| `rebuild_index` | Force refresh index | none |

### Date Filters
Supports relative dates: `today`, `yesterday`, `last_week`, `last_month`, or ISO dates (`YYYY-MM-DD`)

### Implementation Details

1. **Index Locations** (Windows):
   - Empty window: `%APPDATA%/Code/User/globalStorage/emptyWindowChatSessions/`
   - Workspace sessions: `%APPDATA%/Code/User/workspaceStorage/*/chatSessions/`
   - Editing sessions: `%APPDATA%/Code/User/workspaceStorage/*/chatEditingSessions/`

2. **Session Parsing**:
   - Parse JSON files with `sessionId` and `requests` array
   - Extract user messages from `request.message.text`
   - Extract assistant responses from `request.response` array
   - Track tools used, agent names, model IDs

3. **Search**:
   - Case-insensitive full-text search
   - Return context around matches (50 chars before, 100 after)
   - Sort by date descending

4. **Export Format**: Markdown with headers, message formatting, tools used

### Input Schema
```json
{
  "type": "object",
  "properties": {
    "operation": {
      "type": "string",
      "enum": ["search", "list_sessions", "read_session", "get_stats", "export_session", "rebuild_index"]
    },
    "query": { "type": "string" },
    "session_id": { "type": "string" },
    "date_from": { "type": "string" },
    "date_to": { "type": "string" },
    "workspace": { "type": "string" },
    "limit": { "type": "number" },
    "include_responses": { "type": "boolean" }
  },
  "required": ["operation"]
}
```

---

## EXTENSION.TS - Entry Point

```typescript
import * as vscode from 'vscode';
import { BrainTool } from './brainTool.js';
import { FilesystemTool } from './filesystemTool.js';
import { ChatHistoryTool } from './chatHistoryTool.js';

export function activate(context: vscode.ExtensionContext) {
    console.log('[ObsidianBrain] Extension activating...');

    // Register tools
    const brainTool = new BrainTool(context);
    context.subscriptions.push(vscode.lm.registerTool('obsidian_brain', brainTool));

    const filesystemTool = new FilesystemTool(context);
    context.subscriptions.push(vscode.lm.registerTool('integrated_filesystem', filesystemTool));

    const chatHistoryTool = new ChatHistoryTool(context);
    context.subscriptions.push(vscode.lm.registerTool('chat_history', chatHistoryTool));

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('obsidianBrain.checkConnection', async () => {
            const isConnected = await brainTool.checkObsidianMcpConnection();
            if (isConnected) {
                vscode.window.showInformationMessage('✅ Obsidian MCP is connected and ready!');
            } else {
                vscode.window.showWarningMessage(
                    '⚠️ Obsidian MCP is not available. Using filesystem fallback.',
                    'Reload Window'
                ).then(selection => {
                    if (selection === 'Reload Window') {
                        vscode.commands.executeCommand('workbench.action.reloadWindow');
                    }
                });
            }
        })
    );

    // More commands: openVault, showAllowedDirectories, searchChatHistory, getChatStats
}

export function deactivate() {
    console.log('Obsidian Brain extension deactivated');
}
```

---

## PACKAGE.JSON - Complete Configuration

### Commands
```json
{
  "commands": [
    { "command": "obsidianBrain.checkConnection", "title": "Check Obsidian MCP Connection", "category": "Obsidian Brain" },
    { "command": "obsidianBrain.openVault", "title": "Open Obsidian Vault", "category": "Obsidian Brain" },
    { "command": "obsidianBrain.showAllowedDirectories", "title": "Show Allowed Filesystem Directories", "category": "Obsidian Brain" },
    { "command": "obsidianBrain.searchChatHistory", "title": "Search Chat History", "category": "Obsidian Brain" },
    { "command": "obsidianBrain.getChatStats", "title": "Get Chat History Statistics", "category": "Obsidian Brain" }
  ]
}
```

### Configuration
```json
{
  "configuration": {
    "title": "Obsidian Brain",
    "properties": {
      "obsidianBrain.vaultPath": {
        "type": "string",
        "default": "C:\\workspace\\obsidian-vault",
        "description": "Path to your Obsidian vault. Used as fallback when Obsidian MCP is unavailable."
      },
      "obsidianBrain.filesystemAllowedDirectories": {
        "type": "array",
        "items": { "type": "string" },
        "default": [],
        "description": "Additional directories the integrated filesystem tool is allowed to access."
      }
    }
  }
}
```

### Chat Prompt Files (for agent prompts)
```json
{
  "chatPromptFiles": [
    { "name": "brain-remember", "description": "Store decisions, learnings, and insights in your Obsidian brain", "path": "./prompts/brain-remember.prompt.md" },
    { "name": "brain-summarize", "description": "Summarize and store current conversation context", "path": "./prompts/brain-summarize.prompt.md" },
    { "name": "brain-recall", "description": "Search and recall knowledge from your Obsidian brain", "path": "./prompts/brain-recall.prompt.md" }
  ],
  "chatInstructions": [
    { "name": "brain-usage", "description": "Instructions for using the Obsidian brain for global knowledge persistence", "path": "./prompts/brain-usage.instructions.md" }
  ]
}
```

### Language Model Tools (full definitions in package.json)
All three tools must be defined under `contributes.languageModelTools` with:
- `name`: Tool identifier
- `tags`: Array of searchable tags
- `toolReferenceName`: How to reference in prompts
- `displayName`: UI display name
- `modelDescription`: Full description for AI models
- `canBeReferencedInPrompt`: true
- `icon`: VS Code icon (e.g., `$(brain)`, `$(folder)`, `$(history)`)
- `inputSchema`: JSON Schema for tool input

---

## TSCONFIG.JSON

```json
{
  "compilerOptions": {
    "module": "Node16",
    "target": "ES2022",
    "outDir": "out",
    "rootDir": "src",
    "lib": ["ES2022"],
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "moduleResolution": "Node16"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "out"]
}
```

---

## DEV DEPENDENCIES

```json
{
  "devDependencies": {
    "@types/node": "^22",
    "@types/vscode": "^1.95.0",
    "@vscode/vsce": "^3.6.2",
    "typescript": "^5.9.2"
  }
}
```

---

## BUILD & PACKAGE SCRIPTS

```json
{
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "package": "vsce package --pre-release"
  }
}
```

---

## KEY IMPLEMENTATION PATTERNS

### 1. Language Model Tool Interface
```typescript
export class BrainTool implements vscode.LanguageModelTool<BrainToolInput> {
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<BrainToolInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        // Implementation
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(resultText)
        ]);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<BrainToolInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: "Message shown to user",
            confirmationMessages: { ... } // Optional confirmation dialog
        };
    }
}
```

### 2. File Operations
Use `vscode.workspace.fs` API for all file operations:
```typescript
const uri = vscode.Uri.file(filePath);
const content = await vscode.workspace.fs.readFile(uri);
const text = new TextDecoder('utf-8').decode(content);
```

### 3. Error Handling
Always wrap operations in try-catch and return meaningful error messages:
```typescript
try {
    // operation
} catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Operation failed: ${errorMsg}`)
    ]);
}
```

---

## PROMPT FILES

### brain-usage.instructions.md
Instructions that tell agents to:
1. Always search brain BEFORE starting work
2. Use vault organization: `/Engineering/`, `/Playbooks/`, `/Decisions/`, `/Snippets/`
3. Include timestamps in notes
4. Prefer append over write to preserve history
5. Update brain before completing any task

### brain-remember.prompt.md
Prompt for storing decisions, learnings, and insights with templates for:
- Decision records (context, decision, rationale, alternatives, consequences)
- Learnings (problem, root cause, solution, prevention)

### brain-recall.prompt.md
Prompt for searching and retrieving knowledge with search strategies for:
- Project context
- Problem solutions
- Decisions
- Code patterns

### brain-summarize.prompt.md
Prompt for summarizing conversations with template including:
- Objective
- Key accomplishments
- Decisions made
- Technical details
- Next steps

---

## INSTALLATION & PUBLISHING

### Local Development
```bash
npm install
npm run compile
npm run package  # Creates obsidian-brain-1.6.0.vsix
code --install-extension obsidian-brain-1.6.0.vsix
```

### Publishing to Marketplace
1. Create publisher account at https://marketplace.visualstudio.com/manage
2. Update `publisher` in package.json
3. Create Personal Access Token (PAT) in Azure DevOps
4. Run: `vsce login YOUR_PUBLISHER_ID`
5. Run: `vsce publish`

---

## CRITICAL NOTES

1. **Proposed API**: The extension uses `chatParticipantPrivate` proposed API. For marketplace publishing, you may need to remove this or apply for approval.

2. **Default Vault Path**: The default `C:\workspace\obsidian-vault` should be configurable - users will have different paths.

3. **Cross-Platform**: The chat history tool has platform-specific paths for Windows, macOS, and Linux.

4. **No External Dependencies**: The extension has NO runtime npm dependencies - only TypeScript types and build tools.

5. **Tool Registration**: Tools are registered via `vscode.lm.registerTool()` which is the VS Code 1.95+ Language Model API.

---

## SUCCESS CRITERIA

✅ Extension activates on VS Code startup
✅ All three tools appear in Copilot's tool list
✅ obsidian_brain can search, read, write, append to vault
✅ integrated_filesystem can perform all file operations
✅ chat_history can search and list past conversations
✅ Commands appear in command palette
✅ Settings are configurable
✅ Prompt files are recognized by Copilot

---

**END OF SPECIFICATION**

Create this extension following the exact specifications above. The implementation should be identical to ensure consistency across machines.
