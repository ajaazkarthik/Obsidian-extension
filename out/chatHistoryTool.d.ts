import * as vscode from 'vscode';
interface ChatHistoryToolInput {
    operation: 'search' | 'list_sessions' | 'read_session' | 'get_stats' | 'export_session' | 'rebuild_index';
    query?: string;
    session_id?: string;
    date_from?: string;
    date_to?: string;
    workspace?: string;
    limit?: number;
    include_responses?: boolean;
}
/**
 * ChatHistoryTool provides search and browsing capabilities for VS Code chat history
 * across all workspaces.
 */
export declare class ChatHistoryTool implements vscode.LanguageModelTool<ChatHistoryToolInput> {
    private context;
    private sessions;
    private indexed;
    constructor(context: vscode.ExtensionContext);
    invoke(options: vscode.LanguageModelToolInvocationOptions<ChatHistoryToolInput>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult>;
    prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ChatHistoryToolInput>, token: vscode.CancellationToken): Promise<vscode.PreparedToolInvocation>;
    /**
     * Get chat storage locations based on platform
     */
    private getChatStorageLocations;
    /**
     * Build the index of all chat sessions
     */
    buildIndex(): Promise<void>;
    /**
     * Scan a location for chat sessions
     */
    private scanLocation;
    /**
     * Scan a chatSessions directory
     */
    private scanChatSessionsDir;
    /**
     * Parse a session file
     */
    private parseSessionFile;
    /**
     * Extract workspace name from path
     */
    private extractWorkspaceName;
    /**
     * Parse relative date strings
     */
    private parseRelativeDate;
    private handleSearch;
    private getMatchContext;
    private handleListSessions;
    private handleReadSession;
    private handleGetStats;
    private handleExportSession;
    private handleRebuildIndex;
    private errorResult;
    /**
     * Public method to get stats (used by commands)
     */
    getStats(): Promise<string>;
    /**
     * Public method to search (used by commands)
     */
    search(query: string): Promise<string>;
}
export {};
