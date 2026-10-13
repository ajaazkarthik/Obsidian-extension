/** Resolve configuration on the extension host (including remote hosts). */
export declare function resolveVaultPath(configured: string | undefined, platform?: NodeJS.Platform, home?: string): string;
export declare function configuredVaultPath(): string;
export declare function normalizeNotePath(filepath: string): string;
/** VS Code and Node-based harnesses use different missing-file error codes. */
export declare function isFileNotFound(error: unknown): boolean;
/** Create only the automatic default; explicit vaults must already be accessible. */
export declare function prepareVault(vaultPath: string): Promise<void>;
/** Native vault I/O shared by the tool and indexer on every supported platform. */
export declare class FilesystemBackend {
    private vaultPath;
    /**
     * Get the current vault path
     */
    getVaultPath(): string;
    /**
     * Refresh the vault path from settings
     */
    refreshVaultPath(vaultPath?: string): void;
    /**
     * Resolve a relative path within the vault to an absolute path
     */
    resolvePath(relativePath: string): string;
    /**
     * Check if a file or directory exists
     */
    exists(filePath: string): Promise<boolean>;
    /**
     * Read a file's content
     */
    readFile(filePath: string): Promise<string>;
    /**
     * Write content to a file (creates directories if needed)
     */
    writeFile(filePath: string, content: string): Promise<void>;
    /**
     * Append content to an existing file or create if doesn't exist
     */
    appendFile(filePath: string, content: string): Promise<void>;
    /**
     * Ensure a directory exists (creates recursively if needed)
     */
    ensureDirectory(dirPath: string): Promise<void>;
    /**
     * Delete a file or directory
     */
    deleteFile(filePath: string): Promise<void>;
    /**
     * Move/rename a file or directory
     */
    moveFile(sourcePath: string, destPath: string): Promise<void>;
    /**
     * List contents of a directory
     */
    listDirectory(dirPath?: string): Promise<DirectoryEntry[]>;
    /**
     * Search for text in all markdown files
     */
    search(query: string): Promise<SearchResult[]>;
    /**
     * Recursively search through directories
     */
    private searchRecursive;
    /**
     * Find all matches of query in content with context
     */
    private findMatches;
}
export interface DirectoryEntry {
    name: string;
    type: 'file' | 'directory';
    path: string;
}
export interface SearchResult {
    filename: string;
    filepath: string;
    matches: MatchContext[];
}
export interface MatchContext {
    context: string;
    position: number;
}
