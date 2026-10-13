import * as vscode from 'vscode';
import * as path from 'path';
import { configuredVaultPath, normalizeNotePath, prepareVault } from './filesystemBackend.js';

export const CACHE_VERSION = 3;

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
    bodyWordCount: number; // Number of tokens stored in body postings
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
    wordIndex: Map<string, Map<string, number>>; // term -> filepath -> occurrence count
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

export class VaultIndexer {
    private index: VaultIndex | null = null;
    private vaultPath: string = '';
    private watcher: vscode.FileSystemWatcher | undefined;
    private indexing: boolean = false;
    private initialized: boolean = false;
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

    private initialization: Promise<void> | undefined;
    private cacheSaveTimer: NodeJS.Timeout | undefined;
    private cacheDirty = false;
    private cacheWrite: Promise<void> = Promise.resolve();
    private pendingUpdates = new Set<Promise<void>>();
    private disposed = false;

    constructor(private readonly configuredPath?: string) {}

    refreshVaultPath(): void {
        this.vaultPath = this.configuredPath ?? configuredVaultPath();
    }

    /**
     * Initialize the index - call this on extension activation
     */
    async initialize(): Promise<void> {
        if (this.disposed || this.initialized) return;
        if (!this.initialization) this.initialization = this.initializeIndex();
        try {
            await this.initialization;
        } catch (error) {
            this.initialization = undefined;
            throw error;
        }
    }

    private async initializeIndex(): Promise<void> {
        this.refreshVaultPath();
        await prepareVault(this.vaultPath);

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
        if (!this.disposed) this.startWatcher();
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
     * Get information about a specific indexed file
     */
    getFileInfo(filepath: string): IndexedFile | null {
        if (!this.index) return null;
        // Normalize filepath (remove leading slash if present)
        const normalizedPath = normalizeNotePath(filepath);
        return this.index.files.get(normalizedPath) || null;
    }

    /**
     * Get recently modified files sorted by modification time (most recent first)
     */
    getRecentFiles(limit: number = 10): IndexedFile[] {
        if (!this.index) return [];
        
        const files = Array.from(this.index.files.values());
        
        // Sort by modification time descending
        files.sort((a, b) => b.modified - a.modified);
        
        return files.slice(0, limit);
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
            this.scheduleCacheSave();
        }
    }

    /**
     * Remove a file from index immediately (call after deletes)
     */
    removeFileImmediately(filepath: string): void {
        this.removeFromIndex(filepath);
        if (this.index) {
            this.index.lastUpdated = Date.now();
            this.scheduleCacheSave();
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
        
        // FIX 1: total files needed for IDF weighting
        const totalFiles = this.index.files.size;
        
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
                    const wordFiles = this.index.wordIndex.get(token)!;
                    const idf = Math.log((totalFiles + 1) / (wordFiles.size + 1)) / Math.log(totalFiles + 2);
                    score += Math.max(0.5, idf * Math.log(1 + wordFiles.get(filepath)!));
                    matchType = 'content';
                }
            }
            
            // Recency orders matching notes; it must not create unrelated hits.
            if (score === 0) continue;
            const ageDays = Math.max(0, (Date.now() - file.modified) / 86400000);
            score += ageDays < 1 / 24 ? 3 : ageDays < 1 ? 2 : Math.max(0, 1.5 * Math.exp(-ageDays / 7));
            
