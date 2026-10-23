'use strict';
// Real compiled BrainTool, same 50-note corpus in independent disposable vaults.
// Benchmark v2.15.1's per-save activity-log indexing against 2.15.2's hidden ledger.
const {performance} = require('node:perf_hooks');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {setVault,runtime} = require('../test/vscode-shim.cjs');
const {BrainTool} = require(runtime + '/brainTool.js');

const marker = '- 2026-10-23T01:00:00.000Z append ';
const median = samples => {
    const sorted = [...samples].sort((a,b)=>a-b);
    return (sorted[Math.floor((sorted.length-1)/2)] + sorted[Math.floor(sorted.length/2)]) / 2;
};
const ms = value => value.toFixed(3) + ' ms';
async function run(legacy) {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-append-benchmark-'));
    setVault(vault);
    const directory = path.join(vault,'Bench');
    await fs.mkdir(directory, {recursive:true});
    for (let n=0;n<50;n++) await fs.writeFile(path.join(directory, n+'.md'), '# Example\nstablebody');
    const brain = new BrainTool({subscriptions:[]});
    const timings = [], saveMarkerDurations = [];
    try {
        await brain.initialize();
        if (legacy) {
            // Reconstruct 2.15.1's recordSave logic, retaining the real compiled
            // BrainTool invoke/write/indexer path and actual FS + search cache.
            brain.recordSave = async (operation, filepath) => {
                brain.saveCount++;
                const activity = new Date().toISOString() + ' ' + operation + ' ' + filepath.replace(/[\r\n]/g,' ');
                brain.saveActivity.push(activity);
                brain.saveActivity = brain.saveActivity.slice(-20);
                const checkpoint = brain.saveCount % 3 === 0
                    ? '\n\n## '+new Date().toISOString()+' — Checkpoint\n\nSave count: '+brain.saveCount+
                      '\n\nRecent save activity (up to 20):\n'+brain.saveActivity.map(a=>'- '+a).join('\n')+'\n'
                    : '';
                brain.checkpointWrite = brain.checkpointWrite.then(async()=>{
                    const logPath = '_Inbox/session-activity-log.md';
                    await brain.filesystemBackend.appendFile(logPath,'- '+activity+checkpoint);
                    await brain.indexer.indexFileImmediately(logPath);
                });
                await brain.checkpointWrite;
            };
        } else {
            const original = brain.filesystemBackend.appendSaveMarker.bind(brain.filesystemBackend);
            brain.filesystemBackend.appendSaveMarker = async (...args) => {
                const start = performance.now();
                try {return await original(...args);}
                finally {saveMarkerDurations.push(performance.now()-start);}
            };
        }
        for(let n=0;n<300;n++) {
            const start = performance.now();
            const result = (await brain.invoke({input:{operation:'append',filepath:'Bench/'+(n%50)+'.md',content:'append'}},{})).content.map(p=>p.value).join('');
            assert(result.includes('Successfully appended'),result);
            timings.push(performance.now()-start);
        }
        assert.equal(brain.saveCount,300);
        const summary = await fs.readFile(path.join(vault,'_Inbox/session-activity-log.md'),'utf8');
        const checkpoints = (summary.match(/^## .* — Checkpoint$/gm)||[]).length;
        assert.equal(checkpoints,100,'every third save writes one summary');
        if (!legacy) {
            const standalone = summary.split('\n').filter(l=>/^-\s+\d{4}-\d\d-\d\dT.* append Bench\//.test(l));
            // Historical entries inside each checkpoint's "Recent save activity"
            // remain intended; standalone lines outside checkpoints must not exist.
            assert.equal(standalone.length,1970,'100 rolling windows: 1+2+3+... capped at 20');
        }
        if (!legacy) {
            const ledger=(await fs.readFile(path.join(vault,'.obsidian-brain/saves.log'),'utf8')).trim().split('\n');
            assert.equal(ledger.length,300);
            assert(ledger.every(l=>l.startsWith('- ') && l.includes(' append Bench/')));
            assert(!brain.indexer.getFileInfo('.obsidian-brain/saves.log'));
            const search=await brain.indexer.search('append',100);
            assert(!search.some(hit=>hit.filepath==='_Inbox/session-activity-log.md'));
        }
        return {timings, saveMarkerDurations};
    } finally {
        await brain.dispose();
        await fs.rm(vault,{recursive:true,force:true});
    }
}
(async()=>{
    const before = await run(true);
    const after = await run(false);
    const first=median(after.timings.slice(0,50));
    const last=median(after.timings.slice(-50));
    const ratio=last/Math.max(first,0.000001);
    const firstMarker=median(after.saveMarkerDurations.slice(0,50));
    const lastMarker=median(after.saveMarkerDurations.slice(-50));
    const markerRatio=lastMarker/Math.max(firstMarker,0.000001);
    console.log('Real BrainTool 300-append benchmark (same 50-note corpus; Node '+process.version+')');
    console.log('2.15.1 median first/last 50: '+ms(median(before.timings.slice(0,50)))+' / '+ms(median(before.timings.slice(-50))));
    console.log('2.15.2 median first/last 50: '+ms(first)+' / '+ms(last)+'; ratio '+ratio.toFixed(3)+'x');
    console.log('2.15.2 save-ledger write first/last 50: '+ms(firstMarker)+' / '+ms(lastMarker)+'; ratio '+markerRatio.toFixed(3)+'x');
    console.log('Entire 300 append totals 2.15.1 / 2.15.2: '+ms(before.timings.reduce((a,b)=>a+b,0))+' / '+ms(after.timings.reduce((a,b)=>a+b,0)));
    assert(ratio<=1.5,'last 50 full appends regressed by more than 1.5x');
    assert(markerRatio<=1.5,'last 50 private marker appends regressed by more than 1.5x');
})().catch(error=>{console.error(error);process.exitCode=1;});
