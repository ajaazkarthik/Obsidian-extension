import * as vscode from 'vscode';
interface FilesystemToolInput {
    operation: 'read_file' | 'read_multiple_files' | 'write_file' | 'list_directory' | 'directory_tree' | 'move_file' | 'search_files' | 'create_directory' | 'get_file_info';
    path?: string;
    paths?: string[];
    content?: string;
    pattern?: string;
    source?: string;
    destination?: string;
    head?: number;
    tail?: number;
}
/**
 * FilesystemTool provides integrated filesystem operations without external MCP dependency.
 * All paths are validated against allowed directories for security.
 */
export declare class FilesystemTool implements vscode.LanguageModelTool<FilesystemToolInput> {
    private context;
    private allowedDirectories;
    constructor(context: vscode.ExtensionContext);
    /**
     * Build the list of allowed directories
     */
    private buildAllowedDirectories;
    /**
     * Normalize a path for comparison
     */
    private normalizePath;
    /**
     * Check if a path is within allowed directories
     */
    private isPathAllowed;
    /**
     * Get list of allowed directories (for display)
     */
    getAllowedDirectories(): string[];
    /**
     * Refresh allowed directories from settings
     */
    refreshAllowedDirectories(): void;
    invoke(options: vscode.LanguageModelToolInvocationOptions<FilesystemToolInput>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult>;
    prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<FilesystemToolInput>, token: vscode.CancellationToken): Promise<vscode.PreparedToolInvocation>;
    private handleReadFile;
    private handleReadMultipleFiles;
    private handleWriteFile;
    private handleListDirectory;
    private handleDirectoryTree;
    private buildDirectoryTree;
    private handleMoveFile;
    private handleSearchFiles;
    private searchFilesRecursive;
    private globToRegex;
    private handleCreateDirectory;
    private handleGetFileInfo;
    private formatSize;
    private errorResult;
}
export {};