            // FIX 14: _Archive/ penalty — superseded content buried 95% below live notes
            if (filepath.startsWith('_Archive/') || filepath.startsWith('_Archive\\')) {
                score *= 0.05;
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
        this.refreshVaultPath();
        await prepareVault(this.vaultPath);
        this.indexing = true;
        
        this.index = {
            version: CACHE_VERSION,
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
                        if (stat.mtime !== existing.modified) {
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
        filepath = normalizeNotePath(filepath);
        
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
                bodyWordCount: words.filter(w => w.length >= 3).length,
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
            
            // Keep term frequency for body relevance and lossless persistence.
            for (const word of words.filter(w => w.length >= 3)) {
                if (!this.index.wordIndex.has(word)) this.index.wordIndex.set(word, new Map());
                const postings = this.index.wordIndex.get(word)!;
                postings.set(filepath, (postings.get(filepath) || 0) + 1);
            }
            this.index.lastUpdated = Date.now();

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
        filepath = normalizeNotePath(filepath);
        
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
            
            for (const [word, postings] of this.index.wordIndex) {
                postings.delete(filepath);
                if (postings.size === 0) this.index.wordIndex.delete(word);
            }
            
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
            this.trackUpdate(this.indexFile(filepath).then(() => this.scheduleCacheSave()));
        }
    }

    private onFileChanged(uri: vscode.Uri): void {
        const filepath = this.getRelativePath(uri);
        if (!filepath || filepath.startsWith('.')) return;
        
        // Debounce: wait 500ms after last change
        if (this.debounceTimers.has(filepath)) {
            clearTimeout(this.debounceTimers.get(filepath)!);
        }
        
        this.debounceTimers.set(filepath, setTimeout(() => {
            this.debounceTimers.delete(filepath);
            this.trackUpdate(this.indexFile(filepath).then(() => this.scheduleCacheSave()));
        }, 500));
    }

    private onFileDeleted(uri: vscode.Uri): void {
        const filepath = this.getRelativePath(uri);
        if (filepath) {
            this.removeFileImmediately(filepath);
        }
    }

    private getRelativePath(uri: vscode.Uri): string | null {
        const relative = path.relative(this.vaultPath, uri.fsPath);
        if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
            return relative.replace(/\\/g, '/');
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

    /** Canonical tags shared by indexing, summaries and auto-tag analysis. */
    public extractTags(content: string): string[] {
        const tags = new Map<string, string>();
        const add = (raw: string) => {
            const tag = raw.trim().replace(/^(['"])(.*)\1$/, '$2').trim().replace(/^#/, '').trim();
            if (tag && !tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
        };
        const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
        if (frontmatter) {
            const yaml = frontmatter[1];
            const array = yaml.match(/^tags:[ \t]*\[([^\]]*)\][ \t]*\r?$/m);
            if (array) array[1].split(',').forEach(add);
            const list = yaml.match(/^tags:[ \t]*\r?\n((?:[ \t]*-[ \t]*[^\r\n]*(?:\r?\n|$))+)/m);
            if (list) for (const line of list[1].split(/\r?\n/)) {
                const item = line.match(/^[ \t]*-[ \t]*(.*)$/);
                if (item) add(item[1]);
            }
        }
        // Strip fenced blocks (including unclosed fences), then inline code spans.
        let fence: { char: string; length: number } | undefined;
        const body = content.slice(frontmatter?.[0].length || 0).split(/\r?\n/).map(line => {
            const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
            if (fence) {
                if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
                return '';
            }
            if (marker) { fence = {char: marker[1][0], length: marker[1].length}; return ''; }
            return line;
        }).join('\n').replace(/(`+)[\s\S]*?\1(?!`)/g, '');
        const inline = /(?:^|[\s(\[])#([a-zA-Z][a-zA-Z0-9_-]*)/gm;
        for (const match of body.matchAll(inline)) {
            const tag = match[1];
            if (tag.length < 2 || /^L\d+(?:-L?\d+)?$/i.test(tag)) continue;
            if (/^(?:[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$/.test(tag) && /\d/.test(tag)) continue;
            add(tag);
        }
        return [...tags.values()];
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
            .filter(word => word.length >= 2)
            .map(word => this.stem(word));
    }

    private stem(word: string): string {
        if (word.length <= 4) return word;
        const suffixes = ['ations', 'nesses', 'ments', 'ings', 'ions', 'ities', 'ives', 'izers',
            'ated', 'ates', 'ized', 'izes', 'ers', 'ied', 'ies', 'ing', 'ion', 'ity', 'ive',
            'ize', 'ment', 'ness', 'ator', 'ate', 'er', 'ed', 'es', 's'];
        for (const suffix of suffixes) {
            if (word.endsWith(suffix) && word.length - suffix.length >= 4) {
                return word.slice(0, -suffix.length) + (suffix === 'ies' ? 'y' : '');
            }
        }
        return word;
    }

    getRelatedNotes(filepath: string, limit: number = 10): RelatedNote[] {
        if (!this.index) return [];
        const source = this.getFileInfo(filepath);
        if (!source) return [];
        const results = new Map<string, RelatedNote>();
        const totalFiles = this.index.files.size;
        for (const tag of source.tags) {
            const canonical = tag.toLowerCase();
            const paths = this.index.tagIndex.get(canonical);
            if (!paths || paths.size < 2) continue;
            const weight = Math.max(0.1, Math.log((totalFiles + 1) / (paths.size + 1)) / Math.log(totalFiles + 2));
            for (const target of paths) {
                if (target === source.path) continue;
                const file = this.index.files.get(target);
                if (!file) continue;
                const result = results.get(target) || {filepath: target, filename: file.filename, title: file.title, score: 0, sharedTags: []};
                result.score += weight;
                result.sharedTags.push(canonical);
                results.set(target, result);
            }
        }
        return [...results.values()].sort((a, b) => b.score - a.score).slice(0, limit);
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

    private trackUpdate(update: Promise<void>): void {
        this.pendingUpdates.add(update);
        void update.finally(() => this.pendingUpdates.delete(update));
    }

    private scheduleCacheSave(): void {
        this.cacheDirty = true;
        if (this.cacheSaveTimer) clearTimeout(this.cacheSaveTimer);
        if (this.disposed) return;
        this.cacheSaveTimer = setTimeout(() => {
            this.cacheSaveTimer = undefined;
            void this.saveToCache();
        }, 5000);
    }

    private async saveToCache(): Promise<void> {
        if (!this.index) return;
        if (this.cacheSaveTimer) clearTimeout(this.cacheSaveTimer);
        this.cacheSaveTimer = undefined;
        this.cacheDirty = false;
        const paths = [...this.index.files.keys()];
        const ids = new Map(paths.map((filepath, id) => [filepath, id]));
        const serialized = {
            version: CACHE_VERSION,
            vaultPath: this.index.vaultPath,
            lastUpdated: this.index.lastUpdated,
            files: Object.fromEntries(this.index.files),
            paths,
            tagIndex: Object.fromEntries([...this.index.tagIndex].map(([tag, files]) => [tag, [...files].map(p => ids.get(p))])),
            wordIndex: Object.fromEntries([...this.index.wordIndex].map(([term, postings]) => [term,
                Object.fromEntries([...postings].map(([p, count]) => [ids.get(p)!, count]))]))
        };
        const content = new TextEncoder().encode(JSON.stringify(serialized));
        const cachePath = this.getCachePath();
        // Serialize disk writes too, so an older snapshot cannot win a race.
        this.cacheWrite = this.cacheWrite.then(async () => {
            try {
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(cachePath)));
                await vscode.workspace.fs.writeFile(vscode.Uri.file(cachePath), content);
            } catch (error) {
                this.cacheDirty = true;
                console.log('[VaultIndexer] Failed to save cache:', error);
            }
        });
        await this.cacheWrite;
    }

    private async loadFromCache(): Promise<VaultIndex | null> {
        try {
            const content = await vscode.workspace.fs.readFile(vscode.Uri.file(this.getCachePath()));
            const parsed = JSON.parse(new TextDecoder().decode(content));
            const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
            if (parsed.version !== CACHE_VERSION || parsed.vaultPath !== this.vaultPath || !Number.isFinite(parsed.lastUpdated)
                || !object(parsed.files) || !Array.isArray(parsed.paths) || !object(parsed.tagIndex) || !object(parsed.wordIndex)) return null;
            const paths: string[] = parsed.paths;
            if (paths.some(p => typeof p !== 'string') || new Set(paths).size !== paths.length
                || paths.length !== Object.keys(parsed.files).length || paths.some(p => !Object.hasOwn(parsed.files, p))) return null;
            const files = new Map<string, IndexedFile>(Object.entries(parsed.files));
            for (const [p, file] of files) {
                if (!object(file) || file.path !== p || typeof file.filename !== 'string' || typeof file.title !== 'string'
                    || !Number.isFinite(file.modified) || !Number.isFinite(file.contentHash) || typeof file.firstLine !== 'string'
                    || !Number.isInteger(file.wordCount) || file.wordCount < 0 || !Number.isInteger(file.bodyWordCount) || file.bodyWordCount < 0
                    || !Array.isArray(file.tags) || file.tags.some(t => typeof t !== 'string')
                    || !Array.isArray(file.headings) || file.headings.some(h => !object(h) || typeof h.text !== 'string' || !Number.isInteger(h.level) || !Number.isInteger(h.line))
                    || !Array.isArray(file.links) || file.links.some(l => typeof l !== 'string')) return null;
            }
            const resolve = (id: string | number): string | undefined => {
                const n = Number(id);
                return Number.isInteger(n) && n >= 0 && String(n) === String(id) ? paths[n] : undefined;
            };
            const tagIndex = new Map<string, Set<string>>();
            for (const [tag, ids] of Object.entries(parsed.tagIndex)) {
                if (tag !== tag.toLowerCase() || !Array.isArray(ids)) return null;
                const resolved = new Set<string>();
                for (const id of ids) {
                    if (!Number.isInteger(id)) return null;
                    const p = resolve(id);
                    if (p) {
                        if (!files.get(p)!.tags.some(t => t.toLowerCase() === tag)) return null;
                        resolved.add(p);
                    }
                }
                if (resolved.size) tagIndex.set(tag, resolved);
            }
            const wordIndex = new Map<string, Map<string, number>>();
            const counts = new Map<string, number>();
            for (const [term, entries] of Object.entries(parsed.wordIndex)) {
                if (!object(entries) || !/^[a-z0-9]{3,}$/.test(term)) return null;
                const postings = new Map<string, number>();
                for (const [id, count] of Object.entries(entries)) {
                    if (!Number.isInteger(count) || (count as number) <= 0) return null;
                    const p = resolve(id);
                    if (p) {postings.set(p, count as number); counts.set(p, (counts.get(p) || 0) + (count as number));}
                }
                if (postings.size) wordIndex.set(term, postings);
            }
            // Detect incomplete postings rather than trusting unchanged-file reconciliation.
            for (const [p, file] of files) {
                if ((counts.get(p) || 0) !== file.bodyWordCount || file.tags.some(t => !tagIndex.get(t.toLowerCase())?.has(p))) return null;
            }
            return {version: CACHE_VERSION, vaultPath: parsed.vaultPath, lastUpdated: parsed.lastUpdated, files, tagIndex, wordIndex};
        } catch {
            return null;
        }
    }

    /** Cancel timers, finish queued indexing and persist pending changes. */
    async dispose(): Promise<void> {
        this.disposed = true;
        this.watcher?.dispose();
        if (this.cacheSaveTimer) clearTimeout(this.cacheSaveTimer);
        this.cacheSaveTimer = undefined;
        const pendingPaths = [...this.debounceTimers.keys()];
        for (const timer of this.debounceTimers.values()) clearTimeout(timer);
        this.debounceTimers.clear();
        await this.initialization?.catch(() => {});
        await Promise.all([...this.pendingUpdates]);
        for (const p of pendingPaths) {await this.indexFile(p); this.cacheDirty = true;}
        if (this.cacheDirty) await this.saveToCache();
        await this.cacheWrite;
    }
}
