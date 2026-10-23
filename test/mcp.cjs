'use strict';
const {spawn} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

(async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-brain-mcp-'));
    const server = process.env.BRAIN_MCP_SERVER || path.resolve(__dirname, '../server/dist/index.js');
    const timeoutMs = Number(process.env.BRAIN_MCP_TIMEOUT_MS || 20000);
    const child = spawn(process.execPath, [server], {
        env: {...process.env, OBSIDIAN_VAULT_PATH: vault},
        stdio: ['pipe', 'pipe', 'pipe']
    });
    const pending = new Map();
    let nextId = 0, buffer = '', stderr = '', protocolError;
    let finished = false, handshakeComplete = false;
    let fail;
    const failPending = cause => {
        protocolError ||= cause;
        for (const entry of pending.values()) entry.reject(cause);
        pending.clear();
    };
    const exited = new Promise(resolve => child.once('close', (code, signal) => {
        finished = true;
        const reason = new Error('MCP child exited ' + (signal || code) +
            (handshakeComplete ? '' : ' before handshake') + (stderr ? '\n'+stderr.slice(-2000) : ''));
        if (!handshakeComplete || pending.size) failPending(reason);
        resolve({code, signal});
    }));
    child.once('error', cause => {
        failPending(new Error('MCP spawn error: '+cause.message));
    });
    child.stderr.on('data', data => {stderr += data.toString();});
    child.stdout.on('data', data => {
        buffer += data.toString();
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            let message;
            try { message = JSON.parse(line); }
            catch (cause) {failPending(new Error('Non-JSON stdout: '+line.slice(0,120))); continue;}
            const entry = pending.get(message.id);
            if (!entry) {failPending(new Error('Unsolicited stdout JSON-RPC message')); continue;}
            pending.delete(message.id);
            entry.resolve(message);
        }
    });
    const request = (method, params) => new Promise((resolve, reject) => {
        if (finished || protocolError) {reject(protocolError || new Error('MCP child already exited')); return;}
        const id = ++nextId;
        pending.set(id, {resolve, reject});
        child.stdin.write(JSON.stringify({jsonrpc:'2.0', id, method, params}) + '\n', cause => {
            if (cause) failPending(new Error('MCP stdin write failed: '+cause.message));
        });
    });
    const timeout = setTimeout(() => {
        failPending(new Error('MCP handshake/request timed out after '+timeoutMs+' ms'));
        child.kill();
    }, timeoutMs);
    try {
        const init = await request('initialize', {protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'test',version:'1'}});
        assert.equal(init.jsonrpc, '2.0');
        assert.equal(init.result.serverInfo.name, 'obsidian-brain');
        assert.equal(init.result.protocolVersion, '2024-11-05');
        handshakeComplete = true;
        child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}) + '\n');
        const listed = await request('tools/list');
        assert.deepEqual(listed.result.tools.map(tool => tool.name), ['obsidian_brain']);
        assert(listed.result.tools[0].inputSchema.properties.max_chars);
        const wrote = await request('tools/call', {name:'obsidian_brain',arguments:{operation:'write',filepath:'Mcp/probe.md',content:'# MCP\nmcpprobemarker'}});
        assert.equal(wrote.result.isError,false);
        assert(wrote.result.content[0].text.includes('Successfully wrote'));
        assert.equal(await fs.readFile(path.join(vault,'Mcp/probe.md'),'utf8'),'# MCP\nmcpprobemarker');
        const found = await request('tools/call', {name:'obsidian_brain',arguments:{operation:'search',query:'mcpprobemarker'}});
        assert.equal(found.result.isError,false);
        assert(found.result.content[0].text.includes('Mcp/probe.md'));
        const failedTool = await request('tools/call', {name:'obsidian_brain',arguments:{operation:'read',filepath:'Mcp/no-such-file.md'}});
        assert.equal(failedTool.result.isError,true);
        const invalid = await request('tools/call', {name:'wrong',arguments:{operation:'search',query:'x'}});
        assert.equal(invalid.error.code,-32602);
        const unknown = await request('invalid/method');
        assert.equal(unknown.error.code,-32601);
        assert.ifError(protocolError);
        assert.equal(pending.size,0);
        child.stdin.end();
        const exit = await exited;
        assert.equal(exit.code,0,'MCP exited nonzero; stderr: '+stderr.slice(-1000));
        console.log('PASS MCP stdio initialize/list/call and tool errors, disposable-vault search/write, protocol-only stdout');
    } finally {
        clearTimeout(timeout);
        if (!finished) child.kill();
        await fs.rm(vault, {recursive:true,force:true});
    }
})().catch(cause => {console.error('MCP TEST FAILED:', cause);process.exitCode=1;});
