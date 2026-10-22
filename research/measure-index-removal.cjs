'use strict';
// Reproducible algorithm-level benchmark. Not a claim about production vault latency.
const {performance} = require('node:perf_hooks');
const TOTAL_TERMS = 25000, FILE_TERMS = 8, ITERATIONS = 200;
const postings = new Map();
const targetTerms = new Set();
for (let i=0; i<TOTAL_TERMS; i++) {
    const term = 'term' + String(i).padStart(5,'0');
    const containsTarget = i < FILE_TERMS;
    postings.set(term, new Map(containsTarget ? [['large.md',1],['target.md',1]] : [['large.md',1]]));
    if (containsTarget) targetTerms.add(term);
}
let visitsBefore = 0, visitsAfter = 0, sink = 0;
const old = () => {
    for (const [, files] of postings) {
        visitsBefore++;
        if (files.has('target.md')) sink++;
    }
};
const optimized = () => {
    for (const term of targetTerms) {
        visitsAfter++;
        if (postings.get(term)?.has('target.md')) sink++;
    }
};
// Warm up both loops before measuring. Lookups are read-only so iterations are comparable.
for (let n=0;n<30;n++){old();optimized();}
visitsBefore=visitsAfter=0;
const beforeStart=performance.now();
for(let n=0;n<ITERATIONS;n++)old();
const beforeMs=performance.now()-beforeStart;
const afterStart=performance.now();
for(let n=0;n<ITERATIONS;n++)optimized();
const afterMs=performance.now()-afterStart;
if(visitsBefore!==TOTAL_TERMS*ITERATIONS || visitsAfter!==FILE_TERMS*ITERATIONS)throw Error('Unexpected traversal count');
console.log('Index removal algorithm-level benchmark (Node '+process.version+')');
console.log('Vocabulary: '+TOTAL_TERMS+' terms; target: '+FILE_TERMS+' terms; iterations: '+ITERATIONS);
console.log('Before full scan: '+visitsBefore+' posting-list visits, '+beforeMs.toFixed(2)+' ms');
console.log('After reverse map: '+visitsAfter+' posting-list visits, '+afterMs.toFixed(2)+' ms');
console.log('Measured visit reduction: '+(visitsBefore/visitsAfter).toFixed(0)+'x; timings are environment-specific');
void sink;
