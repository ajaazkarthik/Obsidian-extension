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
exports.FilesystemBackend = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
/**
 * FilesystemBackend provides direct filesystem access to the Obsidian vault
 * using VS Code's workspace.fs API. This is used as a fallback when Obsidian MCP is unavailable.
 */
class FilesystemBackend {
    vaultPath;
    constructor() {
        const config = vscode.workspace.getConfiguration('obsidianBrain');
        this.vaultPath = config.get('vaultPath') || 'C:\\workspace\\obsidian-vault';
    }
    /**
     * Get the current vault path
     */
    getVaultPath() {
        return this.vaultPath;
    }
    /**
     * Refresh the vault path from settings
     */
    refreshVaultPath() {
        const config = vscode.workspace.getConfiguration('obsidianBrain');
        this.vaultPath = config.get('vaultPath') || 'C:\\workspace\\obsidian-vault';
    }
    /**
     * Resolve a relative path within the vault to an absolute path
     */
    resolvePath(relativePath) {
        // Remove leading slash if present
        const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
        return path.join(this.vaultPath, cleanPath);
    }
    /**
     * Check if a file or directory exists
     */
    async exists(filePath) {
        try {
            const uri = vscode.Uri.file(this.resolvePath(filePath));
            await vscode.workspace.fs.stat(uri);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Read a file's content
     */
    async readFile(filePath) {
        const uri = vscode.Uri.file(this.resolvePath(filePath));
        const content = await vscode.workspace.fs.readFile(uri);
        return new TextDecoder('utf-8').decode(content);
    }
    /**
     * Write content to a file (creates directories if needed)
     */
    async writeFile(filePath, content) {
        const fullPath = this.resolvePath(filePath);
        const uri = vscode.Uri.file(fullPath);
        // Ensure parent directory exists
        const parentDir = path.dirname(fullPath);
        await this.ensureDirectory(parentDir);
        const data = new TextEncoder().encode(content);
        await vscode.workspace.fs.writeFile(uri, data);
    }
    /**
     * Append content to an existing file or create if doesn't exist
     */
    async appendFile(filePath, content) {
        let existingContent = '';
        try {
            existingContent = await this.readFile(filePath);
        }
        catch {
            // File doesn't exist, will create new
        }
        const newContent = existingContent ? `${existingContent}\n${content}` : content;
        await this.writeFile(filePath, newContent);
    }
    /**
     * Ensure a directory exists (creates recursively if needed)
     */
    async ensureDirectory(dirPath) {
        // If it's a relative path, resolve it
        const fullPath = dirPath.startsWith(this.vaultPath) ? dirPath : this.resolvePath(dirPath);
        const uri = vscode.Uri.file(fullPath);
        try {
            await vscode.workspace.fs.createDirectory(uri);
        }
        catch {
            // Directory might already exist, ignore error
        }
    }
    /**
     * Delete a file or directory
     */
    async deleteFile(filePath) {
        const uri = vscode.Uri.file(this.resolvePath(filePath));
        await vscode.workspace.fs.delete(uri, { recursive: true });
    }
    /**
     * Move/rename a file or directory
     */
    async moveFile(sourcePath, destPath) {
        const sourceUri = vscode.Uri.file(this.resolvePath(sourcePath));
        const destUri = vscode.Uri.file(this.resolvePath(destPath));
        // Ensure destination directory exists
        const destDir = path.dirname(this.resolvePath(destPath));
        await this.ensureDirectory(destDir);
        await vscode.workspace.fs.rename(sourceUri, destUri, { overwrite: true });
    }
    /**
     * List contents of a directory
     */
    async listDirectory(dirPath = '') {
        const fullPath = this.resolvePath(dirPath);
        const uri = vscode.Uri.file(fullPath);
        const entries = await vscode.workspace.fs.readDirectory(uri);
        const result = [];
        for (const [name, type] of entries) {
            // Skip hidden files/directories
            if (name.startsWith('.')) {
                continue;
            }
            result.push({
                name,
                type: type === vscode.FileType.Directory ? 'directory' : 'file',
                path: dirPath ? `${dirPath}/${name}` : name
            });
        }
        return result.sort((a, b) => {
            // Directories first, then alphabetical
            if (a.type !== b.type) {
                return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
    }
    /**
     * Search for text in all markdown files
     */
    async search(query) {
        const results = [];
        const lowerQuery = query.toLowerCase();
        await this.searchRecursive('', lowerQuery, results);
        // Sort by number of matches (most relevant first)
        return results.sort((a, b) => b.matches.length - a.matches.length);
    }
    /**
     * Recursively search through directories
     */
    async searchRecursive(dirPath, query, results) {
        try {
            const entries = await this.listDirectory(dirPath);
            for (const entry of entries) {
                if (entry.type === 'directory') {
                    await this.searchRecursive(entry.path, query, results);
                }
                else if (entry.name.endsWith('.md')) {
                    try {
                        const content = await this.readFile(entry.path);
                        const matches = this.findMatches(content, query);
                        if (matches.length > 0) {
                            results.push({
                                filename: entry.name,
                                filepath: entry.path,
                                matches
                            });
                        }
                    }
                    catch {
                        // Skip files that can't be read
                    }
                }
            }
        }
        catch {
            // Skip directories that can't be accessed
        }
    }
    /**
     * Find all matches of query in content with context
     */
    findMatches(content, query) {
        const matches = [];
        const lowerContent = content.toLowerCase();
        let startIndex = 0;
        while (true) {
            const index = lowerContent.indexOf(query, startIndex);
            if (index === -1)
                break;
            // Get context around the match (150 chars)
            const contextStart = Math.max(0, index - 75);
            const contextEnd = Math.min(content.length, index + query.length + 75);
            let context = content.slice(contextStart, contextEnd);
            // Add ellipsis if truncated
            if (contextStart > 0)
                context = '...' + context;
            if (contextEnd < content.length)
                context = context + '...';
            matches.push({
                context: context.replace(/\n/g, ' ').trim(),
                position: index
            });
            startIndex = index + 1;
            // Limit matches per file
            if (matches.length >= 5)
                break;
        }
        return matches;
    }
}
exports.FilesystemBackend = FilesystemBackend;
//# sourceMappingURL=filesystemBackend.js.map