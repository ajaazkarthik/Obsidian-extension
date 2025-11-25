import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

interface FilesystemToolInput {
    operation: 'read_file' | 'read_multiple_files' | 'write_file' | 'list_directory' | 
               'directory_tree' | 'move_file' | 'search_files' | 'create_directory' | 'get_file_info';
    path?: string;
    paths?: string[];
    content?: string;
    pattern?: string;
    source?: string;
    destination?: string;
    head?: number;
    tail?: number;
}

interface DirectoryTreeNode {
    name: string;
    type: 'file' | 'directory';
    children?: DirectoryTreeNode[];
}

interface FileInfo {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size: number;
    created: Date;
    modified: Date;
}

/**
 * FilesystemTool provides integrated filesystem operations without external MCP dependency.
 * All paths are validated against allowed directories for security.
 */
export class FilesystemTool implements vscode.LanguageModelTool<FilesystemToolInput> {
    private allowedDirectories: string[];

    constructor(private context: vscode.ExtensionContext) {
        this.allowedDirectories = this.buildAllowedDirectories();
    }

    /**
     * Build the list of allowed directories
     */
    private buildAllowedDirectories(): string[] {
        const dirs: string[] = [];

        // Add workspace folders
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                dirs.push(folder.uri.fsPath);
            }
        }

        // Add user home directory
        const homeDir = os.homedir();
        if (homeDir) {
            dirs.push(homeDir);
        }

        // Add common roots (Windows)
        const commonRoots = [
            'C:\\workspace',
            'C:\\Users',
            'C:\\repos',
            'D:\\workspace',
            'D:\\repos'
        ];
        dirs.push(...commonRoots);

        // Add common roots (Unix)
        dirs.push('/home', '/Users', '/workspace', '/repos');

        // Add configured Obsidian vault path
        const config = vscode.workspace.getConfiguration('obsidianBrain');
        const vaultPath = config.get<string>('vaultPath');
        if (vaultPath) {
            dirs.push(vaultPath);
        }

        // Add custom allowed directories from settings
        const customDirs = config.get<string[]>('filesystemAllowedDirectories') || [];
        dirs.push(...customDirs);

        return dirs.map(d => this.normalizePath(d));
    }

    /**
     * Normalize a path for comparison
     */
    private normalizePath(p: string): string {
        return path.normalize(p).toLowerCase();
    }

    /**
     * Check if a path is within allowed directories
     */
    private isPathAllowed(targetPath: string): boolean {
        const normalizedTarget = this.normalizePath(targetPath);
        return this.allowedDirectories.some(allowed => 
            normalizedTarget.startsWith(allowed) || normalizedTarget === allowed
        );
    }

    /**
     * Get list of allowed directories (for display)
     */
    getAllowedDirectories(): string[] {
        return [...new Set(this.allowedDirectories)];
    }

    /**
     * Refresh allowed directories from settings
     */
    refreshAllowedDirectories(): void {
        this.allowedDirectories = this.buildAllowedDirectories();
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<FilesystemToolInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        // Refresh allowed directories in case settings changed
        this.refreshAllowedDirectories();

        const { operation } = options.input;

        try {
            let result: string;

            switch (operation) {
                case 'read_file':
                    result = await this.handleReadFile(options.input);
                    break;
                case 'read_multiple_files':
                    result = await this.handleReadMultipleFiles(options.input);
                    break;
                case 'write_file':
                    result = await this.handleWriteFile(options.input);
                    break;
                case 'list_directory':
                    result = await this.handleListDirectory(options.input);
                    break;
                case 'directory_tree':
                    result = await this.handleDirectoryTree(options.input);
                    break;
                case 'move_file':
                    result = await this.handleMoveFile(options.input);
                    break;
                case 'search_files':
                    result = await this.handleSearchFiles(options.input);
                    break;
                case 'create_directory':
                    result = await this.handleCreateDirectory(options.input);
                    break;
                case 'get_file_info':
                    result = await this.handleGetFileInfo(options.input);
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
        options: vscode.LanguageModelToolInvocationPrepareOptions<FilesystemToolInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { operation, path: filePath, source, destination } = options.input;

        let message: string;
        switch (operation) {
            case 'read_file':
                message = `Reading file: ${filePath}`;
                break;
            case 'read_multiple_files':
                message = `Reading multiple files`;
                break;
            case 'write_file':
                message = `Writing file: ${filePath}`;
                break;
            case 'list_directory':
                message = `Listing directory: ${filePath}`;
                break;
            case 'directory_tree':
                message = `Getting directory tree: ${filePath}`;
                break;
            case 'move_file':
                message = `Moving ${source} to ${destination}`;
                break;
            case 'search_files':
                message = `Searching files in: ${filePath}`;
                break;
            case 'create_directory':
                message = `Creating directory: ${filePath}`;
                break;
            case 'get_file_info':
                message = `Getting file info: ${filePath}`;
                break;
            default:
                message = `Performing filesystem operation: ${operation}`;
        }

        return {
            invocationMessage: message
        };
    }

    private async handleReadFile(input: FilesystemToolInput): Promise<string> {
        if (!input.path) {
            throw new Error('Path is required for read_file operation');
        }

        if (!this.isPathAllowed(input.path)) {
            throw new Error(`Access denied: Path "${input.path}" is not in allowed directories`);
        }

        const uri = vscode.Uri.file(input.path);
        const content = await vscode.workspace.fs.readFile(uri);
        let text = new TextDecoder('utf-8').decode(content);

        // Handle head/tail options
        if (input.head !== undefined || input.tail !== undefined) {
            const lines = text.split('\n');
            if (input.head !== undefined) {
                text = lines.slice(0, input.head).join('\n');
            } else if (input.tail !== undefined) {
                text = lines.slice(-input.tail).join('\n');
            }
        }

        return text;
    }

    private async handleReadMultipleFiles(input: FilesystemToolInput): Promise<string> {
        if (!input.paths || input.paths.length === 0) {
            throw new Error('Paths array is required for read_multiple_files operation');
        }

        // Validate all paths first
        for (const p of input.paths) {
            if (!this.isPathAllowed(p)) {
                throw new Error(`Access denied: Path "${p}" is not in allowed directories`);
            }
        }

        const results = await Promise.all(
            input.paths.map(async (p) => {
                try {
                    const uri = vscode.Uri.file(p);
                    const content = await vscode.workspace.fs.readFile(uri);
                    const text = new TextDecoder('utf-8').decode(content);
                    return { path: p, content: text, error: null };
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    return { path: p, content: null, error: errorMsg };
                }
            })
        );

        let output = '';
        for (const result of results) {
            output += `\n=== ${result.path} ===\n`;
            if (result.error) {
                output += `Error: ${result.error}\n`;
            } else {
                output += result.content + '\n';
            }
        }

        return output;
    }

    private async handleWriteFile(input: FilesystemToolInput): Promise<string> {
        if (!input.path) {
            throw new Error('Path is required for write_file operation');
        }
        if (input.content === undefined) {
            throw new Error('Content is required for write_file operation');
        }

        if (!this.isPathAllowed(input.path)) {
            throw new Error(`Access denied: Path "${input.path}" is not in allowed directories`);
        }

        const uri = vscode.Uri.file(input.path);
        
        // Ensure parent directory exists
        const parentDir = path.dirname(input.path);
        const parentUri = vscode.Uri.file(parentDir);
        try {
            await vscode.workspace.fs.createDirectory(parentUri);
        } catch {
            // Directory might already exist
        }

        const data = new TextEncoder().encode(input.content);
        await vscode.workspace.fs.writeFile(uri, data);

        return `✅ Successfully wrote ${data.length} bytes to "${input.path}"`;
    }

    private async handleListDirectory(input: FilesystemToolInput): Promise<string> {
        if (!input.path) {
            throw new Error('Path is required for list_directory operation');
        }

        if (!this.isPathAllowed(input.path)) {
            throw new Error(`Access denied: Path "${input.path}" is not in allowed directories`);
        }

        const uri = vscode.Uri.file(input.path);
        const entries = await vscode.workspace.fs.readDirectory(uri);

        let output = `Contents of ${input.path}:\n\n`;

        const sorted = entries.sort((a, b) => {
            if (a[1] !== b[1]) {
                return a[1] === vscode.FileType.Directory ? -1 : 1;
            }
            return a[0].localeCompare(b[0]);
        });

        for (const [name, type] of sorted) {
            const prefix = type === vscode.FileType.Directory ? '[DIR]  ' : '[FILE] ';
            output += `${prefix}${name}\n`;
        }

        return output;
    }

    private async handleDirectoryTree(input: FilesystemToolInput): Promise<string> {
        if (!input.path) {
            throw new Error('Path is required for directory_tree operation');
        }

        if (!this.isPathAllowed(input.path)) {
            throw new Error(`Access denied: Path "${input.path}" is not in allowed directories`);
        }

        const tree = await this.buildDirectoryTree(input.path, 0, 5);
        return JSON.stringify(tree, null, 2);
    }

    private async buildDirectoryTree(
        dirPath: string, 
        currentDepth: number, 
        maxDepth: number
    ): Promise<DirectoryTreeNode> {
        const name = path.basename(dirPath) || dirPath;
        const node: DirectoryTreeNode = {
            name,
            type: 'directory',
            children: []
        };

        if (currentDepth >= maxDepth) {
            return node;
        }

        try {
            const uri = vscode.Uri.file(dirPath);
            const entries = await vscode.workspace.fs.readDirectory(uri);

            for (const [entryName, type] of entries) {
                // Skip hidden files/directories
                if (entryName.startsWith('.')) {
                    continue;
                }

                const entryPath = path.join(dirPath, entryName);

                if (type === vscode.FileType.Directory) {
                    const childNode = await this.buildDirectoryTree(
                        entryPath, 
                        currentDepth + 1, 
                        maxDepth
                    );
                    node.children!.push(childNode);
                } else {
                    node.children!.push({
                        name: entryName,
                        type: 'file'
                    });
                }
            }
        } catch {
            // Unable to read directory
        }

        return node;
    }

    private async handleMoveFile(input: FilesystemToolInput): Promise<string> {
        if (!input.source || !input.destination) {
            throw new Error('Source and destination are required for move_file operation');
        }

        if (!this.isPathAllowed(input.source)) {
            throw new Error(`Access denied: Source path "${input.source}" is not in allowed directories`);
        }
        if (!this.isPathAllowed(input.destination)) {
            throw new Error(`Access denied: Destination path "${input.destination}" is not in allowed directories`);
        }

        const sourceUri = vscode.Uri.file(input.source);
        const destUri = vscode.Uri.file(input.destination);

        await vscode.workspace.fs.rename(sourceUri, destUri);

        return `✅ Successfully moved "${input.source}" to "${input.destination}"`;
    }

    private async handleSearchFiles(input: FilesystemToolInput): Promise<string> {
        if (!input.path || !input.pattern) {
            throw new Error('Path and pattern are required for search_files operation');
        }

        if (!this.isPathAllowed(input.path)) {
            throw new Error(`Access denied: Path "${input.path}" is not in allowed directories`);
        }

        const regex = this.globToRegex(input.pattern);
        const matches: string[] = [];
        await this.searchFilesRecursive(input.path, regex, matches, 100);

        if (matches.length === 0) {
            return `No files found matching pattern "${input.pattern}" in "${input.path}"`;
        }

        let output = `Found ${matches.length} file(s) matching "${input.pattern}":\n\n`;
        for (const match of matches) {
            output += `${match}\n`;
        }

        return output;
    }

    private async searchFilesRecursive(
        dirPath: string,
        regex: RegExp,
        matches: string[],
        maxResults: number
    ): Promise<void> {
        if (matches.length >= maxResults) return;

        try {
            const uri = vscode.Uri.file(dirPath);
            const entries = await vscode.workspace.fs.readDirectory(uri);

            for (const [name, type] of entries) {
                if (matches.length >= maxResults) break;

                // Skip hidden files/directories
                if (name.startsWith('.')) continue;

                const fullPath = path.join(dirPath, name);

                if (type === vscode.FileType.Directory) {
                    await this.searchFilesRecursive(fullPath, regex, matches, maxResults);
                } else if (regex.test(name)) {
                    matches.push(fullPath);
                }
            }
        } catch {
            // Unable to read directory
        }
    }

    private globToRegex(glob: string): RegExp {
        let regex = glob
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape special chars
            .replace(/\*\*/g, '<<<DOUBLESTAR>>>')   // Preserve **
            .replace(/\*/g, '[^/]*')                // * matches anything except /
            .replace(/<<<DOUBLESTAR>>>/g, '.*')     // ** matches anything
            .replace(/\?/g, '.');                    // ? matches single char
        
        return new RegExp(`^${regex}$`, 'i');
    }

    private async handleCreateDirectory(input: FilesystemToolInput): Promise<string> {
        if (!input.path) {
            throw new Error('Path is required for create_directory operation');
        }

        if (!this.isPathAllowed(input.path)) {
            throw new Error(`Access denied: Path "${input.path}" is not in allowed directories`);
        }

        const uri = vscode.Uri.file(input.path);
        await vscode.workspace.fs.createDirectory(uri);

        return `✅ Successfully created directory "${input.path}"`;
    }

    private async handleGetFileInfo(input: FilesystemToolInput): Promise<string> {
        if (!input.path) {
            throw new Error('Path is required for get_file_info operation');
        }

        if (!this.isPathAllowed(input.path)) {
            throw new Error(`Access denied: Path "${input.path}" is not in allowed directories`);
        }

        const uri = vscode.Uri.file(input.path);
        const stat = await vscode.workspace.fs.stat(uri);

        const info: FileInfo = {
            name: path.basename(input.path),
            path: input.path,
            type: stat.type === vscode.FileType.Directory ? 'directory' : 'file',
            size: stat.size,
            created: new Date(stat.ctime),
            modified: new Date(stat.mtime)
        };

        let output = `File Information:\n\n`;
        output += `Name: ${info.name}\n`;
        output += `Path: ${info.path}\n`;
        output += `Type: ${info.type}\n`;
        output += `Size: ${this.formatSize(info.size)}\n`;
        output += `Created: ${info.created.toISOString()}\n`;
        output += `Modified: ${info.modified.toISOString()}\n`;

        return output;
    }

    private formatSize(bytes: number): string {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let unitIndex = 0;
        let size = bytes;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }

    private errorResult(message: string): vscode.LanguageModelToolResult {
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`❌ Error: ${message}`)
        ]);
    }
}
