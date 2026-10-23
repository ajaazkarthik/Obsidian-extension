import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'node:fs/promises';

/** Resolve configuration on the extension host (including remote hosts). */
export function resolveVaultPath(configured: string | undefined, platform: NodeJS.Platform = process.platform, home: string = os.homedir()): string {
    const paths = platform === 'win32' ? path.win32 : path.posix;
    let value = configured?.trim() || (platform === 'win32' ? 'C:\\workspace\\obsidian-vault' : paths.join(home, 'workspace', 'obsidian-vault'));
    if (/^~(?:[\\/]|$)/.test(value)) value = paths.join(home, value.slice(2));
    const valid = platform === 'win32'
        ? /^(?:[a-zA-Z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/.test(value)
        : paths.isAbsolute(value) && !/^[a-zA-Z]:|^\\/.test(value);
    if (!valid) throw new Error(`Invalid Obsidian vault path "${value}" for ${platform}. Set obsidianBrain.vaultPath to an absolute path on this machine, or leave it blank for the automatic default.`);
    return paths.normalize(value);
}

export function configuredVaultPath(): string {
    return resolveVaultPath(vscode.workspace.getConfiguration('obsidianBrain').get<string>('vaultPath'));
}

export function normalizeNotePath(filepath: string): string {
    if (/^[a-zA-Z]:|^[\\/]{2}/.test(filepath)) throw new Error('Use a vault-relative note path, not an absolute filesystem path.');
    const normalized = path.posix.normalize(filepath.replace(/\\/g, '/').replace(/^\//, ''));
    if (normalized === '..' || normalized.startsWith('../')) throw new Error('Note path must stay inside the configured vault.');
    return normalized === '.' ? '' : normalized;
}

/** VS Code and Node-based harnesses use different missing-file error codes. */
export function isFileNotFound(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'code' in error
        && (error.code === 'FileNotFound' || error.code === 'ENOENT');
}

/** Create only the automatic default; explicit vaults must already be accessible. */
export async function prepareVault(vaultPath: string): Promise<void> {
    const configured = vscode.workspace.getConfiguration('obsidianBrain').get<string>('vaultPath')?.trim();
    try {
        if (!configured) {
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(vaultPath));
            for (const directory of ['Engineering', 'Playbooks', 'Decisions', 'Snippets', '_Inbox', '_Workspaces', '_Archive']) {
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(vaultPath, directory)));
            }
        }
        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(vaultPath));
        if ((stat.type & vscode.FileType.Directory) === 0) throw new Error('The path is not a directory');
        await vscode.workspace.fs.readDirectory(vscode.Uri.file(vaultPath));
    } catch (error) {
        throw new Error(`Cannot access Obsidian vault "${vaultPath}": ${error instanceof Error ? error.message : String(error)}. Configure obsidianBrain.vaultPath to a readable, writable folder on this machine.`);
    }
}

/** Native vault I/O shared by the tool and indexer on every supported platform. */
export class FilesystemBackend {
    private vaultPath = '';
    private savesLogCount: number | undefined;

    /**
     * Get the current vault path
     */
    getVaultPath(): string {
        return this.vaultPath;
    }

    /**
     * Refresh the vault path from settings
     */
    refreshVaultPath(vaultPath: string = configuredVaultPath()): void {
        if (this.vaultPath !== vaultPath) this.savesLogCount = undefined;
        this.vaultPath = vaultPath;
    }

    /**
     * Resolve a relative path within the vault to an absolute path
     */
    resolvePath(relativePath: string): string {
        // Remove leading slash if present
        if (!this.vaultPath) this.refreshVaultPath();
        return path.join(this.vaultPath, normalizeNotePath(relativePath));
    }

    /**
     * Check if a file or directory exists
     */
    async exists(filePath: string): Promise<boolean> {
        try {
            const uri = vscode.Uri.file(this.resolvePath(filePath));
            await vscode.workspace.fs.stat(uri);
            return true;
        } catch (error) {
            if (isFileNotFound(error)) return false;
            throw error;
        }
    }

    /**
     * Read a file's content
     */
    async readFile(filePath: string): Promise<string> {
        const uri = vscode.Uri.file(this.resolvePath(filePath));
        const content = await vscode.workspace.fs.readFile(uri);
        return new TextDecoder('utf-8').decode(content);
    }

