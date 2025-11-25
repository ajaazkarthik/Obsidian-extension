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
exports.ChatHistoryTool = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
/**
 * ChatHistoryTool provides search and browsing capabilities for VS Code chat history
 * across all workspaces.
 */
class ChatHistoryTool {
    context;
    sessions = new Map();
    indexed = false;
    constructor(context) {
        this.context = context;
    }
    async invoke(options, token) {
        const { operation } = options.input;
        try {
            // Ensure index is built
            if (!this.indexed) {
                await this.buildIndex();
            }
            let result;
            switch (operation) {
                case 'search':
                    result = await this.handleSearch(options.input);
                    break;
                case 'list_sessions':
                    result = await this.handleListSessions(options.input);
                    break;
                case 'read_session':
                    result = await this.handleReadSession(options.input);
                    break;
                case 'get_stats':
                    result = await this.handleGetStats();
                    break;
                case 'export_session':
                    result = await this.handleExportSession(options.input);
                    break;
                case 'rebuild_index':
                    result = await this.handleRebuildIndex();
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
        const { operation, query, session_id } = options.input;
        let message;
        switch (operation) {
            case 'search':
                message = `Searching chat history for: "${query}"`;
                break;
            case 'list_sessions':
                message = 'Listing chat sessions';
                break;
            case 'read_session':
                message = `Reading session: ${session_id}`;
                break;
            case 'get_stats':
                message = 'Getting chat history statistics';
                break;
            case 'export_session':
                message = `Exporting session: ${session_id}`;
                break;
            case 'rebuild_index':
                message = 'Rebuilding chat history index';
                break;
            default:
                message = `Performing chat history operation: ${operation}`;
        }
        return {
            invocationMessage: message
        };
    }
    /**
     * Get chat storage locations based on platform
     */
    getChatStorageLocations() {
        const locations = [];
        let appDataPath;
        const platform = os.platform();
        if (platform === 'win32') {
            appDataPath = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        }
        else if (platform === 'darwin') {
            appDataPath = path.join(os.homedir(), 'Library', 'Application Support');
        }
        else {
            appDataPath = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
        }
        const vscodePath = path.join(appDataPath, 'Code', 'User');
        // Empty window chat sessions
        locations.push(path.join(vscodePath, 'globalStorage', 'emptyWindowChatSessions'));
        // Workspace storage (we'll scan for chatSessions subdirectories)
        locations.push(path.join(vscodePath, 'workspaceStorage'));
        return locations;
    }
    /**
     * Build the index of all chat sessions
     */
    async buildIndex() {
        this.sessions.clear();
        const locations = this.getChatStorageLocations();
        for (const location of locations) {
            try {
                await this.scanLocation(location);
            }
            catch {
                // Location might not exist
            }
        }
        this.indexed = true;
    }
    /**
     * Scan a location for chat sessions
     */
    async scanLocation(location) {
        const uri = vscode.Uri.file(location);
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.type === vscode.FileType.Directory) {
                const entries = await vscode.workspace.fs.readDirectory(uri);
                for (const [name, type] of entries) {
                    if (type === vscode.FileType.Directory) {
                        const subPath = path.join(location, name);
                        // Check for chatSessions or chatEditingSessions
                        if (name === 'chatSessions' || name === 'chatEditingSessions') {
                            await this.scanChatSessionsDir(subPath, location);
                        }
                        else if (name !== 'emptyWindowChatSessions') {
                            // This might be a workspace folder, check for chatSessions inside
                            const chatSessionsPath = path.join(subPath, 'chatSessions');
                            const editingSessionsPath = path.join(subPath, 'chatEditingSessions');
                            try {
                                await this.scanChatSessionsDir(chatSessionsPath, subPath);
                            }
                            catch { /* ignore */ }
                            try {
                                await this.scanChatSessionsDir(editingSessionsPath, subPath);
                            }
                            catch { /* ignore */ }
                        }
                    }
                    else if (name.endsWith('.json')) {
                        // Might be a session file directly
                        await this.parseSessionFile(path.join(location, name), location);
                    }
                }
            }
        }
        catch {
            // Unable to access location
        }
    }
    /**
     * Scan a chatSessions directory
     */
    async scanChatSessionsDir(dirPath, workspacePath) {
        const uri = vscode.Uri.file(dirPath);
        try {
            const entries = await vscode.workspace.fs.readDirectory(uri);
            for (const [name, type] of entries) {
                if (type === vscode.FileType.File && name.endsWith('.json')) {
                    await this.parseSessionFile(path.join(dirPath, name), workspacePath);
                }
            }
        }
        catch {
            // Unable to access directory
        }
    }
    /**
     * Parse a session file
     */
    async parseSessionFile(filePath, workspacePath) {
        try {
            const uri = vscode.Uri.file(filePath);
            const content = await vscode.workspace.fs.readFile(uri);
            const text = new TextDecoder('utf-8').decode(content);
            const data = JSON.parse(text);
            if (!data.sessionId || !Array.isArray(data.requests)) {
                return;
            }
            const stat = await vscode.workspace.fs.stat(uri);
            const requests = [];
            let preview = '';
            for (const req of data.requests) {
                const message = req.message?.text || req.message || '';
                let response = '';
                // Extract response from various formats
                if (Array.isArray(req.response)) {
                    response = req.response
                        .filter((r) => typeof r === 'object' && r !== null && 'value' in r)
                        .map((r) => r.value || '')
                        .join('\n');
                }
                else if (typeof req.response === 'string') {
                    response = req.response;
                }
                // Extract tools used
                const toolsUsed = [];
                if (Array.isArray(req.response)) {
                    for (const r of req.response) {
                        if (r && typeof r === 'object' && 'toolId' in r) {
                            toolsUsed.push(r.toolId);
                        }
                    }
                }
                requests.push({
                    message: typeof message === 'string' ? message : JSON.stringify(message),
                    response,
                    agent: req.agent?.id,
                    model: req.modelId,
                    toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined
                });
                if (!preview && typeof message === 'string' && message.length > 0) {
                    preview = message.slice(0, 100);
                }
            }
            // Extract workspace name from path
            const workspaceName = this.extractWorkspaceName(workspacePath);
            const session = {
                sessionId: data.sessionId,
                workspaceName,
                workspacePath,
                filePath,
                lastModified: new Date(stat.mtime),
                messageCount: requests.length,
                preview: preview || '(empty session)',
                requests
            };
            this.sessions.set(data.sessionId, session);
        }
        catch {
            // Unable to parse session file
        }
    }
    /**
     * Extract workspace name from path
     */
    extractWorkspaceName(workspacePath) {
        // Try to extract from workspace.json if it exists
        const workspaceJsonPath = path.join(workspacePath, 'workspace.json');
        try {
            // This is synchronous approximation - in real code would need async
            return path.basename(workspacePath);
        }
        catch {
            return path.basename(workspacePath);
        }
    }
    /**
     * Parse relative date strings
     */
    parseRelativeDate(dateStr) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        switch (dateStr.toLowerCase()) {
            case 'today':
                return today;
            case 'yesterday':
                return new Date(today.getTime() - 24 * 60 * 60 * 1000);
            case 'last_week':
                return new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
            case 'last_month':
                return new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
            default:
                // Try ISO date
                const parsed = new Date(dateStr);
                if (!isNaN(parsed.getTime())) {
                    return parsed;
                }
                return new Date(0);
        }
    }
    async handleSearch(input) {
        if (!input.query) {
            throw new Error('Query is required for search operation');
        }
        const query = input.query.toLowerCase();
        const matches = [];
        const limit = input.limit || 20;
        const includeResponses = input.include_responses !== false;
        // Parse date filters
        const dateFrom = input.date_from ? this.parseRelativeDate(input.date_from) : null;
        const dateTo = input.date_to ? this.parseRelativeDate(input.date_to) : null;
        for (const session of this.sessions.values()) {
            // Apply workspace filter
            if (input.workspace && !session.workspaceName.toLowerCase().includes(input.workspace.toLowerCase())) {
                continue;
            }
            // Apply date filter
            if (dateFrom && session.lastModified < dateFrom)
                continue;
            if (dateTo && session.lastModified > dateTo)
                continue;
            for (const req of session.requests) {
                // Search in user message
                if (req.message.toLowerCase().includes(query)) {
                    matches.push({
                        sessionId: session.sessionId,
                        workspaceName: session.workspaceName,
                        messageType: 'user',
                        content: req.message,
                        context: this.getMatchContext(req.message, query),
                        date: session.lastModified
                    });
                }
                // Search in assistant response
                if (includeResponses && req.response.toLowerCase().includes(query)) {
                    matches.push({
                        sessionId: session.sessionId,
                        workspaceName: session.workspaceName,
                        messageType: 'assistant',
                        content: req.response,
                        context: this.getMatchContext(req.response, query),
                        date: session.lastModified
                    });
                }
                if (matches.length >= limit)
                    break;
            }
            if (matches.length >= limit)
                break;
        }
        // Sort by date descending
        matches.sort((a, b) => b.date.getTime() - a.date.getTime());
        if (matches.length === 0) {
            return `No results found for "${input.query}" in chat history.`;
        }
        let output = `Found ${matches.length} match(es) for "${input.query}":\n\n`;
        for (const match of matches.slice(0, limit)) {
            output += `---\n`;
            output += `Session: ${match.sessionId.slice(0, 8)}...\n`;
            output += `Workspace: ${match.workspaceName}\n`;
            output += `Type: ${match.messageType}\n`;
            output += `Date: ${match.date.toISOString().split('T')[0]}\n`;
            output += `Context: "${match.context}"\n\n`;
        }
        return output;
    }
    getMatchContext(text, query) {
        const lowerText = text.toLowerCase();
        const index = lowerText.indexOf(query);
        if (index === -1)
            return text.slice(0, 150);
        const start = Math.max(0, index - 50);
        const end = Math.min(text.length, index + query.length + 100);
        let context = text.slice(start, end);
        if (start > 0)
            context = '...' + context;
        if (end < text.length)
            context = context + '...';
        return context.replace(/\n/g, ' ');
    }
    async handleListSessions(input) {
        const limit = input.limit || 20;
        // Parse date filters
        const dateFrom = input.date_from ? this.parseRelativeDate(input.date_from) : null;
        const dateTo = input.date_to ? this.parseRelativeDate(input.date_to) : null;
        let sessions = Array.from(this.sessions.values());
        // Apply filters
        if (input.workspace) {
            sessions = sessions.filter(s => s.workspaceName.toLowerCase().includes(input.workspace.toLowerCase()));
        }
        if (dateFrom) {
            sessions = sessions.filter(s => s.lastModified >= dateFrom);
        }
        if (dateTo) {
            sessions = sessions.filter(s => s.lastModified <= dateTo);
        }
        // Sort by date descending
        sessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
        if (sessions.length === 0) {
            return 'No chat sessions found.';
        }
        let output = `Found ${sessions.length} session(s):\n\n`;
        for (const session of sessions.slice(0, limit)) {
            output += `---\n`;
            output += `ID: ${session.sessionId}\n`;
            output += `Workspace: ${session.workspaceName}\n`;
            output += `Messages: ${session.messageCount}\n`;
            output += `Last Modified: ${session.lastModified.toISOString()}\n`;
            output += `Preview: "${session.preview}"\n\n`;
        }
        if (sessions.length > limit) {
            output += `\n... and ${sessions.length - limit} more sessions.`;
        }
        return output;
    }
    async handleReadSession(input) {
        if (!input.session_id) {
            throw new Error('Session ID is required for read_session operation');
        }
        // Find session by ID (partial match)
        let session;
        for (const [id, s] of this.sessions.entries()) {
            if (id.startsWith(input.session_id) || id === input.session_id) {
                session = s;
                break;
            }
        }
        if (!session) {
            throw new Error(`Session not found: ${input.session_id}`);
        }
        let output = `# Chat Session: ${session.sessionId}\n\n`;
        output += `Workspace: ${session.workspaceName}\n`;
        output += `Last Modified: ${session.lastModified.toISOString()}\n`;
        output += `Message Count: ${session.messageCount}\n\n`;
        output += `---\n\n`;
        for (let i = 0; i < session.requests.length; i++) {
            const req = session.requests[i];
            output += `## Message ${i + 1}\n\n`;
            if (req.agent) {
                output += `Agent: ${req.agent}\n`;
            }
            if (req.model) {
                output += `Model: ${req.model}\n`;
            }
            output += `\n**User:**\n${req.message}\n\n`;
            if (req.response) {
                output += `**Assistant:**\n${req.response}\n\n`;
            }
            if (req.toolsUsed && req.toolsUsed.length > 0) {
                output += `Tools Used: ${req.toolsUsed.join(', ')}\n\n`;
            }
            output += `---\n\n`;
        }
        return output;
    }
    async handleGetStats() {
        const totalSessions = this.sessions.size;
        let totalMessages = 0;
        const workspaces = new Set();
        const agents = new Map();
        const models = new Map();
        let oldestDate = null;
        let newestDate = null;
        for (const session of this.sessions.values()) {
            totalMessages += session.messageCount;
            workspaces.add(session.workspaceName);
            if (!oldestDate || session.lastModified < oldestDate) {
                oldestDate = session.lastModified;
            }
            if (!newestDate || session.lastModified > newestDate) {
                newestDate = session.lastModified;
            }
            for (const req of session.requests) {
                if (req.agent) {
                    agents.set(req.agent, (agents.get(req.agent) || 0) + 1);
                }
                if (req.model) {
                    models.set(req.model, (models.get(req.model) || 0) + 1);
                }
            }
        }
        let output = `# Chat History Statistics\n\n`;
        output += `Total Sessions: ${totalSessions}\n`;
        output += `Total Messages: ${totalMessages}\n`;
        output += `Unique Workspaces: ${workspaces.size}\n`;
        if (oldestDate && newestDate) {
            output += `Date Range: ${oldestDate.toISOString().split('T')[0]} to ${newestDate.toISOString().split('T')[0]}\n`;
        }
        if (agents.size > 0) {
            output += `\n## Agents Used:\n`;
            const sortedAgents = Array.from(agents.entries()).sort((a, b) => b[1] - a[1]);
            for (const [agent, count] of sortedAgents) {
                output += `- ${agent}: ${count} messages\n`;
            }
        }
        if (models.size > 0) {
            output += `\n## Models Used:\n`;
            const sortedModels = Array.from(models.entries()).sort((a, b) => b[1] - a[1]);
            for (const [model, count] of sortedModels) {
                output += `- ${model}: ${count} messages\n`;
            }
        }
        return output;
    }
    async handleExportSession(input) {
        if (!input.session_id) {
            throw new Error('Session ID is required for export_session operation');
        }
        // Find session
        let session;
        for (const [id, s] of this.sessions.entries()) {
            if (id.startsWith(input.session_id) || id === input.session_id) {
                session = s;
                break;
            }
        }
        if (!session) {
            throw new Error(`Session not found: ${input.session_id}`);
        }
        // Generate markdown export
        const dateStr = session.lastModified.toISOString().split('T')[0];
        const filename = `chat-export-${dateStr}-${session.sessionId.slice(0, 8)}.md`;
        let content = `---\n`;
        content += `title: Chat Export - ${session.preview.slice(0, 50)}\n`;
        content += `date: ${session.lastModified.toISOString()}\n`;
        content += `workspace: ${session.workspaceName}\n`;
        content += `session_id: ${session.sessionId}\n`;
        content += `tags: [chat-export, ${session.workspaceName}]\n`;
        content += `---\n\n`;
        content += `# Chat Session Export\n\n`;
        content += `Exported from: ${session.workspaceName}\n`;
        content += `Date: ${session.lastModified.toISOString()}\n`;
        content += `Messages: ${session.messageCount}\n\n`;
        content += `---\n\n`;
        for (let i = 0; i < session.requests.length; i++) {
            const req = session.requests[i];
            content += `## Exchange ${i + 1}\n\n`;
            content += `### User\n\n${req.message}\n\n`;
            if (req.response) {
                content += `### Assistant\n\n${req.response}\n\n`;
            }
            if (req.toolsUsed && req.toolsUsed.length > 0) {
                content += `*Tools: ${req.toolsUsed.join(', ')}*\n\n`;
            }
        }
        // Get vault path
        const config = vscode.workspace.getConfiguration('obsidianBrain');
        const vaultPath = config.get('vaultPath') || 'C:\\workspace\\obsidian-vault';
        const exportPath = path.join(vaultPath, 'Engineering', 'ChatExports', filename);
        // Create directory and write file
        const exportUri = vscode.Uri.file(exportPath);
        const parentUri = vscode.Uri.file(path.dirname(exportPath));
        try {
            await vscode.workspace.fs.createDirectory(parentUri);
        }
        catch { /* ignore */ }
        const data = new TextEncoder().encode(content);
        await vscode.workspace.fs.writeFile(exportUri, data);
        return `✅ Session exported to: ${exportPath}`;
    }
    async handleRebuildIndex() {
        this.indexed = false;
        await this.buildIndex();
        return `✅ Index rebuilt. Found ${this.sessions.size} session(s).`;
    }
    errorResult(message) {
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`❌ Error: ${message}`)
        ]);
    }
    /**
     * Public method to get stats (used by commands)
     */
    async getStats() {
        if (!this.indexed) {
            await this.buildIndex();
        }
        return this.handleGetStats();
    }
    /**
     * Public method to search (used by commands)
     */
    async search(query) {
        if (!this.indexed) {
            await this.buildIndex();
        }
        return this.handleSearch({ operation: 'search', query });
    }
}
exports.ChatHistoryTool = ChatHistoryTool;
//# sourceMappingURL=chatHistoryTool.js.map