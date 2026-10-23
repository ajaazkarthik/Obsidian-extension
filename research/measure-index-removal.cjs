'use strict';
// Exercises the actual compiled VaultIndexer and its removeFileImmediately()
// against 1,000 disposable Markdown notes. Baseline reproduces the previous
// O(vocabulary) removeFromIndex implementation from the 2.15.0 Git revision;
// both paths use identical vault documents and the same indexer public method.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {performance} = require('node:perf_hooks');
const {setVault,runtime} = require('../test/vscode-shim.cjs');
const {VaultIndexer} = require(runtime + '/vaultIndexer.js');

function installLegacyRemoval(indexer) {
    indexer.removeFromIndex = function (filepath) {
        if (!this.index) return;
        filepath = filepath.replace(/\\/g,'/').replace(/^\//,'');
        const existing = this.index.files.get(filepath);
        if (!existing) return;
        for (const tag of existing.tags) {
            const lower = tag.toLowerCase();
            this.index.tagIndex.get(lower)?.delete(filepath);
            if (this.index.tagIndex.get(lower)?.size === 0) this.index.tagIndex.delete(lower);
        }
        // This is the exact old performance bottleneck: visit EVERY term.
        for (const [word, postings] of this.index.wordIndex) {
            postings.delete(filepath);
            if (postings.size === 0) this.index.wordIndex.delete(word);
        }
        this.index.files.delete(filepath);
    };
}

(async()=>{
    const vault = await fs.mkdtemp(path.join(os.tmpdir(),'obsidian-brain-benchmark-'));
    setVault(vault);
    let before, after;
    try {
        const count = 1000;
        await fs.mkdir(path.join(vault,'Notes'),{recursive:true});
        // Each note has a stable shared term and unique, deterministic vocabulary.
        const words = n => Array.from({length:15},(_,j) => {
            const value=n*15+j;
            return 'benchmark'+String.fromCharCode(97+value%26,97+Math.floor(value/26)%26,97+Math.floor(value/676)%26,97+Math.floor(value/17576)%26);
        }).join(' ');
        for(let offset=0;offset<count;offset+=50){
            await Promise.all(Array.from({length:Math.min(50,count-offset)},(_,i)=>{
                const n=offset+i;
                return fs.writeFile(path.join(vault,'Notes',n+'.md'), '# Sample '+n+'\n#benchmark\ncommonbodymarker '+words(n));
            }));
        }
        before = new VaultIndexer();
        await before.initialize();
        after = new VaultIndexer();
        await after.initialize();
        assert.equal(before.getStats().fileCount,count);
        assert.equal(after.getStats().fileCount,count);
        assert(before.index.wordIndex.size>=14000,'corpus must contain substantial vocabulary');
        installLegacyRemoval(before);
        const remove = (indexer, start, end) => {
            const t = performance.now();
            for(let n=start;n<end;n++)indexer.removeFileImmediately('Notes/'+n+'.md');
            return performance.now()-t;
        };
        // Warm both code paths without timing.
        remove(before,0,10);remove(after,0,10);
        const previousMs=remove(before,10,110);
        const currentMs=remove(after,10,110);
        assert.equal(before.index.files.size,after.index.files.size);
        assert.equal(before.index.wordIndex.size,after.index.wordIndex.size);
        assert.deepEqual([...before.index.wordIndex.keys()].sort(),[...after.index.wordIndex.keys()].sort());
        const all = [...before.index.wordIndex].map(([term,postings])=>[term,[...postings]]).sort((a,b)=>a[0].localeCompare(b[0]));
        const modern = [...after.index.wordIndex].map(([term,postings])=>[term,[...postings]]).sort((a,b)=>a[0].localeCompare(b[0]));
        assert.deepEqual(all,modern,'both index removal implementations must retain identical postings');
        console.log('VaultIndexer measured 1,000-note benchmark (same corpus, Node '+process.version+')');
        console.log('Notes removed: 100 (+10 warmup), initial body terms: '+(all.length+110*16)+' approximately');
        console.log('Original removeFileImmediately: '+previousMs.toFixed(2)+' ms');
        console.log('Reverse-map removeFileImmediately: '+currentMs.toFixed(2)+' ms');
        console.log('Measured speed ratio: '+(previousMs/currentMs).toFixed(2)+'x (environment-dependent)');
    } finally {
        if(before)await before.dispose();
        if(after)await after.dispose();
        await fs.rm(vault,{recursive:true,force:true});
    }
})().catch(err=>{console.error(err);process.exitCode=1;});
