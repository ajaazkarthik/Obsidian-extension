import * as vscode from 'vscode';
import * as path from 'path';

/**
 * VaultIndexer provides fast search capabilities by maintaining an in-memory index
 * of the Obsidian vault. It watches for file changes and updates incrementally.
 */

export interface IndexedFile {
    path: string;
    filename: string;
    title: string;           // First H1 or filename
    modified: number;        // mtime for cache invalidation
    contentHash: number;     // Simple hash for change detection
    tags: string[];          // #tags from content
    headings: HeadingInfo[]; // All headings with levels
    links: string[];         // [[wikilinks]]
    firstLine: string;       // Preview text
    wordCount: number;       // Approximate size
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
    tagIndex: Map<string, Set<string>>;      // tag -> filepaths
    wordIndex: Map<string, Set<string>>;     // word -> filepaths (for fast search)
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

export class VaultIndexer {
    private index: VaultIndex | null = null;
    private vaultPath: string = '';
    private watcher: vscode.FileSystemWatcher | undefined;
    private indexing: boolean = false;
    private initialized: boolean = false;
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

    constructor() {
        this.refreshVaultPath();
    }

    refreshVaultPath(): void {
        const config = vscode.workspace.getConfiguration('obsidianBrain');
        this.vaultPath = config.get<string>('vaultPath') || 'C:\\workspace\\obsidian-vault';
    }

    /**
     * Initialize the index - call this on extension activation
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        
        this.refreshVaultPath();
        
        // Try to load from cache
        const cached = await this.loadFromCache();
        
        if (cached && cached.vaultPath === this.vaultPath) {
            this.index = cached;
            // Do a quick delta update for any changed files
            await this.deltaUpdate();
        } else {
            // Full rebuild
            await this.rebuildIndex();
        }
        
        // Start file watcher
        this.startWatcher();
        this.initialized = true;
    }

    /**
     * Check if index is ready
     */
    isReady(): boolean {
        return this.index !== null && !this.indexing;
    }

    /**
     * Get index statistics
     */
    getStats(): { fileCount: number; tagCount: number; wordCount: number; lastUpdated: Date } | null {
        if (!this.index) return null;
        return {
            fileCount: this.index.files.size,
            tagCount: this.index.tagIndex.size,
            wordCount: this.index.wordIndex.size,
            lastUpdated: new Date(this.index.lastUpdated)
        };
    }

    /**
     * Immediately index a specific file (call after writes for instant searchability)
     */
    async indexFileImmediately(filepath: string): Promise<void> {
        if (!this.index) {
            await this.initialize();
        }
        await this.indexFile(filepath);
        // Update stats
        if (this.index) {
            this.index.lastUpdated = Date.now();
        }
    }

    /**
     * Remove a file from index immediately (call after deletes)
     */
    removeFileImmediately(filepath: string): void {
        this.removeFromIndex(filepath);
        if (this.index) {
            this.index.lastUpdated = Date.now();
        }
    }

    /**
     * Smart search with OR logic for multiple words, tag support, and scoring
     */
    async search(query: string, limit: number = 20): Promise<IndexSearchResult[]> {
        if (!this.index) {
            await this.initialize();
        }
        if (!this.index) return [];

        const results: IndexSearchResult[] = [];
        const seenPaths = new Set<string>();
        
        // Handle tag search: #tagname
        if (query.startsWith('#')) {
            const tag = query.slice(1).toLowerCase();
            const paths = this.index.tagIndex.get(tag);
            if (paths) {
                for (const filepath of paths) {
                    const file = this.index.files.get(filepath);
                    if (file && !seenPaths.has(filepath)) {
                        seenPaths.add(filepath);
                        results.push({
                            filepath,
                            filename: file.filename,
                            title: file.title,
                            score: 8.0,  // High score for explicit tag search
                            matchType: 'tag',
                            tags: file.tags,
                            firstLine: file.firstLine
                        });
                    }
                }
            }
            // Sort tag results by number of tags (more specific tags rank higher)
            results.sort((a, b) => (a.tags?.length || 0) - (b.tags?.length || 0));
            return results.slice(0, limit);
        }

        // Tokenize query for OR search
        const queryTokens = this.tokenize(query.toLowerCase());
        
        // Score each file
        for (const [filepath, file] of this.index.files) {
            let score = 0;
            let matchType: IndexSearchResult['matchType'] = 'content';
            let context: string | undefined;
            
            const lowerTitle = file.title.toLowerCase();
            const lowerFilename = file.filename.toLowerCase();
            
            // Check each query token
            for (const token of queryTokens) {
                // Exact title match (highest)
                if (lowerTitle === token) {
                    score += 10;
                    matchType = 'title';
                }
                // Title contains token
                else if (lowerTitle.includes(token)) {
                    score += 5;
                    matchType = 'title';
                }
                // Filename match
                else if (lowerFilename.includes(token)) {
                    score += 4;
                    matchType = 'filename';
                }
                // Tag match
                else if (file.tags.some(t => t.toLowerCase().includes(token))) {
                    score += 3;
                    matchType = 'tag';
                }
                // Heading match
                else if (file.headings.some(h => h.text.toLowerCase().includes(token))) {
                    score += 2;
                    matchType = 'heading';
                    const heading = file.headings.find(h => h.text.toLowerCase().includes(token));
                    if (heading) context = heading.text;
                }
                // Word index match (content contains word)
                else if (this.index.wordIndex.get(token)?.has(filepath)) {
                    score += 1;
                    matchType = 'content';
                }
            }
            
            if (score > 0 && !seenPaths.has(filepath)) {
                seenPaths.add(filepath);
                results.push({
                    filepath,
                    filename: file.filename,
                    title: file.title,
                    score,
                    matchType,
                    context,
                    tags: file.tags,
                    firstLine: file.firstLine
                });
            }
        }
        
        // Sort by score descending
        results.sort((a, b) => b.score - a.score);
        
        return results.slice(0, limit);
    }

