# Obsidian Brain

Obsidian Brain 2.11.1 is a native VS Code language model tool for persistent knowledge in an Obsidian vault. It exposes one tool, `obsidian_brain`, with no separate memory, filesystem or chat-history tool and no MCP server requirement.

Leave `obsidianBrain.vaultPath` blank for automatic setup: Windows uses `C:\workspace\obsidian-vault`; macOS and Linux use `~/workspace/obsidian-vault`. The extension creates the default vault and standard folders on first use. Set an absolute path (or `~/…`) to use an existing vault instead. Paths remain machine-specific with workspace overrides supported, and are resolved on the extension host, including SSH/WSL hosts.

Use **Configure Obsidian Vault** to choose an existing folder through the native folder picker. Invalid or inaccessible explicit paths produce configuration errors instead of empty search results. A changed setting switches both file I/O and the index without reloading VS Code. The extension retains **Check Obsidian Vault Connection**, **Open Obsidian Vault** and **Rebuild Brain Index** commands. Existing agents can continue to reference `obsidian_brain` by name.

## Operations

| Operation | Behavior |
| --- | --- |
| `search` | Scored title, filename, tag, heading and body search; multiword OR; `limit` defaults to 15 |
| `list` | Browse a vault directory |
| `read` | Inline note content, capped at 7,000 characters by default; pass a larger explicit `max_chars` after truncation |
| `write` | Create or overwrite a note; preserve different overwritten content under `_Archive/` |
| `append` | Add content to a note |
| `quick_note` | Content-based routing, session hash deduplication, timestamp and random suffix |
| `str_replace` | Replace the first exact match and archive superseded content |
| `insert` | Insert at a 1-based line or create a missing note |
| `delete` | Delete a note and remove index postings |
| `move` | Move a note and update indexed paths |
| `summarize_note` | Factual local TL;DR, headings, statistics and canonical tags |
| `list_recent` | Recently modified notes; `limit` defaults to 10 |
| `auto_tag` | Content-based tag suggestions; optional `apply_tags` uses the existing 60% threshold |
| `related_notes` | Explicit shared-tag retrieval; rare tags carry more weight; `limit` defaults to 10; no LLM calls |

Search displays at most eight tags per hit, while the full tag set remains indexed. Body terms and queries use the same tokenizer and ordered suffix stemming. Body ranking uses document frequency and occurrence counts, followed by tiered recency and an archive penalty.

The version-3 disk cache stores file metadata and compact path-ID tag and counted word postings. Startup reconciles new, changed and deleted notes. Invalid or incomplete caches rebuild safely. Tool writes update the in-memory index immediately; watcher disk-cache writes coalesce for five seconds. Disposal flushes pending persistence.

Inline tags exclude code fences, inline code, URL fragments, line anchors and six/eight-character hex colours containing digits. YAML bracket arrays and block lists work with LF and CRLF. Indexing, summaries and auto-tag filtering share the same extractor.

Every third successful `write`, `append`, `quick_note`, `str_replace` or `insert` appends a timestamped save count and up to 20 recent activity entries to `_Inbox/session-activity-log.md`. Duplicate captures and failed saves do not count. Every 12 operations, a reminder asks you to save useful progress. Checkpoints record file activity; the extension does not monitor context or token usage and emits no automatic compaction directives.

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

The package script compiles the maintained TypeScript, runs acceptance checks, builds `releases/obsidian-brain-2.11.1.vsix`, inspects its manifest and runtime, and reruns the suite against the extracted package. It does not install the extension or reload VS Code. The package contains runtime modules, declarations, prompts, the agent and project metadata; source maps remain in the checkout alongside generated JavaScript.

The acceptance harness uses the actual compiled `BrainTool` and `VaultIndexer`, a minimal VS Code shim, uniquely named disposable vaults, controlled timestamps and mocked timers. Focused groups can run with `node test/acceptance.cjs index`, `tags`, `timers`, `operations` , `registration` or `platform`. `BRAIN_RUNTIME` selects a different compiled runtime for package verification. `test/baseline.cjs` documents the defects reproduced against the original 2.9 runtime; run it only with `BRAIN_RUNTIME` pointing at that isolated baseline.

Live VS Code UI behavior, host-managed response spilling and performance on a production vault require separate integration verification. No recall-quality, response-size or cache-size improvement percentage is claimed.

## License

MIT. Publisher and extension identity remain `ubanishathanvenkatesan.obsidian-brain`.

CI runs the compile, acceptance and packaged-runtime checks on Windows, macOS and Linux. Vault operations run in sequence so parallel appends and setting changes preserve content. Read failures from file locks or permissions are reported; only missing files are created by append/insert.
