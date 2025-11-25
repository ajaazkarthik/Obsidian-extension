import * as vscode from 'vscode';
import { FilesystemBackend, SearchResult, DirectoryEntry } from './filesystemBackend.js';
import { VaultIndexer, IndexSearchResult } from './vaultIndexer.js';

interface BrainToolInput {
    operation: 'search' | 'list' | 'read' | 'write' | 'append' | 'quick_note' | 'str_replace' | 'insert' | 'delete' | 'move';
    query?: string;
    filepath?: string;
    content?: string;
    directory?: string;
    old_str?: string;
    new_str?: string;
    insert_line?: number;
    destination?: string;
}

// Brain header for visual feedback (compact version)
const BRAIN_HEADER = `🧠 ══════════════════════════════════════
        O B S I D I A N   B R A I N
══════════════════════════════════════ 🧠`;

/**
 * BrainTool provides a global knowledge store using an Obsidian vault.
 * Uses VaultIndexer for fast search, FilesystemBackend for file operations.
 */
export class BrainTool implements vscode.LanguageModelTool<BrainToolInput> {
    private filesystemBackend: FilesystemBackend;
    private indexer: VaultIndexer;
    private mcpAvailable: boolean | null = null;

    constructor(private context: vscode.ExtensionContext) {
        this.filesystemBackend = new FilesystemBackend();
        this.indexer = new VaultIndexer();
    }
    
    /**
     * Initialize the indexer - call this on extension activation
     */
    async initialize(): Promise<void> {
        await this.indexer.initialize();
    }
    
    /**
     * Force rebuild the entire index
     */
    async rebuildIndex(): Promise<void> {
        await this.indexer.rebuildIndex();
    }
    
    /**
     * Get indexer statistics
     */
    getIndexStats(): { fileCount: number; tagCount: number; wordCount: number; lastUpdated: Date } | null {
        return this.indexer.getStats();
    }

    /**
     * Check if Obsidian MCP is available
     */
    async checkObsidianMcpConnection(): Promise<boolean> {
        try {
            // Check if MCP tools are available by looking for obsidian tools
            const tools = await vscode.lm.tools;
            const obsidianTools = tools.filter(t => 
                t.name.includes('obsidian') || t.name.includes('mcp_mcp-obsidian')
            );
            this.mcpAvailable = obsidianTools.length > 0;
            return this.mcpAvailable;
        } catch {
            this.mcpAvailable = false;
            return false;
        }
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<BrainToolInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { operation, query, filepath, content, directory, old_str, new_str, insert_line, destination } = options.input;

        try {
            // Refresh vault path in case settings changed
            this.filesystemBackend.refreshVaultPath();

            let result: string;

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
                    result = await this.handleRead(filepath);
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

                default:
                    return this.errorResult(`Unknown operation: ${operation}`);
            }

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
            default:
                message = `${brain} Brain operation: ${operation}`;
        }

        return {
            invocationMessage: message
        };
    }

    private async handleSearch(query: string): Promise<string> {
        // Use VaultIndexer for fast search
        const results: IndexSearchResult[] = await this.indexer.search(query);

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
            } else if (result.firstLine) {
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

    private async handleRead(filepath: string): Promise<string> {
        const content = await this.filesystemBackend.readFile(filepath);
        return `${BRAIN_HEADER}\n📖 Reading: ${filepath}\n${'─'.repeat(40)}\n\n${content}`;
    }

    private async handleWrite(filepath: string, content: string): Promise<string> {
        await this.filesystemBackend.writeFile(filepath, content);
        // Immediately update index for instant searchability
        await this.indexer.indexFileImmediately(filepath);
        return `${BRAIN_HEADER}\n✅ Successfully wrote to "${filepath}"\n\n💾 Knowledge persisted to your brain! (indexed ⚡)`;
    }

    private async handleAppend(filepath: string, content: string): Promise<string> {
        await this.filesystemBackend.appendFile(filepath, content);
        // Immediately update index for instant searchability
        await this.indexer.indexFileImmediately(filepath);
        return `${BRAIN_HEADER}\n✅ Successfully appended to "${filepath}"\n\n🧠 Memory updated! (indexed ⚡)`;
    }

    private async handleQuickNote(content: string): Promise<string> {
        // Generate a timestamped filename for the quick note
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const filename = `_Inbox/${timestamp}.md`;
        
        // Add timestamp header to content
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0].substring(0, 5);
        const formattedContent = `## ${dateStr} ${timeStr}\n\n${content}\n`;
        
        await this.filesystemBackend.writeFile(filename, formattedContent);
        // Immediately update index for instant searchability
        await this.indexer.indexFileImmediately(filename);
        return `${BRAIN_HEADER}\n✅ Quick note saved to "${filename}"\n\n💡 Tip: Use brain-manager to organize _Inbox notes into proper directories. (indexed ⚡)`;
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
        
        await this.filesystemBackend.writeFile(filepath, newContent);
        // Immediately update index for instant searchability
        await this.indexer.indexFileImmediately(filepath);
        return `${BRAIN_HEADER}\n✅ Successfully updated "${filepath}"\n\n🔄 Brain synced! (indexed ⚡)`;
    }

    private async handleInsert(filepath: string, lineNumber: number, content: string): Promise<string> {
        let currentContent: string;
        try {
            currentContent = await this.filesystemBackend.readFile(filepath);
        } catch {
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

    private errorResult(message: string): vscode.LanguageModelToolResult {
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`${BRAIN_HEADER}\n❌ Error: ${message}`)
        ]);
    }
}