    /**
     * Get all tags in the vault
     */
    getAllTags(): string[] {
        if (!this.index) return [];
        return Array.from(this.index.tagIndex.keys()).sort();
    }

    /**
     * Full index rebuild
     */
    async rebuildIndex(): Promise<void> {
        this.indexing = true;
        this.refreshVaultPath();
        
        this.index = {
            version: 1,
            vaultPath: this.vaultPath,
            lastUpdated: Date.now(),
            files: new Map(),
            tagIndex: new Map(),
            wordIndex: new Map()
        };
        
        try {
            await this.indexDirectory('');
            await this.saveToCache();
        } finally {
            this.indexing = false;
        }
    }

    /**
     * Incremental update - only reindex changed files
     */
    private async deltaUpdate(): Promise<void> {
        if (!this.index) return;
        
        this.indexing = true;
        
        try {
            const currentFiles = new Set<string>();
            await this.collectFiles('', currentFiles);
            
            // Find deleted files
            for (const filepath of this.index.files.keys()) {
                if (!currentFiles.has(filepath)) {
                    this.removeFromIndex(filepath);
                }
            }
            
            // Check for new/modified files
            for (const filepath of currentFiles) {
                const existing = this.index.files.get(filepath);
                if (!existing) {
                    await this.indexFile(filepath);
                } else {
                    // Check if modified (simple mtime check)
                    try {
                        const uri = vscode.Uri.file(path.join(this.vaultPath, filepath));
                        const stat = await vscode.workspace.fs.stat(uri);
                        if (stat.mtime > existing.modified) {
                            await this.indexFile(filepath);
                        }
                    } catch {
                        // File might have been deleted
                    }
                }
            }
            
            this.index.lastUpdated = Date.now();
            await this.saveToCache();
        } finally {
            this.indexing = false;
        }
    }

    /**
     * Collect all markdown file paths
     */
    private async collectFiles(dirPath: string, files: Set<string>): Promise<void> {
        const fullPath = dirPath ? path.join(this.vaultPath, dirPath) : this.vaultPath;
        const uri = vscode.Uri.file(fullPath);
        
        try {
            const entries = await vscode.workspace.fs.readDirectory(uri);
            
            for (const [name, type] of entries) {
                if (name.startsWith('.')) continue;
                
                const relativePath = dirPath ? `${dirPath}/${name}` : name;
                
                if (type === vscode.FileType.Directory) {
                    await this.collectFiles(relativePath, files);
                } else if (name.endsWith('.md')) {
                    files.add(relativePath);
                }
            }
        } catch {
            // Directory doesn't exist or not accessible
        }
    }

    /**
     * Recursively index a directory
     */
    private async indexDirectory(dirPath: string): Promise<void> {
        const fullPath = dirPath ? path.join(this.vaultPath, dirPath) : this.vaultPath;
        const uri = vscode.Uri.file(fullPath);
        
        try {
            const entries = await vscode.workspace.fs.readDirectory(uri);
            
            for (const [name, type] of entries) {
                // Skip hidden files/directories
                if (name.startsWith('.')) continue;
                
                const relativePath = dirPath ? `${dirPath}/${name}` : name;
                
                if (type === vscode.FileType.Directory) {
                    await this.indexDirectory(relativePath);
                } else if (name.endsWith('.md')) {
                    await this.indexFile(relativePath);
                }
            }
        } catch {
            // Directory doesn't exist or not accessible
        }
    }

