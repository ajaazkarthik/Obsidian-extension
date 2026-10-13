import * as vscode from 'vscode';
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
    max_chars?: number;
}
/**
 * BrainTool provides a global knowledge store using an Obsidian vault.
 * Uses VaultIndexer for fast search, FilesystemBackend for file operations.
 */
export declare class BrainTool implements vscode.LanguageModelTool<BrainToolInput> {
    private context;
    private filesystemBackend;
    private indexer;
    private seenHashes;
    private operationCount;
    private saveCount;
    private saveActivity;
    private checkpointWrite;
    private operationQueue;
    constructor(context: vscode.ExtensionContext);
    /**
     * Initialize the indexer - call this on extension activation
     */
    private runExclusive;
    initialize(): Promise<void>;
    private synchronizeVault;
    /** Force rebuild without racing tool writes or a vault switch. */
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
    dispose(): Promise<void>;
    /**
     * Record only completed saves. Checkpoint writes deliberately bypass this method.
     */
    private recordSave;
    /**
     * Preserve overwritten content as an indexed historical note.
     */
    private archiveSuperseded;
    private resultLimit;
    checkConnection(): Promise<boolean>;
    /** Kept for callers using the previous connection-check API. */
    checkObsidianMcpConnection(): Promise<boolean>;
    private suggestRoute;
    private djb2;
    invoke(options: vscode.LanguageModelToolInvocationOptions<BrainToolInput>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult>;
    private invokeOperation;
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
    private handleSummarizeNote;
    private handleRelatedNotes;
    private handleListRecent;
    private handleAutoTag;
    /**
     * Analyze content and suggest relevant tags based on keywords and patterns
     */
    private analyzeContentForTags;
    private saveReminder;
    private errorResult;
}
export {};
