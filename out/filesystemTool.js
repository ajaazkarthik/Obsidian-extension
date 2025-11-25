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
exports.FilesystemTool = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
/**
 * FilesystemTool provides integrated filesystem operations without external MCP dependency.
 * All paths are validated against allowed directories for security.
 */
class FilesystemTool {
    context;
    allowedDirectories;
    constructor(context) {
        this.context = context;
        this.allowedDirectories = this.buildAllowedDirectories();
    }
    /**
     * Build the list of allowed directories
     */
    buildAllowedDirectories() {
        const dirs = [];
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
        const vaultPath = config.get('vaultPath');
        if (vaultPath) {
            dirs.push(vaultPath);
        }
        // Add custom allowed directories from settings
        const customDirs = config.get('filesystemAllowedDirectories') || [];
        dirs.push(...customDirs);
        return dirs.map(d => this.normalizePath(d));
    }
    /**
     * Normalize a path for comparison
     */
    normalizePath(p) {
        return path.normalize(p).toLowerCase();
    }
    /**
     * Check if a path is within allowed directories
     */
    isPathAllowed(targetPath) {
        const normalizedTarget = this.normalizePath(targetPath);
        return this.allowedDirectories.some(allowed => normalizedTarget.startsWith(allowed) || normalizedTarget === allowed);
    }
    /**
     * Get list of allowed directories (for display)
     */
    getAllowedDirectories() {
        return [...new Set(this.allowedDirectories)];
    }
    /**
     * Refresh allowed directories from settings
     */
    refreshAllowedDirectories() {
        this.allowedDirectories = this.buildAllowedDirectories();
    }
    async invoke(options, token) {
        // Refresh allowed directories in case settings changed
        this.refreshAllowedDirectories();
        const { operation } = options.input;
        try {
            let result;
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
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return this.errorResult(`Operation '${operation}' failed: ${errorMsg}`);
        }
    }
    async prepareInvocation(options, token) {
        const { operation, path: filePath, source, destination } = options.input;
        let message;
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
    async handleReadFile(input) {
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
            }
            else if (input.tail !== undefined) {
                text = lines.slice(-input.tail).join('\n');
            }
        }
        return text;
    }
    async handleReadMultipleFiles(input) {
        if (!input.paths || input.paths.length === 0) {
            throw new Error('Paths array is required for read_multiple_files operation');
        }
        // Validate all paths first
        for (const p of input.paths) {
            if (!this.isPathAllowed(p)) {
                throw new Error(`Access denied: Path "${p}" is not in allowed directories`);
            }
        }
        const results = await Promise.all(input.paths.map(async (p) => {
            try {
                const uri = vscode.Uri.file(p);
                const content = await vscode.workspace.fs.readFile(uri);
                const text = new TextDecoder('utf-8').decode(content);
                return { path: p, content: text, error: null };
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                return { path: p, content: null, error: errorMsg };
            }
        }));
        let output = '';
        for (const result of results) {
            output += `\n=== ${result.path} ===\n`;
            if (result.error) {
                output += `Error: ${result.error}\n`;
            }
            else {
                output += result.content + '\n';
            }
        }
        return output;
    }
    async handleWriteFile(input) {
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
        }
        catch {
            // Directory might already exist
        }
        const data = new TextEncoder().encode(input.content);
        await vscode.workspace.fs.writeFile(uri, data);
        return `✅ Successfully wrote ${data.length} bytes to "${input.path}"`;
    }
    async handleListDirectory(input) {
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
    async handleDirectoryTree(input) {
        if (!input.path) {
            throw new Error('Path is required for directory_tree operation');
        }
        if (!this.isPathAllowed(input.path)) {
            throw new Error(`Access denied: Path "${input.path}" is not in allowed directories`);
        }
        const tree = await this.buildDirectoryTree(input.path, 0, 5);
        return JSON.stringify(tree, null, 2);
    }
    async buildDirectoryTree(dirPath, currentDepth, maxDepth) {
        const name = path.basename(dirPath) || dirPath;
        const node = {
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
                    const childNode = await this.buildDirectoryTree(entryPath, currentDepth + 1, maxDepth);
                    node.children.push(childNode);
                }
                else {
                    node.children.push({
                        name: entryName,
                        type: 'file'
                    });
                }
            }
        }
        catch {
            // Unable to read directory
        }
        return node;
    }
    async handleMoveFile(input) {
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
    async handleSearchFiles(input) {
        if (!input.path || !input.pattern) {
            throw new Error('Path and pattern are required for search_files operation');
        }
        if (!this.isPathAllowed(input.path)) {
            throw new Error(`Access denied: Path "${input.path}" is not in allowed directories`);
        }
        const regex = this.globToRegex(input.pattern);
        const matches = [];
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
    async searchFilesRecursive(dirPath, regex, matches, maxResults) {
        if (matches.length >= maxResults)
            return;
        try {
            const uri = vscode.Uri.file(dirPath);
            const entries = await vscode.workspace.fs.readDirectory(uri);
            for (const [name, type] of entries) {
                if (matches.length >= maxResults)
                    break;
                // Skip hidden files/directories
                if (name.startsWith('.'))
                    continue;
                const fullPath = path.join(dirPath, name);
                if (type === vscode.FileType.Directory) {
                    await this.searchFilesRecursive(fullPath, regex, matches, maxResults);
                }
                else if (regex.test(name)) {
                    matches.push(fullPath);
                }
            }
        }
        catch {
            // Unable to read directory
        }
    }
    globToRegex(glob) {
        let regex = glob
            .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars
            .replace(/\*\*/g, '<<<DOUBLESTAR>>>') // Preserve **
            .replace(/\*/g, '[^/]*') // * matches anything except /
            .replace(/<<<DOUBLESTAR>>>/g, '.*') // ** matches anything
            .replace(/\?/g, '.'); // ? matches single char
        return new RegExp(`^${regex}$`, 'i');
    }
    async handleCreateDirectory(input) {
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
    async handleGetFileInfo(input) {
        if (!input.path) {
            throw new Error('Path is required for get_file_info operation');
        }
        if (!this.isPathAllowed(input.path)) {
            throw new Error(`Access denied: Path "${input.path}" is not in allowed directories`);
        }
        const uri = vscode.Uri.file(input.path);
        const stat = await vscode.workspace.fs.stat(uri);
        const info = {
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
    formatSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let unitIndex = 0;
        let size = bytes;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }
    errorResult(message) {
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`❌ Error: ${message}`)
        ]);
    }
}
exports.FilesystemTool = FilesystemTool;
//# sourceMappingURL=filesystemTool.js.map