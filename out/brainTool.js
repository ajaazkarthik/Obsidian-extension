"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrainTool = void 0;
const vscode = __importStar(require("vscode"));
const filesystemBackend_js_1 = require("./filesystemBackend.js");
const vaultIndexer_js_1 = require("./vaultIndexer.js");
// Brain header for visual feedback (compact version)
const BRAIN_HEADER = `🧠 ══════════════════════════════════════
        O B S I D I A N   B R A I N  v2.9
══════════════════════════════════════ 🧠`;
/**
 * BrainTool provides a global knowledge store using an Obsidian vault.
 * Uses VaultIndexer for fast search, FilesystemBackend for file operations.
 */
class BrainTool {
    context;
    filesystemBackend;
    indexer;
    mcpAvailable = null;
    // FIX 4: hash-dedup set for quick_note (session-scoped)
    seenHashes = new Set();
    // FIX 7+10: operation counter for auto-checkpoint reminders (every 12 ops)
    operationCount = 0;
    constructor(context) {
        this.context = context;
        this.filesystemBackend = new filesystemBackend_js_1.FilesystemBackend();
        this.indexer = new vaultIndexer_js_1.VaultIndexer();
    }
    /**
     * Initialize the indexer - call this on extension activation
     */
    async initialize() {
        await this.indexer.initialize();
    }
    /**
     * Force rebuild the entire index
     */
    async rebuildIndex() {
        await this.indexer.rebuildIndex();
    }
    /**
     * Get indexer statistics
     */
    getIndexStats() {
        return this.indexer.getStats();
    }
    /**
     * Check if Obsidian MCP is available
     */
    async checkObsidianMcpConnection() {
        try {
            // Check if MCP tools are available by looking for obsidian tools
            const tools = await vscode.lm.tools;
            const obsidianTools = tools.filter(t => t.name.includes('obsidian') || t.name.includes('mcp_mcp-obsidian'));
            this.mcpAvailable = obsidianTools.length > 0;
            return this.mcpAvailable;
        }
        catch {
            this.mcpAvailable = false;
            return false;
        }
    }
    // FIX 3+9: Auto-routing helper — routes quick_note content to correct vault directory
    suggestRoute(content) {
        const lower = content.toLowerCase();
        const highSpec = {
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
            if (keywords.some(k => lower.includes(k)))
                return dir + '/';
        }
        // FIX 8: medSpec fallback for Engineering — threshold 3+ (raised from 1+ in v2.6)
        const medMatches = medSpec.filter(k => lower.includes(k)).length;
        if (medMatches >= 3)
            return 'Engineering/';
        return '_Inbox/';
    }
    // FIX 4: djb2 hash for session-scoped deduplication
    djb2(str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
        }
        return hash >>> 0;
    }
    async invoke(options, token) {
        // FIX 5: added max_chars to destructuring
        const { operation, query, filepath, content, directory, old_str, new_str, insert_line, destination, limit, apply_tags, max_chars } = options.input;
        // FIX 7+10: increment and track operation count
        this.operationCount++;
        try {
            // Refresh vault path in case settings changed
            this.filesystemBackend.refreshVaultPath();
            let result;
            switch (operation) {
                case 'search':
                    if (!query) {
                        return this.errorResult('Search operation requires a query parameter');
                    }
                    result = await this.handleSearch(query);
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
                    result = await this.handleListRecent(limit || 10);
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
            // FIX 7+10: auto-checkpoint reminder every 12 operations
            if (this.operationCount % 12 === 0) {
                result += `\n\n⚠️ AUTO-CHECKPOINT REMINDER (#${this.operationCount} ops this session): Save progress now → obsidian_brain(operation="quick_note", content="Checkpoint: [summary]") to prevent context loss.`;
            }
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(result)
            ]);
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return this.errorResult(`Operation '${operation}' failed: ${errorMsg}`);
        }
    }
    async prepareInvocation(options, token) {
        const { operation, query, filepath, directory, destination } = options.input;
        // Brain emoji prefix for visual identification
        const brain = '🧠';
        let message;
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
    async handleSearch(query) {
        // Use VaultIndexer for fast search
        const results = await this.indexer.search(query);
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
        for (const result of results.slice(0, 15)) {
            const scoreBar = '█'.repeat(Math.min(Math.ceil(result.score / 2), 5));
            output += `## ${result.title}\n`;
            output += `📁 ${result.filepath}\n`;
            output += `📊 Score: ${result.score.toFixed(1)} ${scoreBar} | Match: ${result.matchType}\n`;
            if (result.tags && result.tags.length > 0) {
                output += `🏷️ Tags: ${result.tags.map(t => '#' + t).join(', ')}\n`;
            }
            if (result.context) {
                output += `📝 "${result.context}"\n`;
            }
            else if (result.firstLine) {
                output += `📝 ${result.firstLine}\n`;
            }
            output += '\n';
        }
        if (results.length > 15) {
            output += `\n... and ${results.length - 15} more results.`;
        }
        // Add search tips
        output += `\n---\n💡 Search tips: Use #tagname for tag search, multiple words use OR logic`;
        return output;
    }
    async handleList(directory) {
        const entries = await this.filesystemBackend.listDirectory(directory);
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
    // FIX 5+11: inline read with AUTO_CAP=7000 and optional max_chars limit
    async handleRead(filepath, max_chars) {
        const AUTO_CAP = 7000;
        const content = await this.filesystemBackend.readFile(filepath);
        if (max_chars !== undefined) {
            const truncated = content.slice(0, max_chars);
            return `${BRAIN_HEADER}\n📖 Reading: ${filepath} (first ${max_chars} chars)\n${'\u2500'.repeat(40)}\n\n${truncated}`;
        }
        if (content.length <= AUTO_CAP) {
            return `${BRAIN_HEADER}\n📖 Reading: ${filepath}\n${'\u2500'.repeat(40)}\n\n${content}`;
        }
        // FIX 11: large files always return inline (never temp-file), truncated with warning
        return `${BRAIN_HEADER}\n📖 Reading: ${filepath} (truncated at ${AUTO_CAP} chars — use max_chars to read more)\n${'\u2500'.repeat(40)}\n\n${content.slice(0, AUTO_CAP)}\n\n⚠️ Content truncated. Pass max_chars=N to read more.`;
    }
    async handleWrite(filepath, content) {
        await this.filesystemBackend.writeFile(filepath, content);
        // Immediately update index for instant searchability
        await this.indexer.indexFileImmediately(filepath);
        return `${BRAIN_HEADER}\n✅ Successfully wrote to "${filepath}"\n\n💾 Knowledge persisted to your brain! (indexed ⚡)`;
    }
    async handleAppend(filepath, content) {
        await this.filesystemBackend.appendFile(filepath, content);
        // Immediately update index for instant searchability
        await this.indexer.indexFileImmediately(filepath);
        return `${BRAIN_HEADER}\n✅ Successfully appended to "${filepath}"\n\n🧠 Memory updated! (indexed ⚡)`;
    }
    // FIX 3+4+12: quick_note with auto-routing, hash-dedup, and collision-prevention suffix
    async handleQuickNote(content) {
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
        await this.filesystemBackend.writeFile(filename, formattedContent);
        // Immediately update index for instant searchability
        await this.indexer.indexFileImmediately(filename);
        const routeMsg = dir !== '_Inbox' ? `\n📂 Auto-routed to ${dir}/ based on content.` : '';
        return `${BRAIN_HEADER}\n✅ Quick note saved to "${filename}"${routeMsg}\n\n💡 Tip: Use brain-manager to organize _Inbox notes into proper directories. (indexed ⚡)`;
    }
    async handleStrReplace(filepath, oldStr, newStr) {
        // Read current content
        const currentContent = await this.filesystemBackend.readFile(filepath);
        // Check if old string exists
        if (!currentContent.includes(oldStr)) {
            return `${BRAIN_HEADER}\n❌ Could not find the specified text to replace in "${filepath}"`;
        }
        // Replace first occurrence
        const newContent = currentContent.replace(oldStr, newStr);
        await this.filesystemBackend.writeFile(filepath, newContent);
        // Immediately update index for instant searchability
        await this.indexer.indexFileImmediately(filepath);
        return `${BRAIN_HEADER}\n✅ Successfully updated "${filepath}"\n\n🔄 Brain synced! (indexed ⚡)`;
    }
    async handleInsert(filepath, lineNumber, content) {
        let currentContent;
        try {
            currentContent = await this.filesystemBackend.readFile(filepath);
        }
        catch {
            // File doesn't exist, create with just the content
            await this.filesystemBackend.writeFile(filepath, content);
            await this.indexer.indexFileImmediately(filepath);
            return `${BRAIN_HEADER}\n✅ Created "${filepath}" with content\n\n🆕 New memory created! (indexed ⚡)`;
        }
        const lines = currentContent.split('\n');
        // Insert at specified line (1-indexed, 0 means prepend)
        const insertIndex = Math.min(Math.max(0, lineNumber - 1), lines.length);
        lines.splice(insertIndex, 0, content);
        const newContent = lines.join('\n');
        await this.filesystemBackend.writeFile(filepath, newContent);
        await this.indexer.indexFileImmediately(filepath);
        return `${BRAIN_HEADER}\n✅ Inserted content at line ${lineNumber} in "${filepath}"\n\n📝 Brain updated! (indexed ⚡)`;
    }
    async handleDelete(filepath) {
        await this.filesystemBackend.deleteFile(filepath);
        // Immediately remove from index
        this.indexer.removeFileImmediately(filepath);
        return `${BRAIN_HEADER}\n✅ Deleted "${filepath}"\n\n🗑️ Memory removed from brain. (index updated ⚡)`;
    }
    async handleMove(filepath, destination) {
        await this.filesystemBackend.moveFile(filepath, destination);
        // Update index: remove old, add new
        this.indexer.removeFileImmediately(filepath);
        await this.indexer.indexFileImmediately(destination);
        return `${BRAIN_HEADER}\n✅ Moved "${filepath}" to "${destination}"\n\n📦 Memory reorganized! (index updated ⚡)`;
    }
    async handleSummarizeNote(filepath) {
        const content = await this.filesystemBackend.readFile(filepath);
        // Extract metadata from index if available
        const indexedFile = this.indexer.getFileInfo(filepath);
        // Count statistics
        const lines = content.split('\n');
        const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
        const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 0).length;
        // Extract headings for structure
        const headings = lines.filter(line => line.match(/^#{1,6}\s+/));
        // Extract tags
        const tagRegex = /#([a-zA-Z][a-zA-Z0-9_-]*)/g;
        const tags = new Set();
        let match;
        while ((match = tagRegex.exec(content))) {
            tags.add(match[1]);
        }
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
            if (inFrontmatter)
                continue;
            if (line.match(/^#/))
                continue; // Skip headings
            if (line.trim().length > 50) {
                summaryText = line.trim().slice(0, 200);
                if (line.trim().length > 200)
                    summaryText += '...';
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
        if (tags.size > 0) {
            output += `**🏷️ Tags:** ${Array.from(tags).map(t => '#' + t).join(' ')}\n\n`;
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
    async handleListRecent(limit) {
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
    async handleAutoTag(filepath, applyTags) {
        const content = await this.filesystemBackend.readFile(filepath);
        // Existing tags
        const existingTags = new Set();
        const tagRegex = /#([a-zA-Z][a-zA-Z0-9_-]*)/g;
        let match;
        while ((match = tagRegex.exec(content))) {
            existingTags.add(match[1].toLowerCase());
        }
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
        const supportedByContent = new Set(suggestedTags.filter(t => t.confidence >= 0.5).map(t => t.tag.toLowerCase()));
        const staleTagRemovals = [];
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
                    }
                    else {
                        newContent = tagString + '\n\n' + content;
                    }
                }
                else {
                    // Insert after first heading or at start
                    const firstHeadingMatch = content.match(/^(#.+\n)/m);
                    if (firstHeadingMatch) {
                        const insertPoint = (firstHeadingMatch.index || 0) + firstHeadingMatch[0].length;
                        newContent = content.slice(0, insertPoint) + '\n' + tagString + '\n' + content.slice(insertPoint);
                    }
                    else {
                        newContent = tagString + '\n\n' + content;
                    }
                }
                await this.filesystemBackend.writeFile(filepath, newContent);
                await this.indexer.indexFileImmediately(filepath);
                output += `✅ **Applied ${tagsToApply.length} tag(s):** ${tagsToApply.map(t => '#' + t.tag).join(' ')}\n`;
                output += `\n💡 Note has been updated and re-indexed!`;
            }
            else {
                output += `⚠️ No tags with confidence >= 60% to apply automatically.\n`;
                output += `💡 Consider adding suggested tags manually.`;
            }
        }
        else if (newTags.length > 0) {
            output += `💡 Use \`auto_tag\` with \`apply_tags: true\` to automatically add high-confidence tags.`;
        }
        return output;
    }
    /**
     * Analyze content and suggest relevant tags based on keywords and patterns
     */
    analyzeContentForTags(content) {
        const suggestions = [];
        const lowerContent = content.toLowerCase();
        // Category-based patterns
        const patterns = [
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
        const seen = new Set();
        return suggestions.filter(s => {
            if (seen.has(s.tag))
                return false;
            seen.add(s.tag);
            return true;
        });
    }
    errorResult(message) {
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`${BRAIN_HEADER}\n❌ Error: ${message}`)
        ]);
    }
}
exports.BrainTool = BrainTool;
//# sourceMappingURL=brainTool.js.map