    /**
     * Index a single file
     */
    private async indexFile(filepath: string): Promise<void> {
        if (!this.index) return;
        
        try {
            const fullPath = path.join(this.vaultPath, filepath);
            const uri = vscode.Uri.file(fullPath);
            
            const [contentBytes, stat] = await Promise.all([
                vscode.workspace.fs.readFile(uri),
                vscode.workspace.fs.stat(uri)
            ]);
            
            const content = new TextDecoder('utf-8').decode(contentBytes);
            const filename = path.basename(filepath);
            
            // Extract metadata
            const title = this.extractTitle(content, filename);
            const tags = this.extractTags(content);
            const headings = this.extractHeadings(content);
            const links = this.extractLinks(content);
            const firstLine = this.extractFirstLine(content);
            const words = this.tokenize(content.toLowerCase());
            
            const entry: IndexedFile = {
                path: filepath,
                filename,
                title,
                modified: stat.mtime,
                contentHash: this.hashContent(content),
                tags,
                headings,
                links,
                firstLine,
                wordCount: words.length
            };
            
            // Remove old entry from indexes if exists
            this.removeFromIndex(filepath);
            
            // Add to file index
            this.index.files.set(filepath, entry);
            
            // Add to tag index
            for (const tag of tags) {
                const tagLower = tag.toLowerCase();
                if (!this.index.tagIndex.has(tagLower)) {
                    this.index.tagIndex.set(tagLower, new Set());
                }
                this.index.tagIndex.get(tagLower)!.add(filepath);
            }
            
            // Add to word index (for fast content search)
            // Only index unique significant words to save memory
            const uniqueWords = new Set(words.filter(w => w.length >= 3));
            for (const word of uniqueWords) {
                if (!this.index.wordIndex.has(word)) {
                    this.index.wordIndex.set(word, new Set());
                }
                this.index.wordIndex.get(word)!.add(filepath);
            }
            
        } catch (error) {
            // File might not exist or be readable
            console.log(`[VaultIndexer] Failed to index ${filepath}:`, error);
        }
    }

    /**
     * Remove a file from all indexes
     */
    private removeFromIndex(filepath: string): void {
        if (!this.index) return;
        
        const existing = this.index.files.get(filepath);
        if (existing) {
            // Remove from tag index
            for (const tag of existing.tags) {
                const tagLower = tag.toLowerCase();
                this.index.tagIndex.get(tagLower)?.delete(filepath);
                if (this.index.tagIndex.get(tagLower)?.size === 0) {
                    this.index.tagIndex.delete(tagLower);
                }
            }
            
            // Remove from word index would be expensive, skip for now
            // Words will be cleaned up on full rebuild
            
            this.index.files.delete(filepath);
        }
    }

    /**
     * Start file watcher for live updates
     */
    private startWatcher(): void {
        if (this.watcher) {
            this.watcher.dispose();
        }
        
        const vaultUri = vscode.Uri.file(this.vaultPath);
        const pattern = new vscode.RelativePattern(vaultUri, '**/*.md');
        
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
        
        this.watcher.onDidCreate(uri => this.onFileCreated(uri));
        this.watcher.onDidChange(uri => this.onFileChanged(uri));
        this.watcher.onDidDelete(uri => this.onFileDeleted(uri));
    }

    private onFileCreated(uri: vscode.Uri): void {
        const filepath = this.getRelativePath(uri);
        if (filepath && !filepath.startsWith('.')) {
            this.indexFile(filepath).then(() => this.saveToCache());
        }
    }

    private onFileChanged(uri: vscode.Uri): void {
        const filepath = this.getRelativePath(uri);
        if (!filepath || filepath.startsWith('.')) return;
        
        // Debounce: wait 500ms after last change
        if (this.debounceTimers.has(filepath)) {
            clearTimeout(this.debounceTimers.get(filepath)!);
        }
        
        this.debounceTimers.set(filepath, setTimeout(async () => {
            await this.indexFile(filepath);
            await this.saveToCache();
            this.debounceTimers.delete(filepath);
        }, 500));
    }

    private onFileDeleted(uri: vscode.Uri): void {
        const filepath = this.getRelativePath(uri);
        if (filepath) {
            this.removeFromIndex(filepath);
            this.saveToCache();
        }
    }

    private getRelativePath(uri: vscode.Uri): string | null {
        const fullPath = uri.fsPath;
        if (fullPath.startsWith(this.vaultPath)) {
            return fullPath.slice(this.vaultPath.length + 1).replace(/\\/g, '/');
        }
        return null;
    }

    // ========== Extraction helpers ==========
    
