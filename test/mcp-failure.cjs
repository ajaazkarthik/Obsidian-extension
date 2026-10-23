'use strict';
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const harness = path.join(__dirname, 'mcp.cjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-brain-mcp-failure-'));
try {
    const silent = path.join(home, 'silent.cjs');
    fs.writeFileSync(silent, "process.stdin.resume();\n");
    const missing = path.join(home, 'absent.cjs');
    for (const [name, server] of [['never responds', silent], ['child exits before initialize', missing]]) {
        const result = spawnSync(process.execPath, [harness], {
            env: {...process.env, BRAIN_MCP_SERVER: server, BRAIN_MCP_TIMEOUT_MS: '800'},
            encoding: 'utf8', timeout: 10000
        });
        assert.notEqual(result.status, 0, name + ' returned exit 0');
        assert(result.stderr.includes('MCP TEST FAILED:'),name + ' did not print failure: ' + result.stderr);
        assert(/timed out|before handshake|exited|spawn error/.test(result.stderr), name+' lacks cause');
        console.log('PASS MCP failure test: '+name+' -> nonzero status and diagnostic');
    }
} finally {
    fs.rmSync(home,{recursive:true,force:true});
}
