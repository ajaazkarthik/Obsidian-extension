export declare const CACHE_VERSION = 3;
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
    bodyWordCount: number;
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
    wordIndex: Map<string, Map<string, number>>;
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
export interface RelatedNote {
    filepath: string;
    filename: string;
    title: string;
    score: number;
    sharedTags: string[];
}
export declare class VaultIndexer {
    private readonly configuredPath?;
    private index;
    private vaultPath;
    private watcher;
    private indexing;
    private initialized;
    private debounceTimers;
    private initialization;
    private cacheSaveTimer;
    private cacheDirty;
    private cacheWrite;
    private pendingUpdates;
    private disposed;
    constructor(configuredPath?: string | undefined);
    refreshVaultPath(): void;
    /**
     * Initialize the index - call this on extension activation
     */
    initialize(): Promise<void>;
    private initializeIndex;
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
     * Get information about a specific indexed file
     */
    getFileInfo(filepath: string): IndexedFile | null;
    /**
     * Get recently modified files sorted by modification time (most recent first)
     */
    getRecentFiles(limit?: number): IndexedFile[];
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
    /** Canonical tags shared by indexing, summaries and auto-tag analysis. */
    extractTags(content: string): string[];
    private extractHeadings;
    private extractLinks;
    private extractFirstLine;
    private tokenize;
    private stem;
    getRelatedNotes(filepath: string, limit?: number): RelatedNote[];
    private hashContent;
    private getCachePath;
    private trackUpdate;
    private scheduleCacheSave;
    private saveToCache;
    private loadFromCache;
    /** Cancel timers, finish queued indexing and persist pending changes. */
    dispose(): Promise<void>;
}
