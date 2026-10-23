'use strict';
// Benchmark the real compiled BrainTool on identical disposable 50-note corpora.
// Reconstruct 2.15.1's recordSave path inside the current code so the only
// intentional difference is the per-save logging/indexing implementation.
const {performance} = require('node:perf_hooks');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {setVault,runtime} = require('../test/vscode-shim.cjs');
const {BrainTool} = require(runtime + '/brainTool.js');

const NOTES = 50, WARMUP = 20, APPENDS = 300, TRIALS = 3, WINDOW = 50;
const median = samples => {
    assert(samples.length > 0, 'Cannot take the median of an empty sample');
    const sorted = [...samples].sort((a,b)=>a-b);
    return (sorted[Math.floor((sorted.length-1)/2)] + sorted[Math.floor(sorted.length/2)]) / 2;
};
const ms = value => value.toFixed(3) + ' ms';
const total = samples => samples.reduce((sum, value)=>sum+value, 0);
const ratio = (a,b) => a / Math.max(b, Number.EPSILON);

async function run(legacy, trial) {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(),'brain-save-latency-'));
    setVault(vault);
    const directory = path.join(vault,'Bench');
    await fs.mkdir(directory,{recursive:true});
    for (let n=0;n<NOTES;n++) await fs.writeFile(path.join(directory,n+'.md'),'# Example\nstablebody');
    const brain = new BrainTool({subscriptions:[]});
    const timings = [], saveMarkerDurations = [];
    try {
        await brain.initialize();
        if (legacy) {
            // Reproduce 2.15.1's original per-save Markdown write AND index.
            brain.recordSave = async (operation,filepath) => {
                brain.saveCount++;
                const activity = new Date().toISOString()+' '+operation+' '+filepath.replace(/[\r\n]/g,' ');
                brain.saveActivity.push(activity);
                brain.saveActivity = brain.saveActivity.slice(-20);
                const checkpoint = brain.saveCount % 3 === 0
                    ? '\n\n## '+new Date().toISOString()+' — Checkpoint\n\nSave count: '+brain.saveCount+
                      '\n\nRecent save activity (up to 20):\n'+brain.saveActivity.map(a=>'- '+a).join('\n')+'\n'
                    : '';
                brain.checkpointWrite = brain.checkpointWrite.then(async()=>{
                    const logPath='_Inbox/session-activity-log.md';
                    await brain.filesystemBackend.appendFile(logPath,'- '+activity+checkpoint);
                    await brain.indexer.indexFileImmediately(logPath);
                });
                await brain.checkpointWrite;
            };
        } else {
            const appendMarker=brain.filesystemBackend.appendSaveMarker.bind(brain.filesystemBackend);
            brain.filesystemBackend.appendSaveMarker=async (...args)=>{
                const start=performance.now();
                try {return await appendMarker(...args);}
                finally {saveMarkerDurations.push(performance.now()-start);}
            };
        }
        const append=async n=>{
            const output = (await brain.invoke({
                input:{operation:'append',filepath:'Bench/'+(n%NOTES)+'.md',content:'append'}
            },{})).content.map(part=>part.value).join('');
            assert(output.includes('Successfully appended'),output);
        };
        // Warmup is never included in the timed first/last 50 samples.
        for (let n=0;n<WARMUP;n++) await append(n);
        saveMarkerDurations.length=0;
        for (let n=0;n<APPENDS;n++) {
            const start=performance.now();
            await append(n);
            timings.push(performance.now()-start);
        }
        assert.equal(brain.saveCount,WARMUP+APPENDS,'warmups must use real append operations');
        const summary=await fs.readFile(path.join(vault,'_Inbox/session-activity-log.md'),'utf8');
        const checkpoints=(summary.match(/^## .* — Checkpoint$/gm)||[]).length;
        assert.equal(checkpoints,Math.floor((WARMUP+APPENDS)/3),'checkpoint cadence must not change');
        if (!legacy) {
            let inActivityList=false, standalone=0;
            for (const line of summary.split('\n')) {
                if (line.startsWith('## ')) inActivityList=false;
                if (line.startsWith('Recent save activity (up to 20):')) inActivityList=true;
                if (!inActivityList && /^-\s+\d{4}-\d\d-\d\dT.* append Bench\//.test(line)) standalone++;
            }
            assert.equal(standalone,0,'no per-save rows outside checkpoints');
            const ledger=(await fs.readFile(path.join(vault,'.obsidian-brain/saves.log'),'utf8')).trim().split('\n');
            assert.equal(ledger.length,WARMUP+APPENDS);
            assert(ledger.every(l=>l.startsWith('- ')&&l.includes(' append Bench/')));
            assert(!brain.indexer.getFileInfo('.obsidian-brain/saves.log'));
            const found=await brain.indexer.search('append',100);
            assert(!found.some(hit=>hit.filepath==='_Inbox/session-activity-log.md'));
        }
        return {
            trial, variant:legacy?'2.15.1':'2.15.3',
            first:median(timings.slice(0,WINDOW)),
            last:median(timings.slice(-WINDOW)),
            total:total(timings),
            markerFirst:legacy?null:median(saveMarkerDurations.slice(0,WINDOW)),
            markerLast:legacy?null:median(saveMarkerDurations.slice(-WINDOW)),
        };
    } finally {
        await brain.dispose();
        await fs.rm(vault,{recursive:true,force:true});
    }
}

(async()=>{
    const oldRuns=[],newRuns=[];
    // Interleave to reduce drift from load, JIT and runner temperature.
    // Each run gets an independent copy of the SAME 50-note seed corpus.
    for(let trial=1;trial<=TRIALS;trial++){
        oldRuns.push(await run(true,trial));
        newRuns.push(await run(false,trial));
    }
    const aggregate = runs => ({
        first:median(runs.map(r=>r.first)),
        last:median(runs.map(r=>r.last)),
        total:median(runs.map(r=>r.total)),
        markerFirst:runs[0].markerFirst===null?null:median(runs.map(r=>r.markerFirst)),
        markerLast:runs[0].markerLast===null?null:median(runs.map(r=>r.markerLast))
    });
    const old=aggregate(oldRuns),current=aggregate(newRuns);
    console.log('Real compiled BrainTool 300-append benchmark; '+TRIALS+' interleaved pairs; '+NOTES+' notes; '+WARMUP+' untimed warmups per run; Node '+process.version);
    for(let trial=0;trial<TRIALS;trial++){
        for(const result of [oldRuns[trial],newRuns[trial]]){
            console.log('Trial '+result.trial+' '+result.variant+': first50 '+ms(result.first)+
                ', last50 '+ms(result.last)+', total300 '+ms(result.total)+
                ', growth '+ratio(result.last,result.first).toFixed(3)+'x');
        }
    }
    console.log('Median-of-three 2.15.1: first50 '+ms(old.first)+', last50 '+ms(old.last)+', total300 '+ms(old.total)+', growth '+ratio(old.last,old.first).toFixed(3)+'x');
    console.log('Median-of-three 2.15.3: first50 '+ms(current.first)+', last50 '+ms(current.last)+', total300 '+ms(current.total)+', growth '+ratio(current.last,current.first).toFixed(3)+'x');
    console.log('Save-ledger append report only: first50 '+ms(current.markerFirst)+
        ', last50 '+ms(current.markerLast)+', growth '+ratio(current.markerLast,current.markerFirst).toFixed(3)+'x');
    console.log('Release gate: new last50 '+ms(current.last)+' vs reconstructed 2.15.1 last50 '+ms(old.last)+
        ' (new/old '+ratio(current.last,old.last).toFixed(3)+'x)');

    // Sanity check: the reconstructed baseline must still exhibit the
    // historical growth problem. A broken baseline invalidates comparison.
    assert(ratio(old.last,old.first)>=1.5,
        'INVALID BASELINE: 2.15.1 reconstruction no longer exhibits >=1.5x last50/first50 growth; comparison is meaningless');
    // Sole performance gate: compare old and new directly, not noisy
    // sub-2ms first/last ratios within the new implementation.
    assert(current.last < old.last,
        'REGRESSION: 2.15.3 median last50 must be strictly below 2.15.1 median last50');
    console.log('PASS: baseline valid and 2.15.3 last50 faster than reconstructed 2.15.1');
})().catch(error=>{console.error(error);process.exitCode=1;});
