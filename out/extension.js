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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const brainTool_js_1 = require("./brainTool.js");
const filesystemBackend_js_1 = require("./filesystemBackend.js");
const hookInstaller_js_1 = require("./hookInstaller.js");
let activeBrainTool;
function activate(context) {
    console.log('[ObsidianBrain] Extension activating...');
    // Register Brain Tool and initialize indexer
    const brainTool = new brainTool_js_1.BrainTool(context);
    activeBrainTool = brainTool;
    context.subscriptions.push(vscode.lm.registerTool('obsidian_brain', brainTool), brainTool);
    console.log('[ObsidianBrain] Registered obsidian_brain tool');
    // Install the brain-usage enforcement hook into the user-level Copilot
    // folders so it travels with the extension to every workspace and machine.
    void (0, hookInstaller_js_1.installAgentHooks)(context, { vaultPath: safeVaultPath() }).then(report => {
        if (report.installed) {
            console.log(`[ObsidianBrain] Agent hooks ready in ${report.hooksDir} (${report.written.length} written, ${report.skipped.length} user-owned)`);
        }
        else {
            console.log(`[ObsidianBrain] Agent hooks not installed: ${report.reason}`);
        }
    });
    // Initialize the brain indexer in background (don't block activation)
    brainTool.initialize().then(() => {
        console.log('[ObsidianBrain] Vault indexer initialized');
    }).catch(err => {
        console.error('[ObsidianBrain] Failed to initialize indexer:', err);
    });
    context.subscriptions.push(vscode.commands.registerCommand('obsidianBrain.configureVault', async () => {
        const folders = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Use Obsidian Vault' });
        if (!folders?.[0])
            return;
        const config = vscode.workspace.getConfiguration('obsidianBrain');
        const existing = config.inspect('vaultPath');
        const target = existing?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
            : existing?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
        await config.update('vaultPath', folders[0].fsPath, target);
        try {
            await brainTool.initialize();
            vscode.window.showInformationMessage(`✅ Obsidian vault configured: ${folders[0].fsPath}`);
        }
        catch (error) {
            vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
        }
    }));
    // Command: Check the configured vault through the native I/O backend.
    context.subscriptions.push(vscode.commands.registerCommand('obsidianBrain.checkConnection', async () => {
        const isConnected = await brainTool.checkConnection();
        if (isConnected) {
            vscode.window.showInformationMessage('✅ Obsidian vault is accessible and ready!');
        }
        else {
            const selection = await vscode.window.showWarningMessage('⚠️ Obsidian vault is not accessible. Check the configured vault path.', 'Open Settings');
            if (selection === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'obsidianBrain.vaultPath');
            }
        }
    }));
    // Command: Open Obsidian Vault
    context.subscriptions.push(vscode.commands.registerCommand('obsidianBrain.openVault', async () => {
        let vaultPath;
        try {
            vaultPath = (0, filesystemBackend_js_1.configuredVaultPath)();
        }
        catch (error) {
            vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
            return;
        }
        const uri = vscode.Uri.file(vaultPath);
        try {
            // Check if vault exists
            await vscode.workspace.fs.stat(uri);
            // Open in new window or add to workspace
            const selection = await vscode.window.showQuickPick([
                { label: 'Open in New Window', action: 'new' },
                { label: 'Add to Workspace', action: 'add' },
                { label: 'Open in Explorer', action: 'explorer' }
            ], { placeHolder: 'How would you like to open the vault?' });
            if (selection) {
                switch (selection.action) {
                    case 'new':
                        vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
                        break;
                    case 'add':
                        vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length || 0, 0, { uri, name: 'Obsidian Vault' });
                        break;
                    case 'explorer':
                        vscode.commands.executeCommand('revealFileInOS', uri);
                        break;
                }
            }
        }
        catch {
            const createVault = await vscode.window.showWarningMessage(`Vault not found at: ${vaultPath}`, 'Create Vault', 'Configure Path');
            if (createVault === 'Create Vault') {
                await vscode.workspace.fs.createDirectory(uri);
                // Create default structure
                const dirs = ['Engineering', 'Playbooks', 'Decisions', 'Snippets'];
                for (const dir of dirs) {
                    await vscode.workspace.fs.createDirectory(vscode.Uri.file(`${vaultPath}/${dir}`));
                }
                vscode.window.showInformationMessage(`✅ Created vault at: ${vaultPath}`);
            }
            else if (createVault === 'Configure Path') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'obsidianBrain.vaultPath');
            }
        }
    }));
    // Command: Rebuild Brain Index
    context.subscriptions.push(vscode.commands.registerCommand('obsidianBrain.rebuildIndex', async () => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Rebuilding brain index...',
            cancellable: false
        }, async () => {
            await brainTool.rebuildIndex();
            vscode.window.showInformationMessage('✅ Brain index rebuilt successfully');
        });
    }));
    console.log('[ObsidianBrain] Extension activated successfully!');
}
/** Vault path for the hook env var; blank when unset or invalid. */
function safeVaultPath() {
    try {
        return (0, filesystemBackend_js_1.configuredVaultPath)();
    }
    catch {
        return undefined;
    }
}
async function deactivate() {
    await activeBrainTool?.dispose();
    activeBrainTool = undefined;
    console.log('[ObsidianBrain] Extension deactivated');
}
//# sourceMappingURL=extension.js.map