    /**
     * Write content to a file (creates directories if needed)
     */
    async writeFile(filePath: string, content: string): Promise<void> {
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
    async appendFile(filePath: string, content: string): Promise<void> {
        let existingContent = '';
        try {
            existingContent = await this.readFile(filePath);
        } catch (error) {
            if (!isFileNotFound(error)) throw error;
            // Missing file: create it with the appended content.
        }

        const newContent = existingContent ? `${existingContent}\n${content}` : content;
        await this.writeFile(filePath, newContent);
    }

    /**
     * Append a one-line save marker outside the indexed vault. Native append
     * keeps a save O(1) instead of reading and re-indexing a growing Markdown log.
     * All callers serialize through BrainTool.runExclusive.
     *
     * Rotate AFTER crossing 2,000 lines, retaining the latest 1,000 events.
     * The hidden .obsidian-brain directory is skipped by the indexer and list.
     */
    async appendSaveMarker(line: string): Promise<void> {
        const filename = this.resolvePath('.obsidian-brain/saves.log');
        await fs.mkdir(path.dirname(filename), {recursive: true});
        if (this.savesLogCount === undefined) {
            try {
                const content = await fs.readFile(filename, 'utf8');
                this.savesLogCount = content.split('\n').filter(Boolean).length;
            } catch (error) {
                if (!isFileNotFound(error)) throw error;
                this.savesLogCount = 0;
            }
        }
        // Bound the line length to protect log parsing and memory usage.
        const safeLine = line.replace(/[\r\n]/g, ' ').slice(0, 1024);
        await fs.appendFile(filename, safeLine + '\n', {encoding: 'utf8'});
        this.savesLogCount++;
        if (this.savesLogCount > 2000) {
            try {
                const lines = (await fs.readFile(filename, 'utf8')).split('\n').filter(Boolean);
                const recent = lines.slice(-1000);
                const replacement = filename + '.' + process.pid + '.tmp';
                try {
                    await fs.writeFile(replacement, recent.join('\n') + '\n', 'utf8');
                    await fs.rename(replacement, filename);
                } finally {
                    await fs.rm(replacement, {force: true}).catch(() => {});
                }
                this.savesLogCount = recent.length;
            } catch (error) {
                // Leave the appended event intact, and recount on the next save.
                this.savesLogCount = undefined;
                throw error;
            }
        }
    }

    /** Append a readable Markdown checkpoint without re-reading the entire log. */
    async appendActivityCheckpoint(checkpoint: string): Promise<void> {
        const filename = this.resolvePath('_Inbox/session-activity-log.md');
        await fs.mkdir(path.dirname(filename), {recursive: true});
        await fs.appendFile(filename, '\n' + checkpoint, {encoding: 'utf8'});
    }

    /**
     * Ensure a directory exists (creates recursively if needed)
     */
    async ensureDirectory(dirPath: string): Promise<void> {
        // If it's a relative path, resolve it
        const fullPath = dirPath.startsWith(this.vaultPath) ? dirPath : this.resolvePath(dirPath);
        const uri = vscode.Uri.file(fullPath);
        await vscode.workspace.fs.createDirectory(uri);
    }

    /**
     * Delete a file or directory
     */
    async deleteFile(filePath: string): Promise<void> {
        const uri = vscode.Uri.file(this.resolvePath(filePath));
        await vscode.workspace.fs.delete(uri, { recursive: true });
    }

    /**
     * Move/rename a file or directory
     */
    async moveFile(sourcePath: string, destPath: string): Promise<void> {
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
    async listDirectory(dirPath: string = ''): Promise<DirectoryEntry[]> {
        dirPath = normalizeNotePath(dirPath);
        const fullPath = this.resolvePath(dirPath);
        const uri = vscode.Uri.file(fullPath);
        
        const entries = await vscode.workspace.fs.readDirectory(uri);
        const result: DirectoryEntry[] = [];
        
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
    async search(query: string): Promise<SearchResult[]> {
        const results: SearchResult[] = [];
        const lowerQuery = query.toLowerCase();
        
        await this.searchRecursive('', lowerQuery, results);
        
        // Sort by number of matches (most relevant first)
        return results.sort((a, b) => b.matches.length - a.matches.length);
    }

    /**
     * Recursively search through directories
     */
    private async searchRecursive(
        dirPath: string, 
        query: string, 
        results: SearchResult[]
    ): Promise<void> {
        try {
            const entries = await this.listDirectory(dirPath);
            
            for (const entry of entries) {
                if (entry.type === 'directory') {
                    await this.searchRecursive(entry.path, query, results);
                } else if (entry.name.endsWith('.md')) {
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
                    } catch {
                        // Skip files that can't be read
                    }
                }
            }
        } catch {
            // Skip directories that can't be accessed
        }
    }

    /**
     * Find all matches of query in content with context
     */
    private findMatches(content: string, query: string): MatchContext[] {
        const matches: MatchContext[] = [];
        const lowerContent = content.toLowerCase();
        let startIndex = 0;
        
        while (true) {
            const index = lowerContent.indexOf(query, startIndex);
            if (index === -1) break;
            
            // Get context around the match (150 chars)
            const contextStart = Math.max(0, index - 75);
            const contextEnd = Math.min(content.length, index + query.length + 75);
            let context = content.slice(contextStart, contextEnd);
            
            // Add ellipsis if truncated
            if (contextStart > 0) context = '...' + context;
            if (contextEnd < content.length) context = context + '...';
            
            matches.push({
                context: context.replace(/\n/g, ' ').trim(),
                position: index
            });
            
            startIndex = index + 1;
            
            // Limit matches per file
            if (matches.length >= 5) break;
        }
        
        return matches;
    }
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
