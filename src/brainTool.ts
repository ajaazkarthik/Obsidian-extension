import * as vscode from 'vscode';
import { FilesystemBackend, DirectoryEntry, configuredVaultPath, normalizeNotePath, isFileNotFound } from './filesystemBackend.js';
import { VaultIndexer, IndexSearchResult } from './vaultIndexer.js';

interface BrainToolInput {
    operation: 'search' | 'list' | 'read' | 'write' | 'append' | 'quick_note' | 'str_replace' | 'insert' | 'delete' | 'move' | 'summarize_note' | 'list_recent' | 'auto_tag' | 'related_notes';
    query?: string;
    filepath?: string;
    content?: string;
    directory?: string;
    old_str?: string;
    new_str?: string;
    insert_line?: number;
    destination?: string;
    limit?: number;
    apply_tags?: boolean;
    max_chars?: number;  // FIX 5: optional char limit for inline read
}

const BRAIN_HEADER = '\u{1F9E0}';

/**
 * BrainTool provides a global knowledge store using an Obsidian vault.
 * Uses VaultIndexer for fast search, FilesystemBackend for file operations.
 */
export class BrainTool implements vscode.LanguageModelTool<BrainToolInput> {
    private filesystemBackend: FilesystemBackend;
    private indexer: VaultIndexer;
    // FIX 4: hash-dedup set for quick_note (session-scoped)
    private seenHashes = new Set<number>();
    // FIX 7+10: operation counter for auto-checkpoint reminders (every 12 ops)
    private operationCount = 0;
    private saveCount = 0;
    private saveActivity: string[] = [];
    private checkpointWrite: Promise<void> = Promise.resolve();
    private operationQueue: Promise<void> = Promise.resolve();

    constructor(private context: vscode.ExtensionContext) {
        this.filesystemBackend = new FilesystemBackend();
        this.indexer = new VaultIndexer();
    }
    
    /**
     * Initialize the indexer - call this on extension activation
     */
    private runExclusive<T>(action: () => Promise<T>): Promise<T> {
        const result = this.operationQueue.then(action);
        this.operationQueue = result.then(() => {}, () => {});
        return result;
    }

    async initialize(): Promise<void> {
        return this.runExclusive(() => this.synchronizeVault());
    }

    private async synchronizeVault(): Promise<void> {
        const desired = configuredVaultPath();
        if (this.filesystemBackend.getVaultPath() !== desired) {
            // Finish saves to the old vault before changing either backend.
            await this.checkpointWrite;
            await this.indexer.dispose();
            this.filesystemBackend.refreshVaultPath(desired);
            this.indexer = new VaultIndexer(desired);
            this.seenHashes.clear();
            this.saveCount = 0;
            this.saveActivity = [];
        }
        await this.indexer.initialize();
    }

    /** Force rebuild without racing tool writes or a vault switch. */
    async rebuildIndex(): Promise<void> {
        return this.runExclusive(async () => {
            await this.synchronizeVault();
            await this.indexer.rebuildIndex();
        });
    }

    /**
     * Get indexer statistics
     */
    getIndexStats(): { fileCount: number; tagCount: number; wordCount: number; lastUpdated: Date } | null {
        return this.indexer.getStats();
    }

    async dispose(): Promise<void> {
        await this.operationQueue;
        await this.checkpointWrite;
        await this.indexer.dispose();
    }

    /**
     * Record only completed saves. Checkpoint writes deliberately bypass this method.
     */
    private async recordSave(operation: string, filepath: string): Promise<void> {
        this.saveCount++;
        this.saveActivity.push(`${new Date().toISOString()} ${operation} ${filepath.replace(/[\r\n]/g, ' ')}`);
        this.saveActivity = this.saveActivity.slice(-20);
        if (this.saveCount % 3 !== 0) return;
        const checkpoint = `## ${new Date().toISOString()} — Checkpoint\n\nSave count: ${this.saveCount}\n\nRecent save activity (up to 20):\n${this.saveActivity.map(a => '- ' + a).join('\n')}\n`;
        this.checkpointWrite = this.checkpointWrite.then(async () => {
            try {
                const logPath = '_Inbox/session-activity-log.md';
                await this.filesystemBackend.appendFile(logPath, checkpoint);
                await this.indexer.indexFileImmediately(logPath);
            } catch (error) {
                console.log('[ObsidianBrain] Could not persist activity checkpoint:', error);
            }
        });
        await this.checkpointWrite;
    }

