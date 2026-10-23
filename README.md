# Obsidian Brain

Obsidian Brain 2.15.2 is a native VS Code language model tool for persistent knowledge in an Obsidian vault. It exposes one tool, `obsidian_brain`, with no separate memory, filesystem or chat-history tool. VS Code needs no MCP server; an optional zero-dependency MCP stdio adapter also makes the same tool available in Claude Code.

Leave `obsidianBrain.vaultPath` blank for automatic setup: Windows uses `C:\workspace\obsidian-vault`; macOS and Linux use `~/workspace/obsidian-vault`. The extension creates the default vault and standard folders on first use. Set an absolute path (or `~/…`) to use an existing vault instead. Paths remain machine-specific with workspace overrides supported, and are resolved on the extension host, including SSH/WSL hosts.

Use **Configure Obsidian Vault** to choose an existing folder through the native folder picker. Invalid or inaccessible explicit paths produce configuration errors instead of empty search results. A changed setting switches both file I/O and the index without reloading VS Code. The extension retains **Check Obsidian Vault Connection**, **Open Obsidian Vault** and **Rebuild Brain Index** commands. Existing agents can continue to reference `obsidian_brain` by name.

## Operations

| Operation | Behavior |
| --- | --- |
| `search` | Scored title, filename, tag, heading and body search; multiword OR; `limit` defaults to 15 |
| `list` | Browse a vault directory |
| `read` | Inline note content, capped at 7,000 characters by default; pass a larger explicit `max_chars` after truncation |
| `write` | Create or overwrite a note; preserve different overwritten content under `_Archive/` (maximum five historical copies per source note) |
| `append` | Add content to a note |
| `quick_note` | Content-based routing, session hash deduplication, timestamp and random suffix |
| `str_replace` | Replace the first exact match and archive superseded content |
| `insert` | Insert at a 1-based line or create a missing note; archive the prior version when content changes |
| `delete` | Delete a note and remove index postings |
| `move` | Move a note and update indexed paths |
| `summarize_note` | Factual local TL;DR, headings, statistics and canonical tags |
| `list_recent` | Recently modified notes; `limit` defaults to 10 |
| `auto_tag` | Content-based tag suggestions; optional `apply_tags` uses the existing 60% threshold |
| `related_notes` | Explicit shared-tag retrieval; rare tags carry more weight; `limit` defaults to 10; no LLM calls |

Search displays at most eight tags per hit, while the full tag set remains indexed. Body terms and queries use the same tokenizer and ordered suffix stemming. Body ranking uses document frequency and occurrence counts, followed by tiered recency and an archive penalty.

The version-3 disk cache stores file metadata and compact path-ID tag and counted word postings. Startup reconciles new, changed and deleted notes. Invalid or incomplete caches rebuild safely. Tool writes update the in-memory index immediately; watcher disk-cache writes coalesce for five seconds. Disposal flushes pending persistence.

Inline tags exclude code fences, inline code, URL fragments, line anchors and six/eight-character hex colours containing digits. YAML bracket arrays and block lists work with LF and CRLF. Indexing, summaries and auto-tag filtering share the same extractor.

Every successful `write`, `append`, `quick_note`, `str_replace` or `insert` appends a single timestamped record to the hidden, unindexed `.obsidian-brain/saves.log` (rotated at 2,001 lines, retaining 1,000). Every third save additionally updates the indexed `_Inbox/session-activity-log.md` Markdown checkpoint with up to 20 recent actions. The checkpoint is intentionally excluded from search hits, so a search for `append` returns notes, not the activity summary. Duplicate captures and failed saves do not count. Every 12 operations, a reminder asks you to save useful progress. Checkpoints record file activity; the extension does not monitor context or token usage and emits no automatic compaction directives.

## Claude Code via MCP (optional)

The shipped `server/dist/index.js` implements **newline-delimited JSON-RPC 2.0** on standard input/output, including `initialize`, `tools/list`, `tools/call`, and notifications. It loads the same compiled `out/brainTool.js` as the VS Code extension, and exposes the exact one-tool schema from `package.json`. The adapter requires no MCP SDK, network service, VS Code process or new runtime dependency. Logs and errors go to stderr; stdout contains protocol messages only.

Set `OBSIDIAN_VAULT_PATH` to an **existing absolute directory** on the machine that runs the server. The following is a user-scoped Claude Code setup after `npm ci && npm run compile` (replace both absolute paths; use a disposable vault when testing):

```sh
claude mcp add --env OBSIDIAN_VAULT_PATH=/absolute/path/to/obsidian-vault --transport stdio --scope user obsidian-brain -- node /absolute/path/to/Obsidian-extension/server/dist/index.js
claude mcp list
```

