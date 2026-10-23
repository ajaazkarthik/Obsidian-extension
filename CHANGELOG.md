# Change Log

All notable changes to the "obsidian-brain" extension will be documented in this file.

## [2.15.2] - 2026-10-23

- Moved per-save tracking from the indexed Markdown activity log to the hidden, unindexed `.obsidian-brain/saves.log`, using a native append and rotation after 2,000 lines (retaining the newest 1,000). The guard reads only the private ledger, including sessions that cross a rotation.
- Restored `_Inbox/session-activity-log.md` to an every-third-save checkpoint summary, indexed only on checkpoints and excluded from general search results. Cleans up legacy 2.15.1 standalone save lines on its first new checkpoint without removing existing checkpoint histories.
- Acceptance covers the hidden log, bounded rotation, legacy-log migration, first-save/zero-save hook behaviour, and search isolation. **Measured GitHub Actions 300-append benchmark** (identical 50-note corpus, 2026-10-23; medians over first vs last 50 appends):
  - Linux: reproduced 2.15.1 **1.883 → 6.533 ms**; 2.15.2 **0.829 → 1.176 ms** (**1.419×**, under the 1.5× limit). Total time for 300 appends: **1375.033 → 604.085 ms**.
  - macOS: reproduced 2.15.1 **1.424 → 5.984 ms**; 2.15.2 **0.755 → 0.983 ms** (**1.301×**). Total: **1260.039 → 477.097 ms**.
  - Windows: reproduced 2.15.1 **3.576 → 11.709 ms**; 2.15.2 **2.032 → 2.916 ms** (**1.435×**). Total: **2348.781 → 1156.635 ms**.
  - These results execute actual compiled BrainTool append/index flows; the old recordSave routine is reconstructed from 2.15.1. Timings are environment-dependent and not production-vault latency guarantees.
- Corrected historical folded hook entry to reflect 2.15.1's explicit opt-in installation; removed assertions pinning changelog prose.
- MCP initializes with the client's version only for supported versions 2024-11-05, 2025-03-26 and 2025-06-18; unsupported versions negotiate to the latest supported 2025-06-18. Added coverage for both cases.
- No DLP features added.

## [2.15.1] - 2026-10-23

- Corrected MCP smoke-test failure paths: missing server, early exit, spawn error and timeout reject pending work, emit diagnostic stderr and exit nonzero. Tested against a missing script and deliberately silent process.
- Brain saves now append a timestamped per-save record immediately, while preserving every-third-save checkpoint summaries; compiled BrainTool -> Python Stop-hook acceptance verifies a first quick note unblocks and a no-save session blocks once.
- Hook installation now defaults to **off** with one-time opt-in notice and non-destructive cleanup of old managed configuration. Python availability is checked. Copilot user path verified against VS Code documentation; event names and fields converted to the current Copilot v1 hook schema. Workspace collision detection is event-based. Removed PROGRESS.md instruction.
- MCP initializes BrainTool during initialize, echoes supported protocol version and returns tool execution failures as MCP content with `isError: true`.
- Replaced synthetic vocabulary-loop benchmark with actual compiled `VaultIndexer.removeFileImmediately` runs on the same 1,000-note disposable vault, comparing the 2.15.0 implementation against the prior full-vocabulary loop. Values are logged by CI and are not production-vault estimates.
- Corrected historical changelog labels and retained all existing acceptance coverage. No DLP features added.
- **Measured real-indexer CI benchmark (2026-10-23):** 1,000 identical disposable notes per implementation; 10 warmup removals, then 100 timed `removeFileImmediately` calls. Linux previous **23.84 ms** vs reverse-map **1.34 ms** (17.85x); macOS **24.76 ms** vs **0.74 ms** (33.30x); Windows **15.07 ms** vs **1.12 ms** (13.47x). The baseline reproduces the previous 2.15.0 word-index scan inside a real VaultIndexer instance; timings are environment-dependent and not claims about a production vault.

## [2.15.0] - 2026-10-23

- **Claude Code MCP:** Added zero-dependency `server/dist/index.js` and a local VS Code API shim. JSON-RPC 2.0 stdio supports initialize, tools/list, tools/call and notifications. Schema is read from `package.json`; vault from `OBSIDIAN_VAULT_PATH`; stdout remains protocol-only. A disposable-vault child-process test checks handshake and successful search and write (previously no MCP transport).
- **Repository hygiene:** Generated `node_modules/`, `out/` and VSIX releases are ignored and no longer tracked; Windows/macOS/Linux CI compiles before package verification. The obsolete `git diff --exit-code -- out` gate was removed because `out/` is now deliberately generated.
- **Single version source:** Manifest is 2.15.0; packaging scripts and registration acceptance read the version from `package.json` rather than hard-coding 2.11.1. Versions 2.12–2.14 are not introduced by this change.
- **Archive consistency:** `insert`, `write`, and `str_replace` archive superseded content when different. Archive retention changes from unbounded to **at most 5** copies per source note; removed copies are pruned from disk and index. Identical content creates **0** new archives.
- **Index removal complexity:** Reverse per-file term sets reduce removed-file posting-list visits from total vocabulary size (N) to that file's distinct terms (k), while preserving CACHE_VERSION=3, cache round-trip and ranking. The earlier 25,000-term standalone benchmark was a synthetic demonstration and is superseded by the real VaultIndexer benchmark in 2.15.1.
- **Docs and cross-platform testing:** README adds MCP setup; acceptance covers bounded archives and reverse postings, MCP smoke-tests real JSON-RPC stdio; packaging checks include the adapter. No DLP features added.

### [2.15.0-hooks] - folded into 2.15.0

- **Opt-in brain-usage enforcement.** Hook assets ship with the extension, but 2.15.1 makes executable hook installation opt-in (default false), with a one-time informational prompt. The supported Copilot user-level folder can be used when enabled; workspace-owned hooks take precedence.
- The hook fires on `SessionStart`, `PostToolUse`, `PreCompact` and `Stop`: it injects the protocol at session start, reminds the agent when 5 tool calls pass with no brain save, and blocks completion once per session when nothing was saved.
- Installation is idempotent and non-destructive: every generated file carries an `obsidian-brain-managed` marker, and a file without that marker is treated as user-authored and never overwritten. Failures are logged and never block activation.
- `obsidianBrain.installAgentHooks` now defaults to `false` (opt-in); existing user-owned configurations are preserved.


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
