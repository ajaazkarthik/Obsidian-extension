const {setVault,runtime} = require('./vscode-shim.cjs');
const {VaultIndexer} = require(runtime+'/vaultIndexer.js');
const {BrainTool} = require(runtime+'/brainTool.js');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async()=>{
 const vault=await fs.mkdtemp(path.join(os.tmpdir(),'obsidian-brain-baseline-'));setVault(vault);
 const instances=[];
 try {
  for(let i=0;i<25;i++) await fs.writeFile(path.join(vault,`note${i}.md`), '# Neutral\n\nquasarbodymarker running #facade\n```\n#code-example\n```');
  const idx=new VaultIndexer();instances.push(idx);await idx.initialize();
  assert(idx.index.wordIndex.has('quasarbodymarker'));
  const warm=new VaultIndexer();instances.push(warm);await warm.initialize();
  assert.equal(warm.index.wordIndex.size,0);console.log('CONFIRMED: warm cache loses body postings');
  await fs.writeFile(path.join(vault,'note0.md'),'# Neutral\nreplacementmarker');await idx.indexFileImmediately('note0.md');
  assert(idx.index.wordIndex.get('quasarbodymarker').has('note0.md'));console.log('CONFIRMED: edit retains stale body posting');
  assert(idx.extractTags('```\n#code-example\n```').includes('code-example'));console.log('CONFIRMED: fenced hashtags become tags');
  assert.notEqual(idx.tokenize('running')[0],idx.tokenize('runs')[0]);console.log('CONFIRMED: suffix variants do not agree');
  const brain=new BrainTool({subscriptions:[]});instances.push(brain.indexer);await brain.initialize();
  const out=(await brain.invoke({input:{operation:'search',query:'quasarbodymarker',limit:1}},{})).content[0].value;
  assert.equal((out.match(/^## /gm)||[]).length,15);console.log('CONFIRMED: search limit=1 displays 15 hits');
 } finally {for(const i of instances) await i.dispose();await fs.rm(vault,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