You can also run the server directly with `OBSIDIAN_VAULT_PATH=/absolute/path/to/vault node server/dist/index.js`. Send one JSON-RPC request per line; do not mix interactive prompts or log output with its stdin. The adapter processes requests serially so two writes never interleave. Verify with `npm test`, which launches the real server and checks initialize, tool discovery, a search and a write using a uniquely named disposable vault. MCP does not add DLP, remote access or token-handling features.

## Brain-usage enforcement (opt-in)

**Hooks are disabled by default** in 2.15.2. Enabling `obsidianBrain.installAgentHooks` installs executable hooks into the [supported Copilot user hook directory](https://code.visualstudio.com/docs/agent-customization/hooks): `~/.copilot/hooks/` (or `$COPILOT_HOME/hooks/`). On first activation, the extension displays an informational prompt offering to enable them. VS Code's **Copilot session target** must be selected; Claude and Codex harnesses have their own event contracts.

The installed JSON uses Copilot hook schema `version: 1`, `sessionStart`, `postToolUse`, `preCompact`, and `agentStop`, and `timeoutSec`. The hook script is Python 3; if the runtime cannot locate the Python interpreter, installation skips without blocking the extension. Executable hook installation remains explicit and all user-owned hook files are preserved. Only an older marker-owned configuration is removed on opt-out.

Each successful brain save immediately records one timestamped line in the hidden `.obsidian-brain/saves.log`, allowing the guard to detect the **first** successful save without re-indexing the vault; the every-third-save Markdown checkpoint summary remains. Rotation preserves the last 1,000 lines and the hook supports sessions spanning that rotation. `agentStop` is blocked once when no save was recorded. An existing workspace `.github/hooks/*.json` stop guard disables creation of a duplicate user hook config. `PreCompact` does **not** mention PROGRESS.md.

The Copilot user paths are documented, but this release does not claim a manual live editor lifecycle confirmation. Verify activation with VS Code's Hooks customization view and the selected session harness before relying on enforced behaviour. The Python guard is best-effort and not a security boundary.

## Prompts and organization

The five prompt contributions remain: `brain-remember`, `brain-recall`, `brain-summarize`, `brain-compress` and `brain-auto-save`, plus the `brain-usage` instructions. Summaries and handoffs are explicitly requested through these prompts.

Use `Engineering/`, `Playbooks/`, `Decisions/` and `Snippets/` for reusable knowledge. Store workspace progress through the same brain tool in `_Workspaces/[workspace]/`. Quick captures route according to content, falling back to `_Inbox/`. The existing brain-manager agent is retained.

## Build and verification

With Node and the existing development dependencies available:

```sh
npm run compile
npm test
npm run package
```

The package script compiles the maintained TypeScript, runs acceptance checks, builds `releases/obsidian-brain-2.15.2.vsix`, inspects its manifest, MCP adapter and runtime, and reruns both acceptance and MCP tests against the extracted package. It does not install the extension or reload VS Code. The package contains runtime modules, declarations, prompts, the hook assets, the agent and project metadata; source maps remain in the checkout alongside generated JavaScript.

The acceptance harness uses the actual compiled `BrainTool` and `VaultIndexer`, a minimal VS Code shim, uniquely named disposable vaults, controlled timestamps and mocked timers. The MCP test exercises the real stdio process and verifies stdout protocol hygiene. Focused groups can run with `node test/acceptance.cjs index`, `tags`, `timers`, `operations` , `registration`, `platform` or `hooks`. `BRAIN_RUNTIME` selects a different compiled runtime for package verification. `test/baseline.cjs` documents the defects reproduced against the original 2.9 runtime; run it only with `BRAIN_RUNTIME` pointing at that isolated baseline.

Live VS Code UI behavior, host-managed response spilling and performance on a production vault require separate integration verification. No recall-quality, response-size or cache-size improvement percentage is claimed.

## License

MIT. Publisher and extension identity remain `ubanishathanvenkatesan.obsidian-brain`.

CI runs the compile, acceptance, packaged-runtime, real index-removal and real 300-append performance checks on Windows, macOS and Linux. Vault operations run in sequence so parallel appends and setting changes preserve content. Read failures from file locks or permissions are reported; only missing files are created by append/insert.

Generated `out/`, `node_modules/` and `*.vsix` are deliberately **untracked**. Cross-platform CI on Windows, macOS and Linux installs dependencies, compiles, tests and packages from source. `node research/measure-index-removal.cjs` exercises the real compiled VaultIndexer with 1,000 disposable notes, timing 100 removals using the previous vocabulary-scan method and the reverse per-file postings, on the same corpus.
