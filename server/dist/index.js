#!/usr/bin/env node
'use strict';

// MCP stdio is line-delimited JSON-RPC 2.0, never human-readable stdout.
console.log = (...values) => console.error(...values);
console.info = (...values) => console.error(...values);
const readline = require('node:readline');
const Module = require('node:module');
const originalLoad = Module._load;
const shim = require('./vscode-shim.js');
Module._load = function (request, ...rest) {
    return request === 'vscode' ? shim : originalLoad.call(this, request, ...rest);
};
const {BrainTool} = require('../../out/brainTool.js');
const manifest = require('../../package.json');
const description = manifest.contributes.languageModelTools[0];
const brain = new BrainTool({subscriptions: []});
const write = response => process.stdout.write(JSON.stringify(response) + '\n');
const error = (code, message) => ({code, message});

async function dispatch(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message) ||
        message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
        return {jsonrpc: '2.0', id: message?.id ?? null, error: error(-32600, 'Invalid Request')};
    }
    if (!Object.hasOwn(message, 'id')) return null; // MCP notifications have no responses.
    const id = message.id;
    try {
        let result;
        switch (message.method) {
            case 'initialize':
                result = {
                    protocolVersion: '2024-11-05',
                    capabilities: {tools: {}},
                    serverInfo: {name: 'obsidian-brain', version: manifest.version}
                };
                break;
            case 'ping':
                result = {};
                break;
            case 'tools/list':
                result = {tools: [{
                    name: description.name,
                    description: description.modelDescription,
                    inputSchema: description.inputSchema
                }]};
                break;
            case 'tools/call': {
                const params = message.params || {};
                if (params.name !== description.name || !params.arguments ||
                    typeof params.arguments !== 'object' || Array.isArray(params.arguments)) {
                    return {jsonrpc: '2.0', id, error: error(-32602, 'Invalid tool name or arguments')};
                }
                if (!process.env.OBSIDIAN_VAULT_PATH) {
                    throw new Error('Set OBSIDIAN_VAULT_PATH to an existing disposable or user-selected vault.');
                }
                const output = await brain.invoke({input: params.arguments}, {});
                const content = output.content.map(item => ({type: 'text', text: String(item.value)}));
                result = {content, isError: content.some(item => item.text.includes('❌ Error:'))};
                break;
            }
            default:
                return {jsonrpc: '2.0', id, error: error(-32601, 'Method not found')};
        }
        return {jsonrpc: '2.0', id, result};
    } catch (cause) {
        console.error('[obsidian-brain MCP]', cause);
        return {jsonrpc: '2.0', id, error: error(-32603, cause instanceof Error ? cause.message : String(cause))};
    }
}

async function main() {
    const input = readline.createInterface({input: process.stdin, crlfDelay: Infinity});
    for await (const line of input) {
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); }
        catch { write({jsonrpc: '2.0', id: null, error: error(-32700, 'Parse error')}); continue; }
        const response = await dispatch(message);
        if (response) write(response);
    }
    await brain.dispose();
}
main().catch(cause => { console.error(cause); process.exitCode = 1; });