    /**
     * Preserve overwritten content as an indexed historical note.
     */
    private async archiveSuperseded(filepath: string, replacement: string): Promise<void> {
        if (!(await this.filesystemBackend.exists(filepath))) return;
        const previous = await this.filesystemBackend.readFile(filepath);
        if (previous === replacement) return;
        const clean = normalizeNotePath(filepath);
        if (clean.startsWith('_Archive/')) return;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const suffix = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
        const archived = `_Archive/${clean.replace(/\.md$/, '')}-${timestamp}-${suffix}.md`;
        await this.filesystemBackend.writeFile(archived, previous);
        await this.indexer.indexFileImmediately(archived);

        // Bound history per source note, while keeping all retained archives searchable.
        const slash = archived.lastIndexOf('/');
        const folder = archived.slice(0, slash);
        const stem = clean.replace(/\.md$/, '').split('/').pop()!;
        const copies = (await this.filesystemBackend.listDirectory(folder))
            .filter(entry => entry.type === 'file' && entry.name.startsWith(stem + '-') &&
                /^-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{4}\.md$/.test(entry.name.slice(stem.length)))
            .map(entry => entry.path).sort();
        for (const stale of copies.slice(0, Math.max(0, copies.length - 5))) {
            await this.filesystemBackend.deleteFile(stale);
            this.indexer.removeFileImmediately(stale);
        }
    }

    private resultLimit(limit: number | undefined, fallback: number): number {
        return limit !== undefined && Number.isFinite(limit) && limit > 0 ? Math.max(1, Math.floor(limit)) : fallback;
    }

    async checkConnection(): Promise<boolean> {
        return this.runExclusive(async () => {
            try {
                await this.synchronizeVault();
                const stat = await vscode.workspace.fs.stat(vscode.Uri.file(this.filesystemBackend.getVaultPath()));
                return (stat.type & vscode.FileType.Directory) !== 0;
            } catch {
                return false;
            }
        });
    }

    /** Kept for callers using the previous connection-check API. */
    async checkObsidianMcpConnection(): Promise<boolean> {
        return this.checkConnection();
    }

    // FIX 3+9: Auto-routing helper — routes quick_note content to correct vault directory
    private suggestRoute(content: string): string {
        const lower = content.toLowerCase();
        const highSpec: Record<string, string[]> = {
            Engineering: ['alter table', 'create index', 'create trigger', 'ddl script',
                'upgrade ddl', 'root cause', 'bug fix', 'production issue', 'error',
                'exception', 'stack trace', 'connection pool', 'jboss', 'oracle', 'sql',
                // FIX 9: checkpoint/session notes also route to Engineering
                'checkpoint', 'stress test', 'progress', 'subtask', 'session', 'completed'],
            Decisions: ['decision', 'adr', 'chose', 'rejected', 'trade-off',
                'alternative', 'rationale'],
            Playbooks: ['how to', 'step 1', 'step 2', 'runbook', 'procedure',
                'checklist', 'playbook'],
            Snippets: ['```', 'code snippet', 'reusable', 'pattern', 'template']
        };
        const medSpec = ['sql', 'ddl', 'table', 'column', 'index', 'trigger', 'procedure',
            'constraint', 'performance', 'memory', 'cpu', 'timeout', 'latency',
            'throughput', 'benchmark'];

        for (const [dir, keywords] of Object.entries(highSpec)) {
            if (keywords.some(k => lower.includes(k))) return dir + '/';
        }
        // FIX 8: medSpec fallback for Engineering — threshold 3+ (raised from 1+ in v2.6)
        const medMatches = medSpec.filter(k => lower.includes(k)).length;
        if (medMatches >= 3) return 'Engineering/';
        return '_Inbox/';
    }

