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
exports.resolveVaultPath = resolveVaultPath;
exports.configuredVaultPath = configuredVaultPath;
exports.normalizeNotePath = normalizeNotePath;
exports.isFileNotFound = isFileNotFound;
exports.prepareVault = prepareVault;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
/** Resolve configuration on the extension host (including remote hosts). */
function resolveVaultPath(configured, platform = process.platform, home = os.homedir()) {
    const paths = platform === 'win32' ? path.win32 : path.posix;
    let value = configured?.trim() || (platform === 'win32' ? 'C:\\workspace\\obsidian-vault' : paths.join(home, 'workspace', 'obsidian-vault'));
    if (/^~(?:[\\/]|$)/.test(value))
        value = paths.join(home, value.slice(2));
    const valid = platform === 'win32'
        ? /^(?:[a-zA-Z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/.test(value)
        : paths.isAbsolute(value) && !/^[a-zA-Z]:|^\\/.test(value);
    if (!valid)
        throw new Error(`Invalid Obsidian vault path "${value}" for ${platform}. Set obsidianBrain.vaultPath to an absolute path on this machine, or leave it blank for the automatic default.`);
    return paths.normalize(value);
}
function configuredVaultPath() {
    return resolveVaultPath(vscode.workspace.getConfiguration('obsidianBrain').get('vaultPath'));
}
function normalizeNotePath(filepath) {
    if (/^[a-zA-Z]:|^[\\/]{2}/.test(filepath))
        throw new Error('Use a vault-relative note path, not an absolute filesystem path.');
    const normalized = path.posix.normalize(filepath.replace(/\\/g, '/').replace(/^\//, ''));
    if (normalized === '..' || normalized.startsWith('../'))
        throw new Error('Note path must stay inside the configured vault.');
    return normalized === '.' ? '' : normalized;
}
/** VS Code and Node-based harnesses use different missing-file error codes. */
function isFileNotFound(error) {
    return !!error && typeof error === 'object' && 'code' in error
        && (error.code === 'FileNotFound' || error.code === 'ENOENT');
}
/** Create only the automatic default; explicit vaults must already be accessible. */
async function prepareVault(vaultPath) {
    const configured = vscode.workspace.getConfiguration('obsidianBrain').get('vaultPath')?.trim();
    try {
        if (!configured) {
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(vaultPath));
            for (const directory of ['Engineering', 'Playbooks', 'Decisions', 'Snippets', '_Inbox', '_Workspaces', '_Archive']) {
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(vaultPath, directory)));
            }
        }
        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(vaultPath));
        if ((stat.type & vscode.FileType.Directory) === 0)
            throw new Error('The path is not a directory');
        await vscode.workspace.fs.readDirectory(vscode.Uri.file(vaultPath));
    }
    catch (error) {
        throw new Error(`Cannot access Obsidian vault "${vaultPath}": ${error instanceof Error ? error.message : String(error)}. Configure obsidianBrain.vaultPath to a readable, writable folder on this machine.`);
    }
}
/** Native vault I/O shared by the tool and indexer on every supported platform. */
class FilesystemBackend {
    vaultPath = '';
    /**
     * Get the current vault path
     */
    getVaultPath() {
        return this.vaultPath;
    }
    /**
     * Refresh the vault path from settings
     */
    refreshVaultPath(vaultPath = configuredVaultPath()) {
        this.vaultPath = vaultPath;
    }
    /**
     * Resolve a relative path within the vault to an absolute path
     */
    resolvePath(relativePath) {
        // Remove leading slash if present
        if (!this.vaultPath)
            this.refreshVaultPath();
        return path.join(this.vaultPath, normalizeNotePath(relativePath));
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
        catch (error) {
            if (isFileNotFound(error))
                return false;
            throw error;
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
        catch (error) {
            if (!isFileNotFound(error))
                throw error;
            // Missing file: create it with the appended content.
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
        await vscode.workspace.fs.createDirectory(uri);
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
        dirPath = normalizeNotePath(dirPath);
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