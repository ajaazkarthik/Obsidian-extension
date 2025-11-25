/**
 * VaultIndexer provides fast search capabilities by maintaining an in-memory index
 * of the Obsidian vault. It watches for file changes and updates incrementally.
 */
export interface IndexedFile {
    path: string;
    filename: string;
    title: string;
    modified: number;
    contentHash: number;
    tags: string[];
    headings: HeadingInfo[];
    links: string[];
    firstLine: string;
    wordCount: number;
}
export interface HeadingInfo {
    level: number;
    text: string;
    line: number;
}
export interface VaultIndex {
    version: number;
    vaultPath: string;
    lastUpdated: number;
    files: Map<string, IndexedFile>;
    tagIndex: Map<string, Set<string>>;
    wordIndex: Map<string, Set<string>>;
}
export interface IndexSearchResult {
    filepath: string;
    filename: string;
    title: string;
    score: number;
    matchType: 'title' | 'tag' | 'heading' | 'content' | 'filename';
    context?: string;
    tags?: string[];
    firstLine?: string;
}
export declare class VaultIndexer {
    private index;
    private vaultPath;
    private watcher;
    private indexing;
    private initialized;
    private debounceTimers;
    constructor();
    refreshVaultPath(): void;
    /**
     * Initialize the index - call this on extension activation
     */
    initialize(): Promise<void>;
    /**
     * Check if index is ready
     */
    isReady(): boolean;
    /**
     * Get index statistics
     */
    getStats(): {
        fileCount: number;
        tagCount: number;
        wordCount: number;
        lastUpdated: Date;
    } | null;
    /**
     * Immediately index a specific file (call after writes for instant searchability)
     */
    indexFileImmediately(filepath: string): Promise<void>;
    /**
     * Remove a file from index immediately (call after deletes)
     */
    removeFileImmediately(filepath: string): void;
    /**
     * Smart search with OR logic for multiple words, tag support, and scoring
     */
    search(query: string, limit?: number): Promise<IndexSearchResult[]>;
    /**
     * Get all tags in the vault
     */
    getAllTags(): string[];
    /**
     * Full index rebuild
     */
    rebuildIndex(): Promise<void>;
    /**
     * Incremental update - only reindex changed files
     */
    private deltaUpdate;
    /**
     * Collect all markdown file paths
     */
    private collectFiles;
    /**
     * Recursively index a directory
     */
    private indexDirectory;
    /**
     * Index a single file
     */
    private indexFile;
    /**
     * Remove a file from all indexes
     */
    private removeFromIndex;
    /**
     * Start file watcher for live updates
     */
    private startWatcher;
    private onFileCreated;
    private onFileChanged;
    private onFileDeleted;
    private getRelativePath;
    private extractTitle;
    private extractTags;
    private extractHeadings;
    private extractLinks;
    private extractFirstLine;
    private tokenize;
    private hashContent;
    private getCachePath;
    private saveToCache;
    private loadFromCache;
    /**
     * Dispose of resources
     */
    dispose(): void;
}
