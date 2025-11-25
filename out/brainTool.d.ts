import * as vscode from 'vscode';
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
/**
 * BrainTool provides a global knowledge store using an Obsidian vault.
 * Uses VaultIndexer for fast search, FilesystemBackend for file operations.
 */
export declare class BrainTool implements vscode.LanguageModelTool<BrainToolInput> {
    private context;
    private filesystemBackend;
    private indexer;
    private mcpAvailable;
    constructor(context: vscode.ExtensionContext);
    /**
     * Initialize the indexer - call this on extension activation
     */
    initialize(): Promise<void>;
    /**
     * Force rebuild the entire index
     */
    rebuildIndex(): Promise<void>;
    /**
     * Get indexer statistics
     */
    getIndexStats(): {
        fileCount: number;
        tagCount: number;
        wordCount: number;
        lastUpdated: Date;
    } | null;
    /**
     * Check if Obsidian MCP is available
     */
    checkObsidianMcpConnection(): Promise<boolean>;
    invoke(options: vscode.LanguageModelToolInvocationOptions<BrainToolInput>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult>;
    prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<BrainToolInput>, token: vscode.CancellationToken): Promise<vscode.PreparedToolInvocation>;
    private handleSearch;
    private handleList;
    private handleRead;
    private handleWrite;
    private handleAppend;
    private handleQuickNote;
    private handleStrReplace;
    private handleInsert;
    private handleDelete;
    private handleMove;
    private errorResult;
}
export {};
