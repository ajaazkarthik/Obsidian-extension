# Change Log

All notable changes to the "obsidian-brain" extension will be documented in this file.

## [2.11.1] - 2026-10-13

- Automatic platform-specific vault setup: Windows `C:\workspace\obsidian-vault`, macOS/Linux `~/workspace/obsidian-vault`; machine-specific setting with workspace overrides and native folder picker.
- Serialized tool writes and vault switches; preserved existing files on permission/sharing errors and prevented recursive archiving with Windows note separators.
- Added Windows/macOS/Linux CI and deterministic LF build output.
- Validated native paths, normalized note separators, actionable access errors and synchronized index/I/O when vault settings change.

- Consolidated native registration to `obsidian_brain` with 14 operations, including explicit shared-tag `related_notes`.
- Added consistent suffix stemming, counted body postings, TF/IDF scoring, tiered recency and version-3 cache persistence with startup reconciliation and batched saves.
- Unified canonical tags across search, summaries and auto-tag analysis; compacted the brain marker and search tag display.
- Exposed capped reads and search limits; retained content routing, capture deduplication, immediate indexing and archived superseded content.
- Added factual checkpoints every three successful saves and retained the 12-operation reminder. Removed orphaned tools and the disconnected context monitor.
- Added shipped-runtime acceptance tests with disposable vaults and package inspection. No extension installation or reload is performed by the build.

## [2.5.0] - 2025-11-27

### Added
- **summarize_note operation** - TL;DR summary of any note with:
  - Word/line/paragraph counts
  - Tag extraction and display
  - Heading structure outline
  - Key bullet points (first 5)
  - Summary from first meaningful paragraph
  - Link reference counts
- **list_recent operation** - Show recently modified notes across all folders:
  - Sorted by modification time (most recent first)
  - Configurable limit (default: 10)
  - Shows title, path, date/time, tags, and preview
- **auto_tag operation** - Content-based tag suggestions:
  - Analyzes content for 20+ technical/documentation patterns
  - Confidence scoring (60%+ threshold for auto-apply)
  - Pattern categories: languages, frameworks, document types, project stages
  - Code block detection for #code-example tag
  - Optional `apply_tags: true` to automatically add high-confidence tags

### Changed
- VaultIndexer: Added `getFileInfo()` and `getRecentFiles()` methods
- Package schema updated with new operations and parameters

## [2.4.0] - 2025-11-26

### Added
- **Instant Indexing** - All writes now immediately update search index for zero-delay searchability
- **Brain emoji (🧠) in invocation messages** - Visual identifier for brain operations
- **ContextWatcher** - Tracks conversation length and tokens for context overflow prevention
- **Auto-save prompt** - Guide for checkpoint patterns to preserve progress
- **contextWatcher.ts** - Monitor token usage and suggest when to summarize

### Fixed
- **Critical: Stale index bug** - Search results now reflect latest writes instantly
- Tag search scoring improved (1.0 → 8.0 for explicit #tagname searches)
- Improved error messages with visual indicators

### Changed
- Compact visual header in output (replaces large ASCII art)
- All write operations now show "(indexed ⚡)" indicator
- Brain-usage.instructions.md updated with context overflow prevention section

### Performance
- Word index caching implemented (partial - full rebuild on startup for 500+ files)
- File watcher debounce: 500ms (prevents index thrashing)
- Search results: sorted by score, top 20 by default

## [2.3.0] - 2025-11-26

### Added
- Brain ASCII art header in all outputs for visual satisfaction
- Enhanced visual feedback with emojis in operation messages

## [2.2.0] - 2025-11-26

### Added
- **Auto-save system** - ContextWatcher class for monitoring conversation length
- **brain-auto-save.prompt.md** - Instructions for checkpoint patterns
- **Context overflow prevention** - Warning signs table and full save pattern
- Updated brain-usage.instructions.md with aggressive mid-task triggers

## [2.1.0] - 2025-11-26

### Added
- **VaultIndexer** - In-memory index with cache persistence (.obsidian-brain/index.json)
- **File watcher** - Live updates with 500ms debounce
- **Tag search** - Support for `#tagname` syntax
- **Scoring system** - Multi-factor ranking (title=10, tag=8, filename=4, heading=2, content=1)
- **Delta updates** - Only reindex changed files

### Fixed
- O(n) search performance - replaced with indexed search O(1) for titles/tags

## [2.0.0] - 2025-11-26

### Added
- **memory tool** - Workspace-scoped memory (replaces Agent Memory)
- **Quick note feature** - Timestamped notes to _Inbox with `quick_note` operation
- **New operations** - str_replace, insert, delete, move
- **Brain compression prompt** - brain-compress.prompt.md
- **Manager agent** - brain-manager.agent.md for vault organization

### Changed
- Extension from v1.x to v2.0 with consolidated tools
- All Agent Memory features now in brain/memory tools

## [1.6.0] - 2024-11-25

### Added
- Initial release
- `obsidian_brain` tool for Obsidian vault operations
- `integrated_filesystem` tool for file operations
- `chat_history` tool for searching VS Code chat history
- Prompt files for brain-remember, brain-recall, and brain-summarize
- Commands for managing the extension
