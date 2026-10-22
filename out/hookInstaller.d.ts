import * as vscode from 'vscode';
/**
 * Installs the brain-usage enforcement hook into the user-level Copilot
 * customization folders (`~/.copilot/hooks`, `~/.copilot/instructions`).
 *
 * Why the extension writes these files instead of shipping them declaratively:
 * VS Code has no `contributes.hooks` contribution point, so an extension cannot
 * declare hooks in `package.json`. Writing them at activation is the only way to
 * make enforcement travel with the extension to every workspace and machine.
 *
 * Every file this module owns carries MANAGED_MARKER. A file without the marker
 * is treated as user-authored and is never overwritten.
 */
export declare const MANAGED_MARKER = "obsidian-brain-managed";
export interface InstallReport {
    installed: boolean;
    reason?: string;
    hooksDir: string;
    written: string[];
    skipped: string[];
    removed: string[];
}
export interface InstallOptions {
    homeDir?: string;
    vaultPath?: string;
}
export declare function copilotHooksDir(homeDir: string): string;
export declare function copilotInstructionsDir(homeDir: string): string;
/** Insert the ownership marker directly after the shebang so Python still parses it. */
export declare function withMarker(source: string): string;
export declare function isManaged(content: string): boolean;
export declare function buildHookConfig(scriptPath: string, vaultPath?: string): Record<string, unknown>;
/**
 * Write the guard script, hook config and instruction into the user-level
 * Copilot folders. Idempotent, non-destructive, and never throws: a failure
 * here must not block extension activation.
 */
export declare function installAgentHooks(context: vscode.ExtensionContext, options?: InstallOptions): Promise<InstallReport>;
