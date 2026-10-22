'use strict';
const {spawn} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

(async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-brain-mcp-'));
    const server = process.env.BRAIN_MCP_SERVER || path.resolve(__dirname, '../server/dist/index.js');
    const child = spawn(process.execPath, [server], {
        env: {...process.env, OBSIDIAN_VAULT_PATH: vault},
        stdio: ['pipe', 'pipe', 'pipe']
    });
    const pending = new Map();
    let nextId = 0, buffer = '', stderr = '', protocolError;
    child.stderr.on('data', data => {stderr += data.toString();});
    child.stdout.on('data', data => {
        buffer += data.toString();
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            let message;
            try { message = JSON.parse(line); }
            catch (cause) { protocolError = cause; continue; }
            const entry = pending.get(message.id);
            if (!entry) {protocolError = new Error('Unsolicited stdout JSON-RPC message'); continue;}
            pending.delete(message.id);
            entry.resolve(message);
        }
    });
    child.on('error', cause => {
        protocolError = cause;
        for (const entry of pending.values()) entry.reject(cause);
        pending.clear();
    });
    const request = (method, params) => new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, {resolve, reject});
        child.stdin.write(JSON.stringify({jsonrpc:'2.0', id, method, params}) + '\n');
    });
    const timeout = setTimeout(() => {child.kill(); protocolError = new Error('MCP handshake timed out');}, 20000);
    try {
        const init = await request('initialize', {protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'test',version:'1'}});
        assert.equal(init.jsonrpc, '2.0');
        assert.equal(init.result.serverInfo.name, 'obsidian-brain');
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
        const invalid = await request('tools/call', {name:'wrong',arguments:{operation:'search',query:'x'}});
        assert.equal(invalid.error.code,-32602);
        const unknown = await request('invalid/method');
        assert.equal(unknown.error.code,-32601);
        assert.ifError(protocolError);
        assert.equal(pending.size,0);
        child.stdin.end();
        const code = await new Promise(resolve => child.on('close', resolve));
        assert.equal(code,0,'MCP exited nonzero; stderr: '+stderr.slice(-1000));
        console.log('PASS MCP stdio initialize/list/call, disposable vault search+write, protocol-only stdout');
    } finally {
        clearTimeout(timeout);
        child.kill();
        await fs.rm(vault, {recursive:true,force:true});
    }
})().catch(cause => {console.error(cause);process.exitCode=1;});
