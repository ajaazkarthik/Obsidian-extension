import * as vscode from 'vscode';
import { BrainTool } from './brainTool.js';
import { FilesystemTool } from './filesystemTool.js';
import { ChatHistoryTool } from './chatHistoryTool.js';
import { MemoryTool } from './memoryTool.js';

export function activate(context: vscode.ExtensionContext) {
    console.log('[ObsidianBrain] Extension activating...');

    // Register Brain Tool and initialize indexer
    const brainTool = new BrainTool(context);
    context.subscriptions.push(vscode.lm.registerTool('obsidian_brain', brainTool));
    console.log('[ObsidianBrain] Registered obsidian_brain tool');
    
    // Initialize the brain indexer in background (don't block activation)
    brainTool.initialize().then(() => {
        console.log('[ObsidianBrain] Vault indexer initialized');
    }).catch(err => {
        console.error('[ObsidianBrain] Failed to initialize indexer:', err);
    });

    // Register Memory Tool (workspace-scoped memory within vault)
    const memoryTool = new MemoryTool(context);
    context.subscriptions.push(vscode.lm.registerTool('memory', memoryTool));
    console.log('[ObsidianBrain] Registered memory tool');

    // Register Filesystem Tool
    const filesystemTool = new FilesystemTool(context);
    context.subscriptions.push(vscode.lm.registerTool('integrated_filesystem', filesystemTool));
    console.log('[ObsidianBrain] Registered integrated_filesystem tool');

    // Register Chat History Tool
    const chatHistoryTool = new ChatHistoryTool(context);
    context.subscriptions.push(vscode.lm.registerTool('chat_history', chatHistoryTool));
    console.log('[ObsidianBrain] Registered chat_history tool');

    // Command: Check Obsidian MCP Connection
    context.subscriptions.push(
        vscode.commands.registerCommand('obsidianBrain.checkConnection', async () => {
            const isConnected = await brainTool.checkObsidianMcpConnection();
            if (isConnected) {
                vscode.window.showInformationMessage('✅ Obsidian MCP is connected and ready!');
            } else {
                const selection = await vscode.window.showWarningMessage(
                    '⚠️ Obsidian MCP is not available. Using filesystem fallback.',
                    'Reload Window',
                    'Open Settings'
                );
                if (selection === 'Reload Window') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                } else if (selection === 'Open Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'obsidianBrain');
                }
            }
        })
    );

    // Command: Open Obsidian Vault
    context.subscriptions.push(
        vscode.commands.registerCommand('obsidianBrain.openVault', async () => {
            const config = vscode.workspace.getConfiguration('obsidianBrain');
            const vaultPath = config.get<string>('vaultPath') || 'C:\\workspace\\obsidian-vault';
            
            const uri = vscode.Uri.file(vaultPath);
            
            try {
                // Check if vault exists
                await vscode.workspace.fs.stat(uri);
                
                // Open in new window or add to workspace
                const selection = await vscode.window.showQuickPick(
                    [
                        { label: 'Open in New Window', action: 'new' },
                        { label: 'Add to Workspace', action: 'add' },
                        { label: 'Open in Explorer', action: 'explorer' }
                    ],
                    { placeHolder: 'How would you like to open the vault?' }
                );

                if (selection) {
                    switch (selection.action) {
                        case 'new':
                            vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
                            break;
                        case 'add':
                            vscode.workspace.updateWorkspaceFolders(
                                vscode.workspace.workspaceFolders?.length || 0,
                                0,
                                { uri, name: 'Obsidian Vault' }
                            );
                            break;
                        case 'explorer':
                            vscode.commands.executeCommand('revealFileInOS', uri);
                            break;
                    }
                }
            } catch {
                const createVault = await vscode.window.showWarningMessage(
                    `Vault not found at: ${vaultPath}`,
                    'Create Vault',
                    'Configure Path'
                );
                
                if (createVault === 'Create Vault') {
                    await vscode.workspace.fs.createDirectory(uri);
                    // Create default structure
                    const dirs = ['Engineering', 'Playbooks', 'Decisions', 'Snippets'];
                    for (const dir of dirs) {
                        await vscode.workspace.fs.createDirectory(
                            vscode.Uri.file(`${vaultPath}/${dir}`)
                        );
                    }
                    vscode.window.showInformationMessage(`✅ Created vault at: ${vaultPath}`);
                } else if (createVault === 'Configure Path') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'obsidianBrain.vaultPath');
                }
            }
        })
    );

    // Command: Show Allowed Directories
    context.subscriptions.push(
        vscode.commands.registerCommand('obsidianBrain.showAllowedDirectories', async () => {
            const dirs = filesystemTool.getAllowedDirectories();
            const uniqueDirs = [...new Set(dirs)].sort();
            
            const items = uniqueDirs.map(dir => ({
                label: dir,
                description: ''
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Allowed directories for integrated_filesystem tool',
                canPickMany: false
            });

            if (selected) {
                const uri = vscode.Uri.file(selected.label);
                try {
                    await vscode.workspace.fs.stat(uri);
                    vscode.commands.executeCommand('revealFileInOS', uri);
                } catch {
                    vscode.window.showWarningMessage(`Directory does not exist: ${selected.label}`);
                }
            }
        })
    );

    // Command: Search Chat History
    context.subscriptions.push(
        vscode.commands.registerCommand('obsidianBrain.searchChatHistory', async () => {
            const query = await vscode.window.showInputBox({
                placeHolder: 'Enter search query',
                prompt: 'Search through your VS Code chat history'
            });

            if (query) {
                const results = await chatHistoryTool.search(query);
                
                // Show results in output channel
                const outputChannel = vscode.window.createOutputChannel('Chat History Search');
                outputChannel.clear();
                outputChannel.appendLine(results);
                outputChannel.show();
            }
        })
    );

    // Command: Get Chat Stats
    context.subscriptions.push(
        vscode.commands.registerCommand('obsidianBrain.getChatStats', async () => {
            const stats = await chatHistoryTool.getStats();
            
            // Show stats in output channel
            const outputChannel = vscode.window.createOutputChannel('Chat History Statistics');
            outputChannel.clear();
            outputChannel.appendLine(stats);
            outputChannel.show();
        })
    );

    // Command: Rebuild Brain Index
    context.subscriptions.push(
        vscode.commands.registerCommand('obsidianBrain.rebuildIndex', async () => {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Rebuilding brain index...',
                cancellable: false
            }, async () => {
                await brainTool.initialize();
                vscode.window.showInformationMessage('✅ Brain index rebuilt successfully');
            });
        })
    );

    console.log('[ObsidianBrain] Extension activated successfully!');
}

export function deactivate() {
    console.log('[ObsidianBrain] Extension deactivated');
}
