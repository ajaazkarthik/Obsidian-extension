import * as vscode from 'vscode';
interface MemoryToolInput {
    command: 'view' | 'create' | 'str_replace' | 'insert' | 'delete' | 'rename';
    path?: string;
    view_range?: [number, number];
    file_text?: string;
    old_str?: string;
    new_str?: string;
    insert_line?: number;
    insert_text?: string;
    old_path?: string;
    new_path?: string;
}
/**
 * MemoryTool provides workspace-scoped memory storage within the Obsidian vault.
 * Works like Agent Memory but stores in vault's _Workspaces/[workspace-name]/ directory.
 * This gives workspace isolation while still being part of the global brain.
 */
export declare class MemoryTool implements vscode.LanguageModelTool<MemoryToolInput> {
    private context;
    private filesystemBackend;
    private workspaceMemoryPath;
    constructor(context: vscode.ExtensionContext);
    private initializeWorkspacePath;
    private getFullPath;
    invoke(options: vscode.LanguageModelToolInvocationOptions<MemoryToolInput>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult>;
    prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<MemoryToolInput>, token: vscode.CancellationToken): Promise<vscode.PreparedToolInvocation>;
    private handleView;
    private handleCreate;
    private handleStrReplace;
    private handleInsert;
    private handleDelete;
    private handleRename;
    private errorResult;
    /**
     * Get the current workspace memory path for display
     */
    getWorkspaceMemoryPath(): string;
}
export {};
