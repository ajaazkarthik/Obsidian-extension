'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const disposable = () => ({dispose() {}});
const FileType = {File: 1, Directory: 2};
const uri = fsPath => ({fsPath});

module.exports = {
    Uri: {file: uri},
    FileType,
    RelativePattern: class RelativePattern {
        constructor(base, pattern) { this.base = base; this.pattern = pattern; }
    },
    LanguageModelToolResult: class LanguageModelToolResult {
        constructor(content) { this.content = content; }
    },
    LanguageModelTextPart: class LanguageModelTextPart {
        constructor(value) { this.value = value; }
    },
    workspace: {
        getConfiguration: () => ({
            get: key => key === 'vaultPath' ? (process.env.OBSIDIAN_VAULT_PATH || '') : undefined
        }),
        fs: {
            readFile: target => fs.readFile(target.fsPath),
            writeFile: (target, bytes) => fs.writeFile(target.fsPath, bytes),
            createDirectory: target => fs.mkdir(target.fsPath, {recursive: true}),
            readDirectory: async target => (await fs.readdir(target.fsPath, {withFileTypes: true}))
                .map(entry => [entry.name, entry.isDirectory() ? FileType.Directory : FileType.File]),
            stat: async target => {
                const value = await fs.stat(target.fsPath);
                return {mtime: value.mtimeMs, size: value.size, type: value.isDirectory() ? FileType.Directory : FileType.File};
            },
            delete: (target, options) => fs.rm(target.fsPath, {recursive: !!options?.recursive, force: false}),
            rename: (from, to) => fs.rename(from.fsPath, to.fsPath)
        },
        createFileSystemWatcher: () => ({
            onDidCreate: () => disposable(),
            onDidChange: () => disposable(),
            onDidDelete: () => disposable(),
            dispose() {}
        })
    }
};
