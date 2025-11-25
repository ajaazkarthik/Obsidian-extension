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
exports.MemoryTool = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const filesystemBackend_js_1 = require("./filesystemBackend.js");
/**
 * MemoryTool provides workspace-scoped memory storage within the Obsidian vault.
 * Works like Agent Memory but stores in vault's _Workspaces/[workspace-name]/ directory.
 * This gives workspace isolation while still being part of the global brain.
 */
class MemoryTool {
    context;
    filesystemBackend;
    workspaceMemoryPath = '';
    constructor(context) {
        this.context = context;
        this.filesystemBackend = new filesystemBackend_js_1.FilesystemBackend();
        this.initializeWorkspacePath();
    }
    initializeWorkspacePath() {
        // Get current workspace name
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let workspaceName = 'default';
        if (workspaceFolders && workspaceFolders.length > 0) {
            workspaceName = path.basename(workspaceFolders[0].uri.fsPath);
        }
        // Sanitize workspace name for filesystem
        workspaceName = workspaceName.replace(/[^a-zA-Z0-9-_]/g, '-');
        this.workspaceMemoryPath = `_Workspaces/${workspaceName}`;
    }
    getFullPath(relativePath) {
        // Convert /memories/xyz to _Workspaces/[workspace]/xyz
        let cleanPath = relativePath;
        // Remove /memories prefix if present (for compatibility with Agent Memory prompts)
        if (cleanPath.startsWith('/memories/')) {
            cleanPath = cleanPath.substring('/memories/'.length);
        }
        else if (cleanPath.startsWith('/memories')) {
            cleanPath = cleanPath.substring('/memories'.length);
        }
        else if (cleanPath.startsWith('memories/')) {
            cleanPath = cleanPath.substring('memories/'.length);
        }
        else if (cleanPath === '/memories' || cleanPath === 'memories') {
            cleanPath = '';
        }
        // Remove leading slash
        if (cleanPath.startsWith('/')) {
            cleanPath = cleanPath.substring(1);
        }
        // Return workspace memory path
        if (cleanPath === '' || cleanPath === '/') {
            return this.workspaceMemoryPath;
        }
        return `${this.workspaceMemoryPath}/${cleanPath}`;
    }
    async invoke(options, token) {
        const { command, path: inputPath, view_range, file_text, old_str, new_str, insert_line, insert_text, old_path, new_path } = options.input;
        try {
            // Refresh vault path in case settings changed
            this.filesystemBackend.refreshVaultPath();
            // Re-initialize workspace path
            this.initializeWorkspacePath();
            let result;
            switch (command) {
                case 'view':
                    if (!inputPath) {
                        return this.errorResult('View command requires a path parameter');
                    }
                    result = await this.handleView(inputPath, view_range);
                    break;
                case 'create':
                    if (!inputPath || file_text === undefined) {
                        return this.errorResult('Create command requires path and file_text parameters');
                    }
                    result = await this.handleCreate(inputPath, file_text);
                    break;
                case 'str_replace':
                    if (!inputPath || old_str === undefined || new_str === undefined) {
                        return this.errorResult('str_replace command requires path, old_str, and new_str parameters');
                    }
                    result = await this.handleStrReplace(inputPath, old_str, new_str);
                    break;
                case 'insert':
                    if (!inputPath || insert_line === undefined || insert_text === undefined) {
                        return this.errorResult('Insert command requires path, insert_line, and insert_text parameters');
                    }
                    result = await this.handleInsert(inputPath, insert_line, insert_text);
                    break;
                case 'delete':
                    if (!inputPath) {
                        return this.errorResult('Delete command requires a path parameter');
                    }
                    result = await this.handleDelete(inputPath);
                    break;
                case 'rename':
                    if (!old_path || !new_path) {
                        return this.errorResult('Rename command requires old_path and new_path parameters');
                    }
                    result = await this.handleRename(old_path, new_path);
                    break;
                default:
                    return this.errorResult(`Unknown command: ${command}`);
            }
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(result)
            ]);
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return this.errorResult(`Command '${command}' failed: ${errorMsg}`);
        }
    }
    async prepareInvocation(options, token) {
        const { command, path: inputPath, old_path, new_path } = options.input;
        let message;
        switch (command) {
            case 'view':
                message = inputPath === '/memories' || inputPath === '/memories/'
                    ? 'Viewing workspace memory directory'
                    : `Viewing memory: ${inputPath}`;
                break;
            case 'create':
                message = `Creating memory file: ${inputPath}`;
                break;
            case 'str_replace':
                message = `Updating memory file: ${inputPath}`;
                break;
            case 'insert':
                message = `Inserting into memory: ${inputPath}`;
                break;
            case 'delete':
                message = `Deleting memory: ${inputPath}`;
                break;
            case 'rename':
                message = `Renaming memory: ${old_path} → ${new_path}`;
                break;
            default:
                message = `Memory operation: ${command}`;
        }
        return {
            invocationMessage: message
        };
    }
    async handleView(inputPath, viewRange) {
        const fullPath = this.getFullPath(inputPath);
        try {
            // First try to read as file
            const content = await this.filesystemBackend.readFile(fullPath);
            if (viewRange) {
                const lines = content.split('\n');
                const [start, end] = viewRange;
                const selectedLines = lines.slice(start - 1, end);
                return selectedLines.join('\n');
            }
            return content;
        }
        catch {
            // If file read fails, try as directory
            try {
                const entries = await this.filesystemBackend.listDirectory(fullPath);
                if (entries.length === 0) {
                    return `Directory: ${this.workspaceMemoryPath}\n(empty - no memory files yet)`;
                }
                let output = `Directory: ${this.workspaceMemoryPath}\n`;
                for (const entry of entries) {
                    if (entry.type === 'directory') {
                        output += `- ${entry.name}/\n`;
                    }
                    else {
                        output += `- ${entry.name}\n`;
                    }
                }
                return output;
            }
            catch {
                // Directory doesn't exist yet, create it
                await this.filesystemBackend.ensureDirectory(fullPath);
                return `Directory: ${this.workspaceMemoryPath}\n(empty - no memory files yet)`;
            }
        }
    }
    async handleCreate(inputPath, content) {
        const fullPath = this.getFullPath(inputPath);
        // Ensure the file has .md extension
        let finalPath = fullPath;
        if (!finalPath.endsWith('.md')) {
            finalPath = `${finalPath}.md`;
        }
        await this.filesystemBackend.writeFile(finalPath, content);
        return `✅ Created memory file: ${inputPath}`;
    }
    async handleStrReplace(inputPath, oldStr, newStr) {
        const fullPath = this.getFullPath(inputPath);
        // Read current content
        const content = await this.filesystemBackend.readFile(fullPath);
        // Check if old string exists
        if (!content.includes(oldStr)) {
            return `❌ Could not find the specified text to replace in ${inputPath}`;
        }
        // Replace first occurrence
        const newContent = content.replace(oldStr, newStr);
        await this.filesystemBackend.writeFile(fullPath, newContent);
        return `✅ Replaced text in: ${inputPath}`;
    }
    async handleInsert(inputPath, lineNumber, text) {
        const fullPath = this.getFullPath(inputPath);
        let content;
        try {
            content = await this.filesystemBackend.readFile(fullPath);
        }
        catch {
            // File doesn't exist, create with just the insert text
            await this.filesystemBackend.writeFile(fullPath, text);
            return `✅ Created memory file with content: ${inputPath}`;
        }
        const lines = content.split('\n');
        // Insert at specified line (1-indexed)
        const insertIndex = Math.min(Math.max(0, lineNumber - 1), lines.length);
        lines.splice(insertIndex, 0, text);
        const newContent = lines.join('\n');
        await this.filesystemBackend.writeFile(fullPath, newContent);
        return `✅ Inserted text at line ${lineNumber} in: ${inputPath}`;
    }
    async handleDelete(inputPath) {
        const fullPath = this.getFullPath(inputPath);
        await this.filesystemBackend.deleteFile(fullPath);
        return `✅ Deleted: ${inputPath}`;
    }
    async handleRename(oldPath, newPath) {
        const fullOldPath = this.getFullPath(oldPath);
        const fullNewPath = this.getFullPath(newPath);
        await this.filesystemBackend.moveFile(fullOldPath, fullNewPath);
        return `✅ Renamed: ${oldPath} → ${newPath}`;
    }
    errorResult(message) {
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`❌ Error: ${message}`)
        ]);
    }
    /**
     * Get the current workspace memory path for display
     */
    getWorkspaceMemoryPath() {
        return this.workspaceMemoryPath;
    }
}
exports.MemoryTool = MemoryTool;
//# sourceMappingURL=memoryTool.js.map