    // FIX 4: djb2 hash for session-scoped deduplication
    private djb2(str: string): number {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
        }
        return hash >>> 0;
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<BrainToolInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        return this.runExclusive(() => this.invokeOperation(options, token));
    }

    private async invokeOperation(
        options: vscode.LanguageModelToolInvocationOptions<BrainToolInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        // FIX 5: added max_chars to destructuring
        const { operation, query, filepath, content, directory, old_str, new_str, insert_line, destination, limit, apply_tags, max_chars } = options.input;
        // FIX 7+10: increment and track operation count
        this.operationCount++;

        try {
            // Refresh vault path in case settings changed
            await this.synchronizeVault();

            let result: string;

            switch (operation) {
                case 'search':
                    if (!query) {
                        return this.errorResult('Search operation requires a query parameter');
                    }
                    result = await this.handleSearch(query, this.resultLimit(limit, 15));
                    break;

                case 'list':
                    result = await this.handleList(directory || '');
                    break;

                case 'read':
                    if (!filepath) {
                        return this.errorResult('Read operation requires a filepath parameter');
                    }
                    // FIX 5: pass max_chars to support AUTO_CAP and inline truncation
                    result = await this.handleRead(filepath, max_chars);
                    break;

                case 'write':
                    if (!filepath || content === undefined) {
                        return this.errorResult('Write operation requires filepath and content parameters');
                    }
                    result = await this.handleWrite(filepath, content);
                    break;

                case 'append':
                    if (!filepath || content === undefined) {
                        return this.errorResult('Append operation requires filepath and content parameters');
                    }
                    result = await this.handleAppend(filepath, content);
                    break;

                case 'quick_note':
                    if (!content) {
                        return this.errorResult('quick_note operation requires content parameter');
                    }
                    result = await this.handleQuickNote(content);
                    break;

                case 'str_replace':
                    if (!filepath || old_str === undefined || new_str === undefined) {
                        return this.errorResult('str_replace operation requires filepath, old_str, and new_str parameters');
                    }
                    result = await this.handleStrReplace(filepath, old_str, new_str);
                    break;

                case 'insert':
                    if (!filepath || insert_line === undefined || content === undefined) {
                        return this.errorResult('insert operation requires filepath, insert_line, and content parameters');
                    }
                    result = await this.handleInsert(filepath, insert_line, content);
                    break;

                case 'delete':
                    if (!filepath) {
                        return this.errorResult('delete operation requires filepath parameter');
                    }
                    result = await this.handleDelete(filepath);
                    break;

                case 'move':
                    if (!filepath || !destination) {
                        return this.errorResult('move operation requires filepath and destination parameters');
                    }
                    result = await this.handleMove(filepath, destination);
                    break;

                case 'summarize_note':
                    if (!filepath) {
                        return this.errorResult('summarize_note operation requires filepath parameter');
                    }
                    result = await this.handleSummarizeNote(filepath);
                    break;

                case 'list_recent':
                    result = await this.handleListRecent(this.resultLimit(limit, 10));
                    break;

                case 'related_notes':
                    if (!filepath) return this.errorResult('related_notes operation requires a filepath parameter');
                    await this.indexer.initialize();
                    result = this.handleRelatedNotes(filepath, this.resultLimit(limit, 10));
                    break;

                case 'auto_tag':
                    if (!filepath) {
                        return this.errorResult('auto_tag operation requires filepath parameter');
                    }
                    result = await this.handleAutoTag(filepath, apply_tags || false);
                    break;

                default:
                    return this.errorResult(`Unknown operation: ${operation}`);
            }

            result += this.saveReminder();

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(result)
            ]);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return this.errorResult(`Operation '${operation}' failed: ${errorMsg}`);
        }
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<BrainToolInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { operation, query, filepath, directory, destination } = options.input;

        // Brain emoji prefix for visual identification
        const brain = '🧠';
        
        let message: string;
        switch (operation) {
            case 'search':
                message = `${brain} Searching Obsidian brain for: "${query}"`;
                break;
            case 'list':
                message = `${brain} Browsing vault: ${directory || '/'}`;
                break;
            case 'read':
                message = `${brain} Reading from brain: ${filepath}`;
                break;
            case 'write':
                message = `${brain} Writing to brain: ${filepath}`;
                break;
            case 'append':
                message = `${brain} Appending to brain: ${filepath}`;
                break;
            case 'quick_note':
                message = `${brain} Saving quick note to brain...`;
                break;
            case 'str_replace':
                message = `${brain} Updating brain note: ${filepath}`;
                break;
            case 'insert':
                message = `${brain} Inserting into brain: ${filepath}`;
                break;
            case 'delete':
                message = `${brain} Removing from brain: ${filepath}`;
                break;
            case 'move':
                message = `${brain} Reorganizing brain: ${filepath} → ${destination}`;
                break;
            case 'summarize_note':
                message = `${brain} Summarizing note: ${filepath}`;
                break;
            case 'list_recent':
                message = `${brain} Listing recently modified notes...`;
                break;
            case 'related_notes':
                message = `${brain} Finding related notes: ${filepath}`;
                break;
            case 'auto_tag':
                message = `${brain} Analyzing and suggesting tags for: ${filepath}`;
                break;
            default:
                message = `${brain} Brain operation: ${operation}`;
        }

        return {
            invocationMessage: message
        };
    }

    private async handleSearch(query: string, shown: number): Promise<string> {
        // Use VaultIndexer for fast search
        const results: IndexSearchResult[] = await this.indexer.search(query, Math.max(shown, 20));

        if (results.length === 0) {
            return `${BRAIN_HEADER}\n🔍 No results found for "${query}" in the Obsidian vault.\n\n💡 Tip: Try different keywords, or use #tag to search by tag.`;
        }

        // Show index stats if available
        const stats = this.indexer.getStats();
        let output = `${BRAIN_HEADER}\n🔍 Found ${results.length} note(s) matching "${query}"`;
        if (stats) {
            output += ` (searched ${stats.fileCount} files)`;
        }
        output += `:\n\n`;

        for (const result of results.slice(0, shown)) {
            const scoreBar = '█'.repeat(Math.min(Math.ceil(result.score / 2), 5));
            output += `## ${result.title}\n`;
            output += `📁 ${result.filepath}\n`;
            output += `📊 Score: ${result.score.toFixed(1)} ${scoreBar} | Match: ${result.matchType}\n`;
            if (result.tags && result.tags.length > 0) {
                output += `🏷️ Tags: ${result.tags.slice(0, 8).map(t => '#' + t).join(', ')}${result.tags.length > 8 ? ` (+${result.tags.length - 8} more)` : ''}\n`;
            }
            if (result.context) {
                output += `📝 "${result.context}"\n`;
            } else if (result.firstLine) {
                output += `📝 ${result.firstLine}\n`;
            }
            output += '\n';
        }

        if (results.length > shown) {
            output += `\n... and ${results.length - shown} more results.`;
        }

        // Add search tips
        output += `\n---\n💡 Search tips: Use #tagname for tag search, multiple words use OR logic`;

        return output;
    }

    private async handleList(directory: string): Promise<string> {
        const entries: DirectoryEntry[] = await this.filesystemBackend.listDirectory(directory);

        if (entries.length === 0) {
            return `${BRAIN_HEADER}\n📂 Directory "${directory || '/'}" is empty or does not exist.`;
        }

        const vaultPath = this.filesystemBackend.getVaultPath();
        let output = `${BRAIN_HEADER}\n📂 Contents of ${directory || '/'} (vault: ${vaultPath}):\n\n`;

        const dirs = entries.filter(e => e.type === 'directory');
        const files = entries.filter(e => e.type === 'file');

        if (dirs.length > 0) {
            output += '📁 Directories:\n';
            for (const dir of dirs) {
                output += `  - ${dir.name}/\n`;
            }
            output += '\n';
        }

        if (files.length > 0) {
            output += '📄 Files:\n';
            for (const file of files) {
                output += `  - ${file.name}\n`;
            }
        }

        return output;
    }

    private async handleRead(filepath: string, max_chars?: number): Promise<string> {
        if (max_chars !== undefined && (!Number.isFinite(max_chars) || max_chars < 1)) {
            throw new Error('max_chars must be a positive numeric character cap');
        }
        const cap = max_chars === undefined ? 7000 : Math.floor(max_chars);
        const content = await this.filesystemBackend.readFile(filepath);
        const truncated = content.length > cap;
        return `${BRAIN_HEADER}\n📖 Reading: ${filepath}${truncated ? ` (truncated at ${cap} of ${content.length} chars)` : ''}\n${'─'.repeat(40)}\n\n${content.slice(0, cap)}${truncated ? '\n\n⚠️ Content truncated. Pass a larger explicit max_chars to read more (default cap: 7000).' : ''}`;
    }

    private async handleWrite(filepath: string, content: string): Promise<string> {
        await this.archiveSuperseded(filepath, content);
        await this.filesystemBackend.writeFile(filepath, content);
        // Immediately update index for instant searchability
        await this.indexer.indexFileImmediately(filepath);
        await this.recordSave('write', filepath);
        return `${BRAIN_HEADER}\n✅ Successfully wrote to "${filepath}"\n\n💾 Knowledge persisted to your brain! (indexed ⚡)`;
    }

    private async handleAppend(filepath: string, content: string): Promise<string> {
        await this.filesystemBackend.appendFile(filepath, content);
        // Immediately update index for instant searchability
        await this.indexer.indexFileImmediately(filepath);
        await this.recordSave('append', filepath);
        return `${BRAIN_HEADER}\n✅ Successfully appended to "${filepath}"\n\n🧠 Memory updated! (indexed ⚡)`;
    }

    // FIX 3+4+12: quick_note with auto-routing, hash-dedup, and collision-prevention suffix
    private async handleQuickNote(content: string): Promise<string> {
        // FIX 4: hash-dedup — skip if same content already saved this session
        const hash = this.djb2(content);
        if (this.seenHashes.has(hash)) {
            return `${BRAIN_HEADER}\n⚠️ Duplicate note skipped (same content already saved this session).`;
        }
        this.seenHashes.add(hash);
        // FIX 3: auto-route to correct directory instead of always _Inbox
        const routedDir = this.suggestRoute(content);
        const dir = routedDir.replace(/\/$/, '');
        // Generate a timestamped filename for the quick note
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, '-').substring(0, 19);
        // FIX 12: collision-prevention hex suffix to avoid parallel writes at same millisecond
        const suffix = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
        const filename = `${dir}/${timestamp}-${suffix}.md`;
        // Add timestamp header to content
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0].substring(0, 5);
        const formattedContent = `## ${dateStr} ${timeStr}\n\n${content}\n`;
        try {
            await this.filesystemBackend.writeFile(filename, formattedContent);
            await this.indexer.indexFileImmediately(filename);
        } catch (error) {
            this.seenHashes.delete(hash);
            throw error;
        }
        await this.recordSave('quick_note', filename);
        const routeMsg = dir !== '_Inbox' ? `\n📂 Auto-routed to ${dir}/ based on content.` : '';
        return `${BRAIN_HEADER}\n✅ Quick note saved to "${filename}"${routeMsg}\n\n💡 Tip: Use brain-manager to organize _Inbox notes into proper directories. (indexed ⚡)`;
    }

    private async handleStrReplace(filepath: string, oldStr: string, newStr: string): Promise<string> {
        // Read current content
        const currentContent = await this.filesystemBackend.readFile(filepath);
        
        // Check if old string exists
        if (!currentContent.includes(oldStr)) {
            return `${BRAIN_HEADER}\n❌ Could not find the specified text to replace in "${filepath}"`;
        }
        
        // Replace first occurrence
        const newContent = currentContent.replace(oldStr, newStr);
        
        await this.archiveSuperseded(filepath, newContent);
        await this.filesystemBackend.writeFile(filepath, newContent);
        await this.indexer.indexFileImmediately(filepath);
        await this.recordSave('str_replace', filepath);
        return `${BRAIN_HEADER}\n✅ Successfully updated "${filepath}"\n\n🔄 Brain synced! (indexed ⚡)`;
    }

    private async handleInsert(filepath: string, lineNumber: number, content: string): Promise<string> {
        let currentContent: string;
        try {
            currentContent = await this.filesystemBackend.readFile(filepath);
        } catch (error) {
            if (!isFileNotFound(error)) throw error;
            // File doesn't exist, create with just the content
            await this.filesystemBackend.writeFile(filepath, content);
            await this.indexer.indexFileImmediately(filepath);
            await this.recordSave('insert', filepath);
            return `${BRAIN_HEADER}\n✅ Created "${filepath}" with content\n\n🆕 New memory created! (indexed ⚡)`;
        }
        
        const lines = currentContent.split('\n');
        
        // Insert at specified line (1-indexed, 0 means prepend)
        const insertIndex = Math.min(Math.max(0, lineNumber - 1), lines.length);
        lines.splice(insertIndex, 0, content);
        
        const newContent = lines.join('\n');
        await this.archiveSuperseded(filepath, newContent);
        await this.filesystemBackend.writeFile(filepath, newContent);
        await this.indexer.indexFileImmediately(filepath);
        await this.recordSave('insert', filepath);
        return `${BRAIN_HEADER}\n✅ Inserted content at line ${lineNumber} in "${filepath}"\n\n📝 Brain updated! (indexed ⚡)`;
    }

    private async handleDelete(filepath: string): Promise<string> {
        await this.filesystemBackend.deleteFile(filepath);
        // Immediately remove from index
        this.indexer.removeFileImmediately(filepath);
        return `${BRAIN_HEADER}\n✅ Deleted "${filepath}"\n\n🗑️ Memory removed from brain. (index updated ⚡)`;
    }

    private async handleMove(filepath: string, destination: string): Promise<string> {
        await this.filesystemBackend.moveFile(filepath, destination);
        // Update index: remove old, add new
        this.indexer.removeFileImmediately(filepath);
        await this.indexer.indexFileImmediately(destination);
        return `${BRAIN_HEADER}\n✅ Moved "${filepath}" to "${destination}"\n\n📦 Memory reorganized! (index updated ⚡)`;
    }

    private async handleSummarizeNote(filepath: string): Promise<string> {
        const content = await this.filesystemBackend.readFile(filepath);
        
        // Extract metadata from index if available
        const indexedFile = this.indexer.getFileInfo(filepath);
        
        // Count statistics
        const lines = content.split('\n');
        const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
        const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 0).length;
        
        // Extract headings for structure
        const headings = lines.filter(line => line.match(/^#{1,6}\s+/));
        
        const tags = this.indexer.extractTags(content);

        // Extract key points (lines starting with - or *)
        const bulletPoints = lines.filter(line => line.match(/^\s*[-*]\s+/)).slice(0, 5);
        
        // Extract first meaningful paragraph for summary
        let summaryText = '';
        let inFrontmatter = false;
        for (const line of lines) {
            if (line.trim() === '---') {
                inFrontmatter = !inFrontmatter;
                continue;
            }
            if (inFrontmatter) continue;
            if (line.match(/^#/)) continue; // Skip headings
            if (line.trim().length > 50) {
                summaryText = line.trim().slice(0, 200);
                if (line.trim().length > 200) summaryText += '...';
                break;
            }
        }
        
        let output = `${BRAIN_HEADER}\n📋 **TL;DR Summary: ${filepath}**\n${'─'.repeat(40)}\n\n`;
        
        // Title
        const title = indexedFile?.title || filepath.split('/').pop()?.replace('.md', '') || 'Untitled';
        output += `## 📌 ${title}\n\n`;
        
        // Quick stats
        output += `**📊 Stats:** ${wordCount} words | ${lines.length} lines | ${paragraphs} paragraphs\n\n`;
        
        // Tags
        if (tags.length > 0) {
            output += `**🏷️ Tags:** ${tags.map(t => '#' + t).join(' ')}\n\n`;
        }
        
        // Structure (headings)
        if (headings.length > 0) {
            output += `**📑 Structure:**\n`;
            for (const h of headings.slice(0, 8)) {
                const level = (h.match(/^#+/) || [''])[0].length;
                const text = h.replace(/^#+\s*/, '');
                output += `${'  '.repeat(level - 1)}- ${text}\n`;
            }
            if (headings.length > 8) {
                output += `  ... and ${headings.length - 8} more sections\n`;
            }
            output += '\n';
        }
        
        // Summary/first paragraph
        if (summaryText) {
            output += `**📝 Summary:**\n${summaryText}\n\n`;
        }
        
        // Key points
        if (bulletPoints.length > 0) {
            output += `**🔑 Key Points:**\n`;
            for (const point of bulletPoints) {
                output += point + '\n';
            }
            output += '\n';
        }
        
        // Links mentioned
        const wikiLinks = content.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g) || [];
        if (wikiLinks.length > 0) {
            const uniqueLinks = [...new Set(wikiLinks.slice(0, 5))];
            output += `**🔗 References:** ${uniqueLinks.length} linked notes\n`;
        }
        
        return output;
    }

    private handleRelatedNotes(filepath: string, limit: number): string {
        const source = this.indexer.getFileInfo(filepath);
        if (!source) return `${BRAIN_HEADER}\n❌ Note not found in the index: ${filepath}`;
        if (source.tags.length === 0) return `${BRAIN_HEADER}\nNo related notes: "${filepath}" has no tags.`;
        const related = this.indexer.getRelatedNotes(filepath, limit);
        if (!related.length) return `${BRAIN_HEADER}\nNo related notes share tags with "${filepath}".`;
        return `${BRAIN_HEADER}\nRelated notes for "${filepath}":\n\n` + related.map(note =>
            `## ${note.title}\n📁 ${note.filepath} (${note.filename})\nScore: ${note.score.toFixed(3)} | Shared tags: ${note.sharedTags.map(t => '#' + t).join(', ')}`
        ).join('\n\n');
    }

    private async handleListRecent(limit: number): Promise<string> {
        // Get all indexed files sorted by modification time
        const recentFiles = this.indexer.getRecentFiles(limit);
        
        if (recentFiles.length === 0) {
            return `${BRAIN_HEADER}\n📅 No recent notes found. Try rebuilding the index.`;
        }
        
        let output = `${BRAIN_HEADER}\n📅 **Recently Modified Notes** (Last ${limit})\n${'─'.repeat(40)}\n\n`;
        
        for (const file of recentFiles) {
            const date = new Date(file.modified);
            const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            
            output += `### ${file.title}\n`;
            output += `📁 ${file.path}\n`;
            output += `🕐 ${dateStr} at ${timeStr}\n`;
            if (file.tags && file.tags.length > 0) {
                output += `🏷️ ${file.tags.slice(0, 5).map(t => '#' + t).join(' ')}\n`;
            }
            if (file.firstLine) {
                output += `📝 "${file.firstLine.slice(0, 80)}${file.firstLine.length > 80 ? '...' : ''}"\n`;
            }
            output += '\n';
        }
        
        return output;
    }

    private async handleAutoTag(filepath: string, applyTags: boolean): Promise<string> {
        const content = await this.filesystemBackend.readFile(filepath);
        
        const existingTags = new Set(this.indexer.extractTags(content).map(t => t.toLowerCase()));

        // Analyze content and suggest tags
        const suggestedTags = this.analyzeContentForTags(content);
        
        // Filter out existing tags
        const newTags = suggestedTags.filter(t => !existingTags.has(t.tag.toLowerCase()));

        // FIX 13: compute stale tag removals before building output
        const autoTagCandidates = ['database', 'testing', 'meeting-notes', 'api', 'devops',
            'security', 'performance', 'bugfix', 'refactoring', 'typescript', 'python', 'java',
            'frontend', 'backend', 'architecture', 'how-to', 'todo', 'research', 'snippet',
            'planning', 'release', 'retrospective', 'code-example'];
        // FIX 15: only count high-confidence suggestions (>=0.5) as content-supported
        const supportedByContent = new Set(
            suggestedTags.filter(t => t.confidence >= 0.5).map(t => t.tag.toLowerCase())
        );
        const staleTagRemovals: string[] = [];
        for (const existingTag of existingTags) {
            if (autoTagCandidates.includes(existingTag) && !supportedByContent.has(existingTag)) {
                staleTagRemovals.push(existingTag);
            }
        }
        
        let output = `${BRAIN_HEADER}\n🏷️ **Auto-Tag Analysis: ${filepath}**\n${'─'.repeat(40)}\n\n`;
        
        if (existingTags.size > 0) {
            output += `**Existing Tags:** ${Array.from(existingTags).map(t => '#' + t).join(' ')}\n\n`;
        }

        // FIX 13: show stale removals BEFORE new tag suggestions
        if (staleTagRemovals.length > 0) {
            output += `**⚠️ Suggested Removals** (tags no longer supported by content):\n`;
            for (const tag of staleTagRemovals) {
                output += `🔴 **#${tag}** — no matching content patterns found\n`;
            }
            output += '\n';
        }
        
        if (newTags.length === 0 && staleTagRemovals.length === 0) {
            output += `✅ No new tags suggested and no stale tags found. The note appears to be well-tagged!\n`;
            return output;
        }
        
        output += `**🆕 Suggested Tags:**\n`;
        for (const suggestion of newTags.slice(0, 10)) {
            const confidence = suggestion.confidence >= 0.8 ? '🟢' : suggestion.confidence >= 0.5 ? '🟡' : '🟠';
            output += `${confidence} **#${suggestion.tag}** (${Math.round(suggestion.confidence * 100)}%) - ${suggestion.reason}\n`;
        }
        output += '\n';
        
        if (applyTags && newTags.length > 0) {
            // Apply high-confidence tags
            const tagsToApply = newTags.filter(t => t.confidence >= 0.6).slice(0, 5);
            
            if (tagsToApply.length > 0) {
                const tagString = tagsToApply.map(t => '#' + t.tag).join(' ');
                
                // Find where to insert tags (after frontmatter or at start)
                let newContent = content;
                if (content.startsWith('---')) {
                    const endIndex = content.indexOf('---', 3);
                    if (endIndex !== -1) {
                        const insertPoint = endIndex + 4;
                        newContent = content.slice(0, insertPoint) + '\n' + tagString + '\n' + content.slice(insertPoint);
                    } else {
                        newContent = tagString + '\n\n' + content;
                    }
                } else {
                    // Insert after first heading or at start
                    const firstHeadingMatch = content.match(/^(#.+\n)/m);
                    if (firstHeadingMatch) {
                        const insertPoint = (firstHeadingMatch.index || 0) + firstHeadingMatch[0].length;
                        newContent = content.slice(0, insertPoint) + '\n' + tagString + '\n' + content.slice(insertPoint);
                    } else {
                        newContent = tagString + '\n\n' + content;
                    }
                }
                
                await this.filesystemBackend.writeFile(filepath, newContent);
                await this.indexer.indexFileImmediately(filepath);
                
                output += `✅ **Applied ${tagsToApply.length} tag(s):** ${tagsToApply.map(t => '#' + t.tag).join(' ')}\n`;
                output += `\n💡 Note has been updated and re-indexed!`;
            } else {
                output += `⚠️ No tags with confidence >= 60% to apply automatically.\n`;
                output += `💡 Consider adding suggested tags manually.`;
            }
        } else if (newTags.length > 0) {
            output += `💡 Use \`auto_tag\` with \`apply_tags: true\` to automatically add high-confidence tags.`;
        }
        
        return output;
    }

    /**
     * Analyze content and suggest relevant tags based on keywords and patterns
     */
    private analyzeContentForTags(content: string): Array<{ tag: string; confidence: number; reason: string }> {
        const suggestions: Array<{ tag: string; confidence: number; reason: string }> = [];
        const lowerContent = content.toLowerCase();
        
        // Category-based patterns
        const patterns: Array<{ pattern: RegExp | string[]; tag: string; reason: string; boost: number }> = [
            // Technical categories
            { pattern: ['api', 'endpoint', 'rest', 'graphql', 'webhook'], tag: 'api', reason: 'API-related content', boost: 1.0 },
            { pattern: ['database', 'sql', 'query', 'schema', 'migration'], tag: 'database', reason: 'Database content', boost: 1.0 },
            { pattern: ['docker', 'container', 'kubernetes', 'k8s', 'deploy'], tag: 'devops', reason: 'DevOps content', boost: 1.0 },
            { pattern: ['test', 'testing', 'unit test', 'integration', 'coverage'], tag: 'testing', reason: 'Testing content', boost: 1.0 },
            { pattern: ['security', 'auth', 'authentication', 'authorization', 'oauth'], tag: 'security', reason: 'Security content', boost: 1.0 },
            { pattern: ['performance', 'optimize', 'cache', 'latency', 'benchmark'], tag: 'performance', reason: 'Performance content', boost: 1.0 },
            { pattern: ['bug', 'fix', 'issue', 'error', 'debug'], tag: 'bugfix', reason: 'Bug fix content', boost: 0.8 },
            { pattern: ['refactor', 'cleanup', 'improve', 'restructure'], tag: 'refactoring', reason: 'Refactoring content', boost: 0.8 },
            
            // Languages & frameworks
            { pattern: ['typescript', 'javascript', 'node', 'npm', 'eslint'], tag: 'typescript', reason: 'TypeScript/JS content', boost: 1.0 },
            { pattern: ['python', 'pip', 'django', 'flask', 'pytorch'], tag: 'python', reason: 'Python content', boost: 1.0 },
            { pattern: ['java', 'maven', 'gradle', 'spring', 'jvm'], tag: 'java', reason: 'Java content', boost: 1.0 },
            { pattern: ['react', 'vue', 'angular', 'frontend', 'component'], tag: 'frontend', reason: 'Frontend content', boost: 1.0 },
            { pattern: ['backend', 'server', 'microservice', 'service'], tag: 'backend', reason: 'Backend content', boost: 0.9 },
            
            // Document types
            { pattern: ['decision', 'adr', 'architecture', 'design'], tag: 'architecture', reason: 'Architecture decision', boost: 1.0 },
            { pattern: ['how to', 'tutorial', 'guide', 'step by step', 'walkthrough'], tag: 'how-to', reason: 'Tutorial/guide content', boost: 1.0 },
            { pattern: ['meeting', 'notes', 'discussion', 'standup'], tag: 'meeting-notes', reason: 'Meeting notes', boost: 0.9 },
            { pattern: ['todo', 'task', 'action item', 'follow up'], tag: 'todo', reason: 'Contains action items', boost: 0.7 },
            { pattern: ['research', 'analysis', 'investigation', 'findings'], tag: 'research', reason: 'Research content', boost: 0.9 },
            { pattern: ['snippet', 'code', 'example', 'pattern'], tag: 'snippet', reason: 'Code snippet/pattern', boost: 0.8 },
            
            // Project stages
            { pattern: ['planning', 'roadmap', 'milestone', 'timeline'], tag: 'planning', reason: 'Planning content', boost: 0.9 },
            { pattern: ['release', 'changelog', 'version', 'deployment'], tag: 'release', reason: 'Release content', boost: 0.9 },
            { pattern: ['retrospective', 'retro', 'lesson learned', 'postmortem'], tag: 'retrospective', reason: 'Retrospective content', boost: 1.0 },
        ];
        
        for (const { pattern, tag, reason, boost } of patterns) {
            let matchCount = 0;
            
            if (Array.isArray(pattern)) {
                for (const keyword of pattern) {
                    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
                    const matches = lowerContent.match(regex);
                    if (matches) {
                        matchCount += matches.length;
                    }
                }
            }
            
            if (matchCount > 0) {
                // Confidence based on match count, capped at 0.95
                const confidence = Math.min(0.95, (matchCount / 3) * boost * 0.5 + 0.3);
                suggestions.push({ tag, confidence, reason: `${reason} (${matchCount} matches)` });
            }
        }
        
        // Check for code blocks (suggests code-related note)
        const codeBlockCount = (content.match(/```/g) || []).length / 2;
        if (codeBlockCount >= 1) {
            suggestions.push({ 
                tag: 'code-example', 
                confidence: Math.min(0.9, 0.5 + codeBlockCount * 0.1), 
                reason: `Contains ${Math.floor(codeBlockCount)} code block(s)` 
            });
        }
        
        // Sort by confidence descending
        suggestions.sort((a, b) => b.confidence - a.confidence);
        
        // Remove duplicates (keep highest confidence)
        const seen = new Set<string>();
        return suggestions.filter(s => {
            if (seen.has(s.tag)) return false;
            seen.add(s.tag);
            return true;
        });
    }

    private saveReminder(): string {
        return this.operationCount > 0 && this.operationCount % 12 === 0
            ? `\n\n⚠️ AUTO-CHECKPOINT REMINDER (#${this.operationCount} ops this session): Save useful progress → obsidian_brain(operation="quick_note", content="Progress: [facts and next steps]").`
            : '';
    }

    private errorResult(message: string): vscode.LanguageModelToolResult {
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`${BRAIN_HEADER}\n❌ Error: ${message}${this.saveReminder()}`)
        ]);
    }
}
