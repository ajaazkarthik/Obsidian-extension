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
exports.VaultIndexer = exports.CACHE_VERSION = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const filesystemBackend_js_1 = require("./filesystemBackend.js");
exports.CACHE_VERSION = 3;
class VaultIndexer {
    configuredPath;
    index = null;
    vaultPath = '';
    watcher;
    indexing = false;
    initialized = false;
    debounceTimers = new Map();
    initialization;
    cacheSaveTimer;
    cacheDirty = false;
    cacheWrite = Promise.resolve();
    pendingUpdates = new Set();
    disposed = false;
    constructor(configuredPath) {
        this.configuredPath = configuredPath;
    }
    refreshVaultPath() {
        this.vaultPath = this.configuredPath ?? (0, filesystemBackend_js_1.configuredVaultPath)();
    }
    /**
     * Initialize the index - call this on extension activation
     */
    async initialize() {
        if (this.disposed || this.initialized)
            return;
        if (!this.initialization)
            this.initialization = this.initializeIndex();
        try {
            await this.initialization;
        }
        catch (error) {
            this.initialization = undefined;
            throw error;
        }
    }
    async initializeIndex() {
        this.refreshVaultPath();
        await (0, filesystemBackend_js_1.prepareVault)(this.vaultPath);
        // Try to load from cache
        const cached = await this.loadFromCache();
        if (cached && cached.vaultPath === this.vaultPath) {
            this.index = cached;
            // Do a quick delta update for any changed files
            await this.deltaUpdate();
        }
        else {
            // Full rebuild
            await this.rebuildIndex();
        }
        // Start file watcher
        if (!this.disposed)
            this.startWatcher();
        this.initialized = true;
    }
    /**
     * Check if index is ready
     */
    isReady() {
        return this.index !== null && !this.indexing;
    }
    /**
     * Get index statistics
     */
    getStats() {
        if (!this.index)
            return null;
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
    getFileInfo(filepath) {
        if (!this.index)
            return null;
        // Normalize filepath (remove leading slash if present)
        const normalizedPath = (0, filesystemBackend_js_1.normalizeNotePath)(filepath);
        return this.index.files.get(normalizedPath) || null;
    }
    /**
     * Get recently modified files sorted by modification time (most recent first)
     */
    getRecentFiles(limit = 10) {
        if (!this.index)
            return [];
        const files = Array.from(this.index.files.values());
        // Sort by modification time descending
        files.sort((a, b) => b.modified - a.modified);
        return files.slice(0, limit);
    }
    /**
     * Immediately index a specific file (call after writes for instant searchability)
     */
    async indexFileImmediately(filepath) {
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
    removeFileImmediately(filepath) {
        this.removeFromIndex(filepath);
        if (this.index) {
            this.index.lastUpdated = Date.now();
            this.scheduleCacheSave();
        }
    }
    /**
     * Smart search with OR logic for multiple words, tag support, and scoring
     */
    async search(query, limit = 20) {
        if (!this.index) {
            await this.initialize();
        }
        if (!this.index)
            return [];
        const results = [];
        const seenPaths = new Set();
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
                            score: 8.0, // High score for explicit tag search
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
            let matchType = 'content';
            let context;
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
                    if (heading)
                        context = heading.text;
                }
                // Word index match (content contains word)
                else if (this.index.wordIndex.get(token)?.has(filepath)) {
                    const wordFiles = this.index.wordIndex.get(token);
                    const idf = Math.log((totalFiles + 1) / (wordFiles.size + 1)) / Math.log(totalFiles + 2);
                    score += Math.max(0.5, idf * Math.log(1 + wordFiles.get(filepath)));
                    matchType = 'content';
                }
            }
            // Recency orders matching notes; it must not create unrelated hits.
            if (score === 0)
                continue;
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
    getAllTags() {
        if (!this.index)
            return [];
        return Array.from(this.index.tagIndex.keys()).sort();
    }
    /**
     * Full index rebuild
     */
    async rebuildIndex() {
        this.refreshVaultPath();
        await (0, filesystemBackend_js_1.prepareVault)(this.vaultPath);
        this.indexing = true;
        this.index = {
            version: exports.CACHE_VERSION,
            vaultPath: this.vaultPath,
            lastUpdated: Date.now(),
            files: new Map(),
            tagIndex: new Map(),
            wordIndex: new Map()
        };
        try {
            await this.indexDirectory('');
            await this.saveToCache();
        }
        finally {
            this.indexing = false;
        }
    }
    /**
     * Incremental update - only reindex changed files
     */
    async deltaUpdate() {
        if (!this.index)
            return;
        this.indexing = true;
        try {
            const currentFiles = new Set();
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
                }
                else {
                    // Check if modified (simple mtime check)
                    try {
                        const uri = vscode.Uri.file(path.join(this.vaultPath, filepath));
                        const stat = await vscode.workspace.fs.stat(uri);
                        if (stat.mtime !== existing.modified) {
                            await this.indexFile(filepath);
                        }
                    }
                    catch {
                        // File might have been deleted
                    }
                }
            }
            this.index.lastUpdated = Date.now();
            await this.saveToCache();
        }
        finally {
            this.indexing = false;
        }
    }
    /**
     * Collect all markdown file paths
     */
    async collectFiles(dirPath, files) {
        const fullPath = dirPath ? path.join(this.vaultPath, dirPath) : this.vaultPath;
        const uri = vscode.Uri.file(fullPath);
        try {
            const entries = await vscode.workspace.fs.readDirectory(uri);
            for (const [name, type] of entries) {
                if (name.startsWith('.'))
                    continue;
                const relativePath = dirPath ? `${dirPath}/${name}` : name;
                if (type === vscode.FileType.Directory) {
                    await this.collectFiles(relativePath, files);
                }
                else if (name.endsWith('.md')) {
                    files.add(relativePath);
                }
            }
        }
        catch {
            // Directory doesn't exist or not accessible
        }
    }
    /**
     * Recursively index a directory
     */
    async indexDirectory(dirPath) {
        const fullPath = dirPath ? path.join(this.vaultPath, dirPath) : this.vaultPath;
        const uri = vscode.Uri.file(fullPath);
        try {
            const entries = await vscode.workspace.fs.readDirectory(uri);
            for (const [name, type] of entries) {
                // Skip hidden files/directories
                if (name.startsWith('.'))
                    continue;
                const relativePath = dirPath ? `${dirPath}/${name}` : name;
                if (type === vscode.FileType.Directory) {
                    await this.indexDirectory(relativePath);
                }
                else if (name.endsWith('.md')) {
                    await this.indexFile(relativePath);
                }
            }
        }
        catch {
            // Directory doesn't exist or not accessible
        }
    }
    /**
     * Index a single file
     */
    async indexFile(filepath) {
        if (!this.index)
            return;
        filepath = (0, filesystemBackend_js_1.normalizeNotePath)(filepath);
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
            const entry = {
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
                this.index.tagIndex.get(tagLower).add(filepath);
            }
            // Keep term frequency for body relevance and lossless persistence.
            for (const word of words.filter(w => w.length >= 3)) {
                if (!this.index.wordIndex.has(word))
                    this.index.wordIndex.set(word, new Map());
                const postings = this.index.wordIndex.get(word);
                postings.set(filepath, (postings.get(filepath) || 0) + 1);
            }
            this.index.lastUpdated = Date.now();
        }
        catch (error) {
            // File might not exist or be readable
            console.log(`[VaultIndexer] Failed to index ${filepath}:`, error);
        }
    }
    /**
     * Remove a file from all indexes
     */
    removeFromIndex(filepath) {
        if (!this.index)
            return;
        filepath = (0, filesystemBackend_js_1.normalizeNotePath)(filepath);
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
                if (postings.size === 0)
                    this.index.wordIndex.delete(word);
            }
            this.index.files.delete(filepath);
        }
    }
    /**
     * Start file watcher for live updates
     */
    startWatcher() {
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
    onFileCreated(uri) {
        const filepath = this.getRelativePath(uri);
        if (filepath && !filepath.startsWith('.')) {
            this.trackUpdate(this.indexFile(filepath).then(() => this.scheduleCacheSave()));
        }
    }
    onFileChanged(uri) {
        const filepath = this.getRelativePath(uri);
        if (!filepath || filepath.startsWith('.'))
            return;
        // Debounce: wait 500ms after last change
        if (this.debounceTimers.has(filepath)) {
            clearTimeout(this.debounceTimers.get(filepath));
        }
        this.debounceTimers.set(filepath, setTimeout(() => {
            this.debounceTimers.delete(filepath);
            this.trackUpdate(this.indexFile(filepath).then(() => this.scheduleCacheSave()));
        }, 500));
    }
    onFileDeleted(uri) {
        const filepath = this.getRelativePath(uri);
        if (filepath) {
            this.removeFileImmediately(filepath);
        }
    }
    getRelativePath(uri) {
        const relative = path.relative(this.vaultPath, uri.fsPath);
        if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
            return relative.replace(/\\/g, '/');
        }
        return null;
    }
    // ========== Extraction helpers ==========
    extractTitle(content, filename) {
        // Try to find first H1
        const h1Match = content.match(/^#\s+(.+)$/m);
        if (h1Match)
            return h1Match[1].trim();
        // Fall back to filename without extension
        return filename.replace(/\.md$/, '');
    }
    /** Canonical tags shared by indexing, summaries and auto-tag analysis. */
    extractTags(content) {
        const tags = new Map();
        const add = (raw) => {
            const tag = raw.trim().replace(/^(['"])(.*)\1$/, '$2').trim().replace(/^#/, '').trim();
            if (tag && !tags.has(tag.toLowerCase()))
                tags.set(tag.toLowerCase(), tag);
        };
        const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
        if (frontmatter) {
            const yaml = frontmatter[1];
            const array = yaml.match(/^tags:[ \t]*\[([^\]]*)\][ \t]*\r?$/m);
            if (array)
                array[1].split(',').forEach(add);
            const list = yaml.match(/^tags:[ \t]*\r?\n((?:[ \t]*-[ \t]*[^\r\n]*(?:\r?\n|$))+)/m);
            if (list)
                for (const line of list[1].split(/\r?\n/)) {
                    const item = line.match(/^[ \t]*-[ \t]*(.*)$/);
                    if (item)
                        add(item[1]);
                }
        }
        // Strip fenced blocks (including unclosed fences), then inline code spans.
        let fence;
        const body = content.slice(frontmatter?.[0].length || 0).split(/\r?\n/).map(line => {
            const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
            if (fence) {
                if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim())
                    fence = undefined;
                return '';
            }
            if (marker) {
                fence = { char: marker[1][0], length: marker[1].length };
                return '';
            }
            return line;
        }).join('\n').replace(/(`+)[\s\S]*?\1(?!`)/g, '');
        const inline = /(?:^|[\s(\[])#([a-zA-Z][a-zA-Z0-9_-]*)/gm;
        for (const match of body.matchAll(inline)) {
            const tag = match[1];
            if (tag.length < 2 || /^L\d+(?:-L?\d+)?$/i.test(tag))
                continue;
            if (/^(?:[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$/.test(tag) && /\d/.test(tag))
                continue;
            add(tag);
        }
        return [...tags.values()];
    }
    extractHeadings(content) {
        const headings = [];
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
    extractLinks(content) {
        const links = [];
        const wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        let match;
        while ((match = wikiLinkRegex.exec(content))) {
            links.push(match[1]);
        }
        return links;
    }
    extractFirstLine(content) {
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
    tokenize(text) {
        // Simple tokenization: split on non-alphanumeric, filter short words
        return text
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(word => word.length >= 2)
            .map(word => this.stem(word));
    }
    stem(word) {
        if (word.length <= 4)
            return word;
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
    getRelatedNotes(filepath, limit = 10) {
        if (!this.index)
            return [];
        const source = this.getFileInfo(filepath);
        if (!source)
            return [];
        const results = new Map();
        const totalFiles = this.index.files.size;
        for (const tag of source.tags) {
            const canonical = tag.toLowerCase();
            const paths = this.index.tagIndex.get(canonical);
            if (!paths || paths.size < 2)
                continue;
            const weight = Math.max(0.1, Math.log((totalFiles + 1) / (paths.size + 1)) / Math.log(totalFiles + 2));
            for (const target of paths) {
                if (target === source.path)
                    continue;
                const file = this.index.files.get(target);
                if (!file)
                    continue;
                const result = results.get(target) || { filepath: target, filename: file.filename, title: file.title, score: 0, sharedTags: [] };
                result.score += weight;
                result.sharedTags.push(canonical);
                results.set(target, result);
            }
        }
        return [...results.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    }
    hashContent(content) {
        let hash = 0;
        for (let i = 0; i < Math.min(content.length, 10000); i++) {
            hash = ((hash << 5) - hash) + content.charCodeAt(i);
            hash |= 0;
        }
        return hash;
    }
    // ========== Cache persistence ==========
    getCachePath() {
        return path.join(this.vaultPath, '.obsidian-brain', 'index.json');
    }
    trackUpdate(update) {
        this.pendingUpdates.add(update);
        void update.finally(() => this.pendingUpdates.delete(update));
    }
    scheduleCacheSave() {
        this.cacheDirty = true;
        if (this.cacheSaveTimer)
            clearTimeout(this.cacheSaveTimer);
        if (this.disposed)
            return;
        this.cacheSaveTimer = setTimeout(() => {
            this.cacheSaveTimer = undefined;
            void this.saveToCache();
        }, 5000);
    }
    async saveToCache() {
        if (!this.index)
            return;
        if (this.cacheSaveTimer)
            clearTimeout(this.cacheSaveTimer);
        this.cacheSaveTimer = undefined;
        this.cacheDirty = false;
        const paths = [...this.index.files.keys()];
        const ids = new Map(paths.map((filepath, id) => [filepath, id]));
        const serialized = {
            version: exports.CACHE_VERSION,
            vaultPath: this.index.vaultPath,
            lastUpdated: this.index.lastUpdated,
            files: Object.fromEntries(this.index.files),
            paths,
            tagIndex: Object.fromEntries([...this.index.tagIndex].map(([tag, files]) => [tag, [...files].map(p => ids.get(p))])),
            wordIndex: Object.fromEntries([...this.index.wordIndex].map(([term, postings]) => [term,
                Object.fromEntries([...postings].map(([p, count]) => [ids.get(p), count]))]))
        };
        const content = new TextEncoder().encode(JSON.stringify(serialized));
        const cachePath = this.getCachePath();
        // Serialize disk writes too, so an older snapshot cannot win a race.
        this.cacheWrite = this.cacheWrite.then(async () => {
            try {
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(cachePath)));
                await vscode.workspace.fs.writeFile(vscode.Uri.file(cachePath), content);
            }
            catch (error) {
                this.cacheDirty = true;
                console.log('[VaultIndexer] Failed to save cache:', error);
            }
        });
        await this.cacheWrite;
    }
    async loadFromCache() {
        try {
            const content = await vscode.workspace.fs.readFile(vscode.Uri.file(this.getCachePath()));
            const parsed = JSON.parse(new TextDecoder().decode(content));
            const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
            if (parsed.version !== exports.CACHE_VERSION || parsed.vaultPath !== this.vaultPath || !Number.isFinite(parsed.lastUpdated)
                || !object(parsed.files) || !Array.isArray(parsed.paths) || !object(parsed.tagIndex) || !object(parsed.wordIndex))
                return null;
            const paths = parsed.paths;
            if (paths.some(p => typeof p !== 'string') || new Set(paths).size !== paths.length
                || paths.length !== Object.keys(parsed.files).length || paths.some(p => !Object.hasOwn(parsed.files, p)))
                return null;
            const files = new Map(Object.entries(parsed.files));
            for (const [p, file] of files) {
                if (!object(file) || file.path !== p || typeof file.filename !== 'string' || typeof file.title !== 'string'
                    || !Number.isFinite(file.modified) || !Number.isFinite(file.contentHash) || typeof file.firstLine !== 'string'
                    || !Number.isInteger(file.wordCount) || file.wordCount < 0 || !Number.isInteger(file.bodyWordCount) || file.bodyWordCount < 0
                    || !Array.isArray(file.tags) || file.tags.some(t => typeof t !== 'string')
                    || !Array.isArray(file.headings) || file.headings.some(h => !object(h) || typeof h.text !== 'string' || !Number.isInteger(h.level) || !Number.isInteger(h.line))
                    || !Array.isArray(file.links) || file.links.some(l => typeof l !== 'string'))
                    return null;
            }
            const resolve = (id) => {
                const n = Number(id);
                return Number.isInteger(n) && n >= 0 && String(n) === String(id) ? paths[n] : undefined;
            };
            const tagIndex = new Map();
            for (const [tag, ids] of Object.entries(parsed.tagIndex)) {
                if (tag !== tag.toLowerCase() || !Array.isArray(ids))
                    return null;
                const resolved = new Set();
                for (const id of ids) {
                    if (!Number.isInteger(id))
                        return null;
                    const p = resolve(id);
                    if (p) {
                        if (!files.get(p).tags.some(t => t.toLowerCase() === tag))
                            return null;
                        resolved.add(p);
                    }
                }
                if (resolved.size)
                    tagIndex.set(tag, resolved);
            }
            const wordIndex = new Map();
            const counts = new Map();
            for (const [term, entries] of Object.entries(parsed.wordIndex)) {
                if (!object(entries) || !/^[a-z0-9]{3,}$/.test(term))
                    return null;
                const postings = new Map();
                for (const [id, count] of Object.entries(entries)) {
                    if (!Number.isInteger(count) || count <= 0)
                        return null;
                    const p = resolve(id);
                    if (p) {
                        postings.set(p, count);
                        counts.set(p, (counts.get(p) || 0) + count);
                    }
                }
                if (postings.size)
                    wordIndex.set(term, postings);
            }
            // Detect incomplete postings rather than trusting unchanged-file reconciliation.
            for (const [p, file] of files) {
                if ((counts.get(p) || 0) !== file.bodyWordCount || file.tags.some(t => !tagIndex.get(t.toLowerCase())?.has(p)))
                    return null;
            }
            return { version: exports.CACHE_VERSION, vaultPath: parsed.vaultPath, lastUpdated: parsed.lastUpdated, files, tagIndex, wordIndex };
        }
        catch {
            return null;
        }
    }
    /** Cancel timers, finish queued indexing and persist pending changes. */
    async dispose() {
        this.disposed = true;
        this.watcher?.dispose();
        if (this.cacheSaveTimer)
            clearTimeout(this.cacheSaveTimer);
        this.cacheSaveTimer = undefined;
        const pendingPaths = [...this.debounceTimers.keys()];
        for (const timer of this.debounceTimers.values())
            clearTimeout(timer);
        this.debounceTimers.clear();
        await this.initialization?.catch(() => { });
        await Promise.all([...this.pendingUpdates]);
        for (const p of pendingPaths) {
            await this.indexFile(p);
            this.cacheDirty = true;
        }
        if (this.cacheDirty)
            await this.saveToCache();
        await this.cacheWrite;
    }
}
exports.VaultIndexer = VaultIndexer;
//# sourceMappingURL=vaultIndexer.js.map