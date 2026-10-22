import * as vscode from 'vscode';
import { BrainTool } from './brainTool.js';
import { configuredVaultPath } from './filesystemBackend.js';
import { installAgentHooks } from './hookInstaller.js';

let activeBrainTool: BrainTool | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('[ObsidianBrain] Extension activating...');

    // Register Brain Tool and initialize indexer
    const brainTool = new BrainTool(context);
    activeBrainTool = brainTool;
    context.subscriptions.push(vscode.lm.registerTool('obsidian_brain', brainTool), brainTool);
    console.log('[ObsidianBrain] Registered obsidian_brain tool');

    // Install the brain-usage enforcement hook into the user-level Copilot
    // folders so it travels with the extension to every workspace and machine.
    void installAgentHooks(context, { vaultPath: safeVaultPath() }).then(report => {
        if (report.installed) {
            console.log(`[ObsidianBrain] Agent hooks ready in ${report.hooksDir} (${report.written.length} written, ${report.skipped.length} user-owned)`);
        } else {
            console.log(`[ObsidianBrain] Agent hooks not installed: ${report.reason}`);
        }
    });
    
    // Initialize the brain indexer in background (don't block activation)
    brainTool.initialize().then(() => {
        console.log('[ObsidianBrain] Vault indexer initialized');
    }).catch(err => {
        console.error('[ObsidianBrain] Failed to initialize indexer:', err);
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('obsidianBrain.configureVault', async () => {
            const folders = await vscode.window.showOpenDialog({canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Use Obsidian Vault'});
            if (!folders?.[0]) return;
            const config = vscode.workspace.getConfiguration('obsidianBrain');
            const existing = config.inspect<string>('vaultPath');
            const target = existing?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
                : existing?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
            await config.update('vaultPath', folders[0].fsPath, target);
            try {
                await brainTool.initialize();
                vscode.window.showInformationMessage(`✅ Obsidian vault configured: ${folders[0].fsPath}`);
            } catch (error) {
                vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
            }
        })
    );

    // Command: Check the configured vault through the native I/O backend.
    context.subscriptions.push(
        vscode.commands.registerCommand('obsidianBrain.checkConnection', async () => {
            const isConnected = await brainTool.checkConnection();
            if (isConnected) {
                vscode.window.showInformationMessage('✅ Obsidian vault is accessible and ready!');
            } else {
                const selection = await vscode.window.showWarningMessage(
                    '⚠️ Obsidian vault is not accessible. Check the configured vault path.',
                    'Open Settings'
                );
                if (selection === 'Open Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'obsidianBrain.vaultPath');
                }
            }
        })
    );

    // Command: Open Obsidian Vault
    context.subscriptions.push(
        vscode.commands.registerCommand('obsidianBrain.openVault', async () => {
            let vaultPath: string;
            try { vaultPath = configuredVaultPath(); } catch (error) {
                vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
                return;
            }
            
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

    // Command: Rebuild Brain Index
    context.subscriptions.push(
        vscode.commands.registerCommand('obsidianBrain.rebuildIndex', async () => {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Rebuilding brain index...',
                cancellable: false
            }, async () => {
                await brainTool.rebuildIndex();
                vscode.window.showInformationMessage('✅ Brain index rebuilt successfully');
            });
        })
    );

    console.log('[ObsidianBrain] Extension activated successfully!');
}

/** Vault path for the hook env var; blank when unset or invalid. */
function safeVaultPath(): string | undefined {
    try {
        return configuredVaultPath();
    } catch {
        return undefined;
    }
}

export async function deactivate(): Promise<void> {
    await activeBrainTool?.dispose();
    activeBrainTool = undefined;
    console.log('[ObsidianBrain] Extension deactivated');
}