    private extractTitle(content: string, filename: string): string {
        // Try to find first H1
        const h1Match = content.match(/^#\s+(.+)$/m);
        if (h1Match) return h1Match[1].trim();
        
        // Fall back to filename without extension
        return filename.replace(/\.md$/, '');
    }

    private extractTags(content: string): string[] {
        const tags = new Set<string>();
        
        // Extract #tags from content
        const tagRegex = /#([a-zA-Z][a-zA-Z0-9_-]*)/g;
        let match;
        while ((match = tagRegex.exec(content))) {
            tags.add(match[1]);
        }
        
        // Also check YAML frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
            const yamlContent = frontmatterMatch[1];
            const tagsMatch = yamlContent.match(/tags:\s*\[([^\]]+)\]/);
            if (tagsMatch) {
                tagsMatch[1].split(',').forEach(t => tags.add(t.trim().replace(/['"]/g, '')));
            }
            // Also handle tags as list
            const tagsListMatch = yamlContent.match(/tags:\s*\n((?:\s*-\s*.+\n?)+)/);
            if (tagsListMatch) {
                tagsListMatch[1].match(/-\s*(.+)/g)?.forEach(t => {
                    tags.add(t.replace(/^-\s*/, '').trim().replace(/['"]/g, ''));
                });
            }
        }
        
        return Array.from(tags);
    }

    private extractHeadings(content: string): HeadingInfo[] {
        const headings: HeadingInfo[] = [];
        const lines = content.split('\n');
        
        lines.forEach((line, i) => {
            const match = line.match(/^(#{1,6})\s+(.+)$/);
            if (match) {
                headings.push({
                    level: match[1].length,
                    text: match[2].trim(),
                    line: i + 1
                });
            }
        });
        
        return headings;
    }

    private extractLinks(content: string): string[] {
        const links: string[] = [];
        const wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        let match;
        while ((match = wikiLinkRegex.exec(content))) {
            links.push(match[1]);
        }
        return links;
    }

    private extractFirstLine(content: string): string {
        // Skip frontmatter
        let text = content;
        if (text.startsWith('---')) {
            const endIndex = text.indexOf('---', 3);
            if (endIndex !== -1) {
                text = text.slice(endIndex + 3);
            }
        }
        
        // Get first non-empty, non-heading line
        const lines = text.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                return trimmed.slice(0, 100) + (trimmed.length > 100 ? '...' : '');
            }
        }
        
        return '';
    }

    private tokenize(text: string): string[] {
        // Simple tokenization: split on non-alphanumeric, filter short words
        return text
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(word => word.length >= 2);
    }

    private hashContent(content: string): number {
        let hash = 0;
        for (let i = 0; i < Math.min(content.length, 10000); i++) {
            hash = ((hash << 5) - hash) + content.charCodeAt(i);
            hash |= 0;
        }
        return hash;
    }

    // ========== Cache persistence ==========
    
    private getCachePath(): string {
        return path.join(this.vaultPath, '.obsidian-brain', 'index.json');
    }

    private async saveToCache(): Promise<void> {
        if (!this.index) return;
        
        try {
            const cacheDir = path.join(this.vaultPath, '.obsidian-brain');
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(cacheDir));
            
            // Serialize index (Maps to objects)
            const serialized = {
                version: this.index.version,
                vaultPath: this.index.vaultPath,
                lastUpdated: this.index.lastUpdated,
                files: Object.fromEntries(this.index.files),
                tagIndex: Object.fromEntries(
                    Array.from(this.index.tagIndex.entries()).map(([k, v]) => [k, Array.from(v)])
                ),
                // Skip wordIndex for cache - too large, rebuild on load
            };
            
            const content = JSON.stringify(serialized);
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(this.getCachePath()),
                new TextEncoder().encode(content)
            );
        } catch (error) {
            console.log('[VaultIndexer] Failed to save cache:', error);
        }
    }

    private async loadFromCache(): Promise<VaultIndex | null> {
        try {
            const uri = vscode.Uri.file(this.getCachePath());
            const content = await vscode.workspace.fs.readFile(uri);
            const parsed = JSON.parse(new TextDecoder('utf-8').decode(content));
            
            // Deserialize to Maps
            const index: VaultIndex = {
                version: parsed.version,
                vaultPath: parsed.vaultPath,
                lastUpdated: parsed.lastUpdated,
                files: new Map(Object.entries(parsed.files)),
                tagIndex: new Map(
                    Object.entries(parsed.tagIndex).map(([k, v]) => [k, new Set(v as string[])])
                ),
                wordIndex: new Map() // Rebuild word index
            };
            
            // Rebuild word index from files
            for (const [filepath, file] of index.files) {
                // Quick rebuild from stored content would need content, skip for now
                // Will be populated on first search or delta update
            }
            
            return index;
        } catch {
            return null;
        }
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this.watcher?.dispose();
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
    }
}
