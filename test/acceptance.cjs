const {shim,setVault,runtime,watchers,tools,commands} = require('./vscode-shim.cjs');
const {VaultIndexer,CACHE_VERSION} = require(runtime+'/vaultIndexer.js');
const {BrainTool} = require(runtime+'/brainTool.js');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {mock} = require('node:test');
const mode = process.argv[2] || 'all';
const {resolveVaultPath,prepareVault,normalizeNotePath}=require(runtime+'/filesystemBackend.js');
let passed=0;
async function check(name, fn) {await fn();passed++;console.log('PASS '+name);}
const instances=[];
let vault;
const note=async(p,text,ageDays=30)=>{await fs.mkdir(path.dirname(path.join(vault,p)),{recursive:true});await fs.writeFile(path.join(vault,p),text);const t=new Date(Date.now()-ageDays*86400000);await fs.utimes(path.join(vault,p),t,t);};
const newIndex=async()=>{const i=new VaultIndexer();instances.push(i);await i.initialize();return i;};
const hit=(i,q,p)=>i.search(q,100).then(r=>r.some(x=>x.filepath===p));
const snapshot=i=>JSON.stringify({files:[...i.index.files],tags:[...i.index.tagIndex].map(([k,v])=>[k,[...v]]),words:[...i.index.wordIndex].map(([k,v])=>[k,[...v]])});
const invoke=async(b,operation,args={})=>(await b.invoke({input:{operation,...args}},{})).content.map(c=>c.value).join('');
(async()=>{
 vault=await fs.mkdtemp(path.join(os.tmpdir(),'obsidian-brain-acceptance-'));setVault(vault);
 try {
  if(mode==='all'||mode==='index') {
   await note('a.md','# Neutral A\nquasarbodymarker '.repeat(1)+'quasarbodymarker '.repeat(20)+' running workers policies organizations');
   await note('b.md','# Neutral B\nquasarbodymarker runners worker policy organization');
   for(let i=0;i<30;i++)await note(`filler${i}.md`,'# Neutral\nordinary material');
   const idx=await newIndex();
   await check('cold body postings and frequency weighting',async()=>{
    assert.equal(idx.index.wordIndex.get('quasarbodymark').get('a.md'),21);
    const r=await idx.search('quasarbodymarker');assert.deepEqual(r.map(x=>x.filepath),['a.md','b.md']);assert(r[0].score>r[1].score);
   });
   await check('shared stemming, thresholds, first eligible suffix and OR',async()=>{
    assert.deepEqual(idx.tokenize('AT WORK workers working policies organizations cats'),['at','work','work','work','policy','organiz','cats']);
    assert.equal(idx.tokenize('runners')[0],'runn');assert.equal(idx.tokenize('running')[0],'runn');
    assert(!idx.index.wordIndex.has('at'));assert(await hit(idx,'working','b.md'));assert(await hit(idx,'nothingqux quasarbodymarker','a.md'));assert.equal((await idx.search('nothingqux')).length,0);
   });
   await check('compact CACHE_VERSION=3 paths, counts, round trip and ranking',async()=>{
    await idx.saveToCache();const c=JSON.parse(await fs.readFile(path.join(vault,'.obsidian-brain/index.json'),'utf8'));
    assert.equal(CACHE_VERSION,3);assert.equal(c.version,3);assert(Array.isArray(c.paths));assert.equal(c.wordIndex.quasarbodymark[c.paths.indexOf('a.md')],21);
    const warm=await newIndex();assert.equal(snapshot(warm),snapshot(idx));
    const now=Date.now;const fixed=now();Date.now=()=>fixed;
    try {const before=await idx.search('quasarbodymarker');const after=await warm.search('quasarbodymarker');assert.deepEqual(after.map(x=>[x.filepath,x.score]),before.map(x=>[x.filepath,x.score]));} finally {Date.now=now;}
   });
   await check('old, corrupt, incomplete and mismatched caches safely rebuild',async()=>{
    const cache=path.join(vault,'.obsidian-brain/index.json');const valid=JSON.parse(await fs.readFile(cache,'utf8'));
    const cases=[{...valid,version:1},{...valid,wordIndex:undefined},{...valid,paths:undefined},{...valid,wordIndex:{}},{...valid,wordIndex:{...valid.wordIndex,quasarbodymark:{}}},{...valid,wordIndex:{...valid.wordIndex,quasarbodymark:{0:-1}}},{...valid,tagIndex:undefined},{...valid,vaultPath:'/wrong-vault'},'{oops'];
    for(const c of cases) {await fs.writeFile(cache,typeof c==='string'?c:JSON.stringify(c));const rebuilt=await newIndex();assert(await hit(rebuilt,'quasarbodymarker','a.md'));await rebuilt.dispose();}
    await fs.writeFile(cache,JSON.stringify({...valid,wordIndex:{...valid.wordIndex,extraterm:{999999:3}}}));const filtered=await newIndex();assert(!filtered.index.wordIndex.has('extraterm'));
   });
   await check('edits, deletions and moves prune old word/tag postings and persist',async()=>{
    await note('a.md','# Neutral A\nfreshmarker #newtag');await idx.indexFileImmediately('a.md');assert(!idx.index.wordIndex.get('quasarbodymark').has('a.md'));assert(await hit(idx,'freshmarker','a.md'));
    await fs.rename(path.join(vault,'a.md'),path.join(vault,'moved.md'));idx.removeFileImmediately('a.md');await idx.indexFileImmediately('moved.md');assert(!idx.index.files.has('a.md'));assert.deepEqual([...idx.index.tagIndex.get('newtag')],['moved.md']);
    await fs.unlink(path.join(vault,'b.md'));idx.removeFileImmediately('b.md');assert(!idx.index.wordIndex.has('quasarbodymark'));await idx.dispose();const warm=await newIndex();assert.equal((await warm.search('quasarbodymarker')).length,0);assert(await hit(warm,'freshmarker','moved.md'));
   });
   await check('startup reconciles added, older-mtime changed and deleted notes',async()=>{
    const i=await newIndex();await i.dispose();await note('added.md','# Neutral\naddedmarker');await note('moved.md','# Neutral\nchangedmarker',60);await fs.unlink(path.join(vault,'filler0.md'));
    const reconciled=await newIndex();assert(await hit(reconciled,'addedmarker','added.md'));assert(await hit(reconciled,'changedmarker','moved.md'));assert(!await hit(reconciled,'freshmarker','moved.md'));assert(!reconciled.index.files.has('filler0.md'));
   });
   await check('controlled tiered recency, precedence and archive penalty',async()=>{
    for(const [p,age] of [['hour.md',0.02],['day.md',0.5],['old.md',2],['_Archive/hour.md',0.02]])await note(p,'# Neutral\nrecencymarker',age);
    await note('named.md','# recencymarker\ntext',2);
    const i=await newIndex();const now=Date.now;Date.now=()=>1700000000000;
    try {
     for(const [p,age] of [['hour.md',0.02],['day.md',0.5],['old.md',2],['_Archive/hour.md',0.02],['named.md',2]])i.index.files.get(p).modified=Date.now()-age*86400000;
     const r=await i.search('recencymarker');const by=Object.fromEntries(r.map(x=>[x.filepath,x]));assert.equal(by['hour.md'].score-by['day.md'].score,1);assert(Math.abs(by['old.md'].score-(0.5+1.5*Math.exp(-2/7)))<1e-12);assert.equal(by['_Archive/hour.md'].score,by['hour.md'].score*0.05);assert.equal(r[0].filepath,'named.md');
    } finally {Date.now=now;}
   });
  }
  if(mode==='all'||mode==='tags') {
   const i=await newIndex();
   const sample='---\ntags: ["#Database", facade, database]\n---\n#e2e #dca #decade (#legit) [#bracket] #a #abc123 #abcdef12 #abcdef #a1b #facade https://site/#fragment file.ts#L120 #L120 #L120-L130\n`#inline`\n```ts\n#code-example\n```\n~~~\n#tilde-code\n~~~';
   await check('canonical inline tags exclude code, anchors and digit-bearing long hex',async()=>{
    assert.deepEqual(i.extractTags(sample),['Database','facade','e2e','dca','decade','legit','bracket','abcdef','a1b']);
    assert.deepEqual(i.extractTags('````\n#hidden\n```\n#still-hidden\n````\n#visible\n~~~\n#unclosed'),['visible']);
   });
   await check('LF/CRLF frontmatter arrays and block lists trim and deduplicate',async()=>{
    for(const eol of ['\n','\r\n']) {
     assert.deepEqual(i.extractTags(['---','tags: [ "#Database", \'facade\', Database, e2e, dca ]','---'].join(eol)),['Database','facade','e2e','dca']);
     assert.deepEqual(i.extractTags(['---','tags:','  - "#Database"','  - facade','  - Database','  - e2e','  - dca','other: value','---'].join(eol)),['Database','facade','e2e','dca']);
     assert.deepEqual(i.extractTags(['---','tags:','- facade','- e2e','- dca','---'].join(eol)),['facade','e2e','dca']);
    }
   });
   await note('tags.md',sample+'\nsql schema query database database');await i.indexFileImmediately('tags.md');
   await note('source.md','# Source\n#common #rare #Database');await note('rare.md','# Rare\n#rare #Database');await note('common.md','# Common\n#common');
   for(let n=0;n<8;n++)await note(`common${n}.md`,'# Filler\n#common');await note('untagged.md','No tags');await i.rebuildIndex();
   await check('related notes rare shared tags, limits, identity, self and empty cases',async()=>{
    const related=i.getRelatedNotes('source.md');assert.equal(related[0].filepath,'rare.md');assert(related[0].score>related.find(x=>x.filepath==='common.md').score);assert.deepEqual(related[0].sharedTags,['rare','database']);assert(!related.some(x=>x.filepath==='source.md'));assert.equal(i.getRelatedNotes('/source.md',1).length,1);assert.deepEqual(i.getRelatedNotes('missing.md'),[]);assert.deepEqual(i.getRelatedNotes('untagged.md'),[]);
    await note('solo.md','# Solo\n#solitary');await i.indexFileImmediately('solo.md');assert.deepEqual(i.getRelatedNotes('solo.md'),[]);
   });
   if(mode==='all') {
    const b=new BrainTool({subscriptions:[]});instances.push(b);await b.initialize();
    await check('search, summarize, auto_tag and related_notes agree on canonical tags',async()=>{
     assert.equal((await b.indexer.search('#code-example')).length,0);assert.equal((await b.indexer.search('#database')).length,3);
     const summary=await invoke(b,'summarize_note',{filepath:'tags.md'});assert(summary.includes('#Database'));assert(!summary.includes('#code-example'));assert(!summary.includes('#fragment'));
     const auto=await invoke(b,'auto_tag',{filepath:'tags.md'});const suggestions=auto.split('**🆕 Suggested Tags:**')[1]||'';assert(suggestions.includes('**#code-example**'));assert(!suggestions.includes('**#database**'));
     const related=await invoke(b,'related_notes',{filepath:'tags.md'});assert(related.includes('source.md'));assert(related.includes('database'));
    });
   }
  }
  if(mode==='all'||mode==='timers') {
   await check('watcher bursts coalesce after resettable five seconds; disposal flushes',async()=>{
    const i=await newIndex();let saves=0;const save=i.saveToCache.bind(i);i.saveToCache=async()=>{saves++;await save();};
    const clock=mock.timers;clock.enable({apis:['setTimeout']});
    try {
     const w=watchers.at(-1);await note('burst.md','# Burst\nburstmarker');w.callbacks.Create({fsPath:path.join(vault,'burst.md')});await Promise.all([...i.pendingUpdates]);assert(await hit(i,'burstmarker','burst.md'));assert.equal(saves,0);
     clock.tick(4000);await note('burst.md','# Burst\nsecondmarker');w.callbacks.Change({fsPath:path.join(vault,'burst.md')});clock.tick(500);await Promise.all([...i.pendingUpdates]);assert(await hit(i,'secondmarker','burst.md'));assert(!await hit(i,'burstmarker','burst.md'));
     clock.tick(4999);assert.equal(saves,0);clock.tick(1);await i.cacheWrite;assert.equal(saves,1);
     await note('burst.md','# Burst\nfinalmarker');w.callbacks.Change({fsPath:path.join(vault,'burst.md')});await i.dispose();assert.equal(saves,2);assert(w.disposed);assert.equal(i.debounceTimers.size,0);assert.equal(i.cacheSaveTimer,undefined);
     const warm=await newIndex();assert(await hit(warm,'finalmarker','burst.md'));
    }finally {clock.reset();await i.dispose();}
   });
  }
  if(mode==='all'||mode==='operations') await operations();
  if(mode==='all'||mode==='registration') await registration();
  if(mode==='all'||mode==='platform') await platform();
  if(mode==='all'||mode==='hooks') await hooks();
  console.log(`RESULT: ${passed} acceptance groups passed (${mode}, runtime=${runtime})`);
 } finally {for(const i of instances)await i.dispose();mock.timers.reset();await fs.rm(vault,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
async function operations() {
 const b=new BrainTool({subscriptions:[]});instances.push(b);await b.initialize();
 const seen=new Set();const op=async(name,args)=>{seen.add(name);const r=await invoke(b,name,args);assert(!r.includes('❌ Error:'),r);assert(!r.includes('/compact'));return r;};
 await check('all 14 operations and immediate write/search/read/append/insert/edit/move/delete',async()=>{
  assert((await op('write',{filepath:'/Ops/note.md',content:'# Operations\ninitialbodymarker #opstag'})).includes('Successfully wrote'));
  assert((await op('search',{query:'initialbodymarker'})).includes('Ops/note.md'));
  assert((await op('read',{filepath:'Ops/note.md'})).includes('initialbodymarker'));
  await op('append',{filepath:'Ops/note.md',content:'appendbodymarker'});
  assert((await op('search',{query:'appendbodymarker'})).includes('Ops/note.md'));
  await op('insert',{filepath:'Ops/note.md',insert_line:2,content:'insertbodymarker'});
  const checkpoint=await fs.readFile(path.join(vault,'_Inbox/session-activity-log.md'),'utf8');assert(checkpoint.includes('Save count: 3'));assert(checkpoint.includes('write /Ops/note.md'));assert(checkpoint.includes('append Ops/note.md'));assert(checkpoint.includes('insert Ops/note.md'));assert(await hit(b.indexer,'activity','_Inbox/session-activity-log.md'));assert.equal(b.saveCount,3);
  await op('str_replace',{filepath:'Ops/note.md',old_str:'initialbodymarker',new_str:'replacementbodymarker'});
  assert(!await hit(b.indexer,'initialbodymarker','Ops/note.md'));assert(await hit(b.indexer,'replacementbodymarker','Ops/note.md'));
  await op('move',{filepath:'Ops/note.md',destination:'Ops/moved.md'});assert(!b.indexer.getFileInfo('Ops/note.md'));assert(await hit(b.indexer,'replacementbodymarker','Ops/moved.md'));
  assert((await op('list',{directory:'Ops'})).includes('moved.md'));assert((await op('summarize_note',{filepath:'Ops/moved.md'})).includes('#opstag'));
  assert((await op('list_recent',{limit:1})).includes('Last 1'));
  assert((await op('related_notes',{filepath:'Ops/moved.md'})).includes('Shared tags'));
  await op('auto_tag',{filepath:'Ops/moved.md',apply_tags:false});
  await op('delete',{filepath:'Ops/moved.md'});assert(!b.indexer.getFileInfo('Ops/moved.md'));assert(!b.indexer.index.tagIndex.get('opstag')?.has('Ops/moved.md'));
  await op('quick_note',{content:'freshcapturemarker'});assert.equal(seen.size,14);
 });
 await check('read default 7000 and explicit small/large caps report truncation inline',async()=>{
  const text='Z'.repeat(7100)+'ENDMARKER';await op('write',{filepath:'Ops/large.md',content:text});
  const defaultRead=await op('read',{filepath:'Ops/large.md'});assert(defaultRead.includes('truncated at 7000'));assert(defaultRead.includes('larger explicit max_chars'));assert(!defaultRead.includes('ENDMARKER'));
  const small=await op('read',{filepath:'Ops/large.md',max_chars:17});assert(small.includes('truncated at 17'));assert(small.includes('Z'.repeat(17)));assert(!small.includes('Z'.repeat(18)));
  const full=await op('read',{filepath:'Ops/large.md',max_chars:8000});assert(full.includes('ENDMARKER'));assert(!full.includes('truncated'));assert(!full.includes('v2.'));
  assert((await invoke(b,'read',{filepath:'Ops/large.md',max_chars:0})).includes('positive numeric'));
 });
 await check('search limits 1, 3 and 25; eight displayed tags retain complete index',async()=>{
  for(let i=0;i<35;i++)await note(`Limits/n${i}.md`,'# Neutral\nlimitmarker #limitshared '+Array.from({length:11},(_,n)=>`#topic${n}`).join(' '));
  await b.rebuildIndex();
  for(const limit of [1,3,25]) {
   const r=await op('search',{query:'limitmarker',limit});assert.equal((r.match(/^## /gm)||[]).length,limit);if(limit<20)assert(r.includes('more results'));
   for(const tags of r.split('\n').filter(l=>l.startsWith('🏷️ Tags:'))) {assert.equal((tags.match(/#/g)||[]).length,8);assert(tags.includes('(+4 more)'));}
  }
  assert.equal(b.indexer.getFileInfo('Limits/n0.md').tags.length,12);assert.equal((await b.indexer.search('#topic10',100)).length,35);assert.equal(b.indexer.getRelatedNotes('Limits/n0.md',1)[0].sharedTags.length,12);
  assert.equal((await op('list_recent',{limit:3})).match(/^### /gm).length,3);assert.equal((await op('related_notes',{filepath:'Limits/n0.md',limit:3})).match(/^## /gm).length,3);
  assert((await op('related_notes',{filepath:'missing-note.md'})).includes('not found'));await note('Ops/no-tags.md','plain text');await b.indexer.indexFileImmediately('Ops/no-tags.md');assert((await op('related_notes',{filepath:'Ops/no-tags.md'})).includes('no tags'));
 });
 await check('quick_note content routing, suffix, session dedup and failed retry',async()=>{
  const routes=[['root cause captureengineeringmarker','Engineering'],['decision capturedecisionmarker','Decisions'],['how to captureplaybookmarker','Playbooks'],['```\ncapturesnippetmarker\n```','Snippets'],['captureinboxmarker','_Inbox']];
  for(const [content,route] of routes) {
   const count=b.saveCount;const r=await op('quick_note',{content});const filename=r.match(/Quick note saved to "([^"]+)"/)[1];assert(filename.startsWith(route+'/'));assert(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[a-f0-9]{4}\.md$/.test(filename));assert(b.indexer.getFileInfo(filename));assert.equal(b.saveCount,count+1);
   const marker=content.match(/capture[a-z]+marker/)[0];assert(await hit(b.indexer,marker,filename));const duplicate=await op('quick_note',{content});assert(duplicate.includes('Duplicate note skipped'));assert.equal(b.saveCount,count+1);
  }
  const write=b.filesystemBackend.writeFile.bind(b.filesystemBackend);b.filesystemBackend.writeFile=async()=>{throw Error('synthetic write failure');};const count=b.saveCount;
  assert((await invoke(b,'quick_note',{content:'retrycapturemarker'})).includes('synthetic write failure'));assert.equal(b.saveCount,count);b.filesystemBackend.writeFile=write;assert((await op('quick_note',{content:'retrycapturemarker'})).includes('Quick note saved'));
 });
 await check('superseded writes archive indexed history and penalize archive matches',async()=>{
  await op('write',{filepath:'Ops/history.md',content:'# History\nobsoletehistorymarker sharedhistorymarker #historical'});
  await op('write',{filepath:'Ops/history.md',content:'# History\ncurrenthistorymarker sharedhistorymarker #historical'});
  const old=await b.indexer.search('obsoletehistorymarker');assert.equal(old.length,1);assert(old[0].filepath.startsWith('_Archive/Ops/history-'));assert(!await hit(b.indexer,'obsoletehistorymarker','Ops/history.md'));
  const both=await b.indexer.search('sharedhistorymarker');assert.equal(both[0].filepath,'Ops/history.md');assert(both[1].score<both[0].score*0.1);
  assert((await fs.readFile(path.join(vault,old[0].filepath),'utf8')).includes('obsoletehistorymarker'));
 });
 await check('backslash archive paths do not recursively archive historical notes',async()=>{
  await op('write',{filepath:'_Archive\\historical.md',content:'historicalmarker'});
  const count=[...b.indexer.index.files.keys()].filter(p=>p.startsWith('_Archive/')).length;
  await op('write',{filepath:'_Archive\\historical.md',content:'changedhistoricalmarker'});
  assert.equal([...b.indexer.index.files.keys()].filter(p=>p.startsWith('_Archive/')).length,count);
  const listing=await op('list',{directory:'Ops\\'});assert(listing.includes('parallel.md')||listing.includes('history.md'));
 });
 await check('auto_tag canonical existing/stale tags and >=60% application',async()=>{
  await note('Ops/tagging.md','---\r\ntags:\r\n  - database\r\n  - testing\r\n---\r\n# Tagging\r\ndatabase sql schema migration query\r\n```\r\n#code-example\r\n```');await b.indexer.indexFileImmediately('Ops/tagging.md');
  const r=await op('auto_tag',{filepath:'Ops/tagging.md',apply_tags:true});assert(r.includes('Applied 1 tag(s):** #code-example'));assert(r.includes('**#testing**'));const suggestions=r.split('**🆕 Suggested Tags:**')[1];assert(!suggestions.includes('**#database**'));assert(b.indexer.getFileInfo('Ops/tagging.md').tags.includes('code-example'));
  const r2=await op('auto_tag',{filepath:'Ops/tagging.md'});assert(!r2.split('**🆕 Suggested Tags:**')[1]?.includes('**#code-example**'));
  await note('Ops/weak.md','# Weak\n#api\nUnrelated topic');await b.indexer.indexFileImmediately('Ops/weak.md');assert((await op('auto_tag',{filepath:'Ops/weak.md'})).includes('**#api** — no matching content patterns'));
 });
 await check('locked or unreadable existing files are never replaced by append or insert',async()=>{
  await op('write',{filepath:'Ops/locked.md',content:'preserve existing content'});
  const read=shim.workspace.fs.readFile;const saved=b.saveCount;
  shim.workspace.fs.readFile=async uri=>{
   if(uri.fsPath===path.join(vault,'Ops/locked.md'))throw Object.assign(Error('synthetic sharing/permission failure'),{code:'NoPermissions'});
   return read(uri);
  };
  try {
   assert((await invoke(b,'append',{filepath:'Ops/locked.md',content:'replacement'})).includes('synthetic sharing/permission failure'));
   assert((await invoke(b,'insert',{filepath:'Ops/locked.md',insert_line:1,content:'replacement'})).includes('synthetic sharing/permission failure'));
   assert.equal(b.saveCount,saved);assert.equal(await fs.readFile(path.join(vault,'Ops/locked.md'),'utf8'),'preserve existing content');
  } finally {shim.workspace.fs.readFile=read;}
 });
 await check('parallel appends preserve every save and checkpoint counts',async()=>{
  const fresh=new BrainTool({subscriptions:[]});instances.push(fresh);await fresh.initialize();
  await invoke(fresh,'write',{filepath:'Ops/parallel.md',content:'base'});
  const outputs=await Promise.all(Array.from({length:5},(_,n)=>invoke(fresh,'append',{filepath:'Ops/parallel.md',content:`parallelmarker${n}`})));
  assert(outputs.every(r=>r.includes('Successfully appended')));
  const content=await fs.readFile(path.join(vault,'Ops/parallel.md'),'utf8');
  for(let n=0;n<5;n++)assert(content.includes(`parallelmarker${n}`));
  assert.equal(fresh.saveCount,6);await fresh.dispose();
 });
 await check('rolling last-20 activity and every-third-save factual checkpoint, best effort',async()=>{
  const fresh=new BrainTool({subscriptions:[]});instances.push(fresh);await fresh.initialize();
  await invoke(fresh,'write',{filepath:'Ops/rolling.md',content:'rollingmarker'});await invoke(fresh,'str_replace',{filepath:'Ops/rolling.md',old_str:'missing',new_str:'x'});assert.equal(fresh.saveCount,1);
  for(let i=0;i<23;i++)await invoke(fresh,'append',{filepath:'Ops/rolling.md',content:'activity '+i});assert.equal(fresh.saveCount,24);assert.equal(fresh.saveActivity.length,20);assert(fresh.saveActivity[0].endsWith('append Ops/rolling.md'));
  const log=await fs.readFile(path.join(vault,'_Inbox/session-activity-log.md'),'utf8');const last=log.slice(log.lastIndexOf('## '));assert(last.includes('Save count: 24'));assert.equal(last.match(/^- /gm).length,20);assert(!/\/compact|tokens|context.*%/i.test(log));
  const append=fresh.filesystemBackend.appendFile.bind(fresh.filesystemBackend);fresh.filesystemBackend.appendFile=async(p,c)=>{if(p==='_Inbox/session-activity-log.md')throw Error('synthetic checkpoint failure');return append(p,c);};
  const originalLog=console.log;let failures=0;console.log=(...args)=>{if(String(args[0]).includes('Could not persist activity checkpoint'))failures++;else originalLog(...args);};
  try {for(let i=0;i<3;i++)assert((await invoke(fresh,'append',{filepath:'Ops/rolling.md',content:'still saved'})).includes('Successfully appended'));assert.equal(fresh.saveCount,27);assert.equal(failures,1);} finally {console.log=originalLog;fresh.filesystemBackend.appendFile=append;}
 });
 await check('12-operation save reminder without context estimates or compact directives',async()=>{
  const fresh=new BrainTool({subscriptions:[]});instances.push(fresh);await fresh.initialize();
  for(let n=1;n<=12;n++){const r=await invoke(fresh,'search',{query:'nonexistentquery'});assert.equal(r.includes('AUTO-CHECKPOINT REMINDER'),n===12);assert(!/\/compact|tokens|context.*%/i.test(r));}
  await fresh.dispose();
 });
 await b.dispose();const warm=await newIndex();assert(await hit(warm,'currenthistorymarker','Ops/history.md'));
}
async function registration() {
 await check('manifest and activation expose exactly one native tool, 14 operations and preserved contributions',async()=>{
  const manifest=JSON.parse(await fs.readFile(path.join(runtime,'../package.json'),'utf8'));
  assert.equal(manifest.version,'2.12.0');assert.equal(manifest.name,'obsidian-brain');assert.equal(manifest.publisher,'ubanishathanvenkatesan');assert.equal(manifest.main,'./out/extension.js');
  assert.deepEqual(manifest.contributes.languageModelTools.map(t=>t.name),['obsidian_brain']);const tool=manifest.contributes.languageModelTools[0];assert.equal(tool.toolReferenceName,'obsidian_brain');
  const operations=['search','list','read','write','append','quick_note','str_replace','insert','delete','move','summarize_note','list_recent','auto_tag','related_notes'];assert.deepEqual(tool.inputSchema.properties.operation.enum,operations);assert.equal(tool.inputSchema.properties.max_chars.type,'number');
  assert.deepEqual(manifest.contributes.chatPromptFiles.map(p=>p.name).sort(),['brain-auto-save','brain-compress','brain-recall','brain-remember','brain-summarize']);assert(manifest.contributes.chatInstructions.some(p=>p.name==='brain-usage'));assert(manifest.contributes.configuration.properties['obsidianBrain.vaultPath']);assert(!manifest.contributes.configuration.properties['obsidianBrain.filesystemAllowedDirectories']);
  for(const p of [...manifest.contributes.chatPromptFiles,...manifest.contributes.chatInstructions]) {const text=await fs.readFile(path.join(runtime,'..',p.path),'utf8');assert(!text.includes('/compact'));assert(!/memory:|`memory` tool/.test(text));}
  assert.equal(shim.ConfigurationTarget.Global,1);
  const context={subscriptions:[]};require(runtime+'/extension.js').activate(context);const registered=tools.at(-1);instances.push(registered.tool);assert.deepEqual(tools.map(t=>t.name),['obsidian_brain']);await registered.tool.initialize();assert(context.subscriptions.includes(registered.tool));
  for(const name of ['checkConnection','openVault','rebuildIndex'])assert(commands.has('obsidianBrain.'+name));assert.equal(commands.size,4);assert(commands.has('obsidianBrain.configureVault'));assert.equal(manifest.contributes.configuration.properties['obsidianBrain.vaultPath'].default,'');assert.equal(manifest.contributes.configuration.properties['obsidianBrain.vaultPath'].scope,'machine-overridable');assert(await registered.tool.checkConnection());assert(await registered.tool.checkObsidianMcpConnection());
  await note('registration.md','# Registration\nregistrationmarker');assert(!registered.tool.indexer.getFileInfo('registration.md'));await commands.get('obsidianBrain.rebuildIndex')();assert(registered.tool.indexer.getFileInfo('registration.md'));const picker=shim.window.showOpenDialog;const configuration=shim.workspace.getConfiguration;
  const picked=path.join(vault,'picked-vault');await fs.mkdir(picked);
  try {
   shim.window.showOpenDialog=async()=>[{fsPath:picked}];
   for(const [existing,target] of [[{},1],[{workspaceValue:vault},2],[{workspaceFolderValue:vault},3]]) {
    let savedTarget;shim.workspace.getConfiguration=()=>({...configuration(),inspect:()=>existing,update:async(key,value,scope)=>{assert.equal(key,'vaultPath');savedTarget=scope;setVault(value);}});
    await commands.get('obsidianBrain.configureVault')();assert.equal(savedTarget,target);assert.equal(registered.tool.filesystemBackend.getVaultPath(),picked);
   }
  } finally {shim.window.showOpenDialog=picker;shim.workspace.getConfiguration=configuration;setVault(vault);}
  await registered.tool.dispose();
  for(const d of context.subscriptions)await d.dispose();
  for(const obsolete of ['memoryTool','filesystemTool','chatHistoryTool','contextWatcher'])assert(!await fs.stat(path.join(runtime,obsolete+'.js')).then(()=>true,()=>false));
  for(const js of ['extension','brainTool','vaultIndexer'])assert(!(await fs.readFile(path.join(runtime,js+'.js'),'utf8')).includes('/compact'));
 });
}

async function platform() {
 await check('Windows/macOS/Linux defaults, native absolute paths, tilde and mixed-platform rejection',async()=>{
  assert.equal(resolveVaultPath('', 'win32', 'C:\\Users\\User'), 'C:\\workspace\\obsidian-vault');
  assert.equal(resolveVaultPath(undefined,'darwin','/Users/User'),'/Users/User/workspace/obsidian-vault');
  assert.equal(resolveVaultPath('','linux','/home/user'),'/home/user/workspace/obsidian-vault');
  assert.equal(resolveVaultPath('~/notes','darwin','/Users/User'),'/Users/User/notes');
  assert.equal(resolveVaultPath('~\\notes','win32','C:\\Users\\User'),'C:\\Users\\User\\notes');
  assert.equal(resolveVaultPath('D:/notes/../vault','win32'),'D:\\vault');
  assert.equal(resolveVaultPath('\\\\server\\share\\vault','win32'),'\\\\server\\share\\vault');
  assert.throws(()=>resolveVaultPath('C:\\workspace\\obsidian-vault','darwin'),/Invalid Obsidian vault path/);
  assert.throws(()=>resolveVaultPath('/Users/user/vault','win32'),/Invalid Obsidian vault path/);
  assert.throws(()=>resolveVaultPath('relative/vault','darwin'),/absolute path/);
  assert.equal(normalizeNotePath('Engineering\\note.md'),'Engineering/note.md');
  assert.throws(()=>normalizeNotePath('../outside.md'),/inside/);
 });
 await check('automatic default creation and clear invalid/inaccessible path failures',async()=>{
  const previous=vault;const automatic=path.join(vault,'automatic');
  try {
   setVault('');await prepareVault(automatic);
   for(const dir of ['Engineering','Playbooks','Decisions','Snippets','_Inbox','_Workspaces','_Archive'])assert((await fs.stat(path.join(automatic,dir))).isDirectory());
   const bad=new BrainTool({subscriptions:[]});instances.push(bad);setVault(process.platform==='win32'?'/Users/User/vault':'C:\\workspace\\obsidian-vault');const invalid=await invoke(bad,'search',{query:'test'});assert(invalid.includes('Invalid Obsidian vault path'));assert(!invalid.includes('No results'));
   const missing=path.join(vault,'missing-vault');setVault(missing);const absent=await invoke(bad,'list_recent');assert(absent.includes('Cannot access Obsidian vault'));assert(!await fs.stat(missing).then(()=>true,()=>false));
   setVault(previous);assert((await invoke(bad,'search',{query:'nonexistentquery'})).includes('No results'));await bad.dispose();
   const original=shim.workspace.fs.createDirectory;shim.workspace.fs.createDirectory=async()=>{throw Error('EACCES synthetic denied');};setVault('');
   try {await assert.rejects(()=>prepareVault(automatic),/EACCES.*readable, writable/);} finally {shim.workspace.fs.createDirectory=original;}
  } finally {setVault(previous);}
 });
 await check('vault directory symlink/junction flags remain accessible',async()=>{
  const stat=shim.workspace.fs.stat;
  shim.workspace.fs.stat=async uri=>{const result=await stat(uri);return uri.fsPath===vault?{...result,type:result.type|64}:result;};
  const brain=new BrainTool({subscriptions:[]});
  try {await prepareVault(vault);assert(await brain.checkConnection());} finally {await brain.dispose();shim.workspace.fs.stat=stat;}
 });
 await check('in-flight writes remain in their original vault during a setting change',async()=>{
  const a=path.join(vault,'concurrent-a'),b=path.join(vault,'concurrent-b');await fs.mkdir(a);await fs.mkdir(b);
  await fs.writeFile(path.join(a,'concurrent.md'),'original A');await fs.writeFile(path.join(b,'concurrent.md'),'original B');
  const brain=new BrainTool({subscriptions:[]});let release;
  try {
   setVault(a);await brain.initialize();
   const gate=new Promise(resolve=>{release=resolve;});let started;const began=new Promise(resolve=>{started=resolve;});
   const append=brain.filesystemBackend.appendFile.bind(brain.filesystemBackend);
   brain.filesystemBackend.appendFile=async(p,c)=>{started();await gate;return append(p,c);};
   const writing=invoke(brain,'append',{filepath:'concurrent.md',content:'inflightmarker'});await began;
   setVault(b);const switching=brain.initialize();await new Promise(setImmediate);release();await Promise.all([writing,switching]);
   assert((await fs.readFile(path.join(a,'concurrent.md'),'utf8')).includes('inflightmarker'));
   assert(!(await fs.readFile(path.join(b,'concurrent.md'),'utf8')).includes('inflightmarker'));
  } finally {release?.();await brain.dispose();setVault(vault);}
 });
 await check('vault setting changes switch both I/O and index without reload; Windows note separators',async()=>{
  const a=path.join(vault,'switch-a'),b=path.join(vault,'switch-b');await fs.mkdir(a);await fs.mkdir(b);await fs.writeFile(path.join(a,'first.md'),'# First\nfirstvaultmarker');await fs.writeFile(path.join(b,'second.md'),'# Second\nsecondvaultmarker');
  const brain=new BrainTool({subscriptions:[]});let old;
  try {
   setVault(a);await brain.initialize();old=brain.indexer;assert((await invoke(brain,'search',{query:'firstvaultmarker'})).includes('first.md'));
   setVault(b);assert((await invoke(brain,'list_recent')).includes('second.md'));assert((await invoke(brain,'search',{query:'firstvaultmarker'})).includes('No results'));assert(old.disposed);assert.notEqual(old,brain.indexer);
   assert((await invoke(brain,'write',{filepath:'Engineering\\new.md',content:'switchedwritebodymarker'})).includes('Successfully wrote'));assert(await fs.stat(path.join(b,'Engineering/new.md')));assert(!await fs.stat(path.join(a,'Engineering/new.md')).then(()=>true,()=>false));assert(brain.indexer.getFileInfo('Engineering\\new.md'));assert((await invoke(brain,'search',{query:'switchedwritebodymarker'})).includes('Engineering/new.md'));
  } finally {await brain.dispose();setVault(vault);}
 });
}

async function hooks() {
 const {installAgentHooks,MANAGED_MARKER,buildHookConfig,withMarker,isManaged}=require(runtime+'/hookInstaller.js');
 const {execFileSync}=require('node:child_process');
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'obsidian-brain-home-'));
 const context={extensionUri:{fsPath:path.resolve(__dirname,'..')}};
 const hooksDir=path.join(home,'.copilot','hooks');
 const configPath=path.join(hooksDir,'obsidian-brain.json');
 const scriptPath=path.join(hooksDir,'scripts','brain_guard.py');
 const instructionPath=path.join(home,'.copilot','instructions','brain-first-workflow.instructions.md');
 const read=p=>fs.readFile(p,'utf8');
 const exists=p=>fs.stat(p).then(()=>true,()=>false);
 try {
  await check('installs guard script, hook config and instruction into user-level Copilot folders',async()=>{
   const report=await installAgentHooks(context,{homeDir:home,vaultPath:'/tmp/synthetic-vault'});
   assert.equal(report.installed,true,report.reason);
   assert.equal(report.skipped.length,0);
   assert.equal(report.hooksDir,hooksDir);
   assert.deepEqual(report.written.sort(),[configPath,instructionPath,scriptPath].sort());
   assert(isManaged(await read(scriptPath)));
   assert(isManaged(await read(configPath)));
   assert(isManaged(await read(instructionPath)));
   assert((await read(instructionPath)).startsWith('---'),'instruction keeps YAML frontmatter first');
  });
  await check('hook config wires all four events with absolute paths and a vault env override',async()=>{
   const cfg=JSON.parse(await read(configPath));
   assert.deepEqual(Object.keys(cfg.hooks).sort(),['PostToolUse','PreCompact','SessionStart','Stop']);
   for(const event of ['SessionStart','PostToolUse','PreCompact','Stop']) {
    const [entry]=cfg.hooks[event];
    assert.equal(entry.type,'command');
    assert(entry.command.includes(scriptPath),`${event} command must use the absolute script path`);
    assert(entry.command.includes(`--event ${event}`));
    assert(entry.windows.includes(scriptPath));
    assert.equal(entry.env.OBSIDIAN_BRAIN_VAULT,'/tmp/synthetic-vault');
    assert.equal(entry.timeout,10);
   }
  });
  await check('installed guard script runs and self-tests from its installed location',async()=>{
   const out=execFileSync('python3',[scriptPath,'--self-test'],{encoding:'utf8'});
   assert(out.includes('all checks passed'));
   const blocked=execFileSync('python3',[scriptPath,'--event','Stop'],{input:'{}',encoding:'utf8'});
   assert.equal(blocked,'','a Stop with no session state must stay silent');
  });
  await check('reinstall is idempotent and rewrites nothing',async()=>{
   const before=await Promise.all([read(scriptPath),read(configPath),read(instructionPath)]);
   const report=await installAgentHooks(context,{homeDir:home,vaultPath:'/tmp/synthetic-vault'});
   assert.equal(report.installed,true);
   assert.deepEqual(report.written,[],'unchanged files must not be rewritten');
   assert.deepEqual(await Promise.all([read(scriptPath),read(configPath),read(instructionPath)]),before);
  });
  await check('user-authored files without the marker are never overwritten',async()=>{
   const mine=path.join(hooksDir,'scripts','brain_guard.py');
   await fs.writeFile(mine,'#!/usr/bin/env python3\nprint("mine")\n');
   const report=await installAgentHooks(context,{homeDir:home});
   assert.deepEqual(report.skipped,[mine]);
   assert.equal(await read(mine),'#!/usr/bin/env python3\nprint("mine")\n');
  });
  await check('opt-out setting skips installation entirely',async()=>{
   const get=shim.workspace.getConfiguration;
   shim.workspace.getConfiguration=()=>({get:key=>key==='installAgentHooks'?false:undefined});
   try {
    const fresh=await fs.mkdtemp(path.join(os.tmpdir(),'obsidian-brain-home-'));
    const report=await installAgentHooks(context,{homeDir:fresh});
    assert.equal(report.installed,false);
    assert(report.reason.includes('installAgentHooks'));
    assert(!await exists(path.join(fresh,'.copilot','hooks','obsidian-brain.json')));
    await fs.rm(fresh,{recursive:true,force:true});
   } finally {shim.workspace.getConfiguration=get;}
  });
  await check('marker insertion keeps the shebang first and Windows quoting is correct',async()=>{
   const marked=withMarker('#!/usr/bin/env python3\nprint(1)\n');
   assert(marked.split('\n')[0]==='#!/usr/bin/env python3');
   assert(marked.split('\n')[1].includes(MANAGED_MARKER));
   assert(!isManaged('#!/usr/bin/env python3\nprint(1)\n'));
   const win=buildHookConfig('C:\\Users\\me\\.copilot\\hooks\\scripts\\brain_guard.py');
   assert(win.hooks.SessionStart[0].windows.includes('"C:\\Users\\me\\.copilot\\hooks\\scripts\\brain_guard.py"'));
   assert(win.hooks.SessionStart[0].command.includes("'C:\\Users\\me\\.copilot\\hooks\\scripts\\brain_guard.py'"),'command stays the POSIX default; windows overrides it');
   const posix=buildHookConfig('/home/me/.copilot/hooks/scripts/brain_guard.py');
   assert(posix.hooks.SessionStart[0].command.includes("'/home/me/.copilot/hooks/scripts/brain_guard.py'"));
  });
  await check('a workspace that already ships a guard suppresses the user-level config',async()=>{
   const ws=await fs.mkdtemp(path.join(os.tmpdir(),'obsidian-brain-ws-'));
   const wsHooks=path.join(ws,'.github','hooks');await fs.mkdir(wsHooks,{recursive:true});
   await fs.writeFile(path.join(wsHooks,'brain-guard.json'),JSON.stringify({hooks:{Stop:[{type:'command',command:'python3 .github/hooks/scripts/brain_guard.py --event Stop'}]}}));
   const folders=shim.workspace.workspaceFolders;
   shim.workspace.workspaceFolders=[{uri:{fsPath:ws}}];
   try {
    const fresh=await fs.mkdtemp(path.join(os.tmpdir(),'obsidian-brain-home-'));
    const report=await installAgentHooks(context,{homeDir:fresh});
    assert.equal(report.installed,true);
    assert(report.skipped.includes(path.join(fresh,'.copilot','hooks','obsidian-brain.json')),'the duplicate config must be skipped');
    assert(!await exists(path.join(fresh,'.copilot','hooks','obsidian-brain.json')));
    assert(await exists(path.join(fresh,'.copilot','hooks','scripts','brain_guard.py')),'the script is still installed for reuse');
    await fs.rm(fresh,{recursive:true,force:true});
   } finally {shim.workspace.workspaceFolders=folders;await fs.rm(ws,{recursive:true,force:true});}
  });
  await check('a workspace without a guard still gets the user-level config',async()=>{
   const ws=await fs.mkdtemp(path.join(os.tmpdir(),'obsidian-brain-ws-'));
   const folders=shim.workspace.workspaceFolders;
   shim.workspace.workspaceFolders=[{uri:{fsPath:ws}}];
   try {
    const fresh=await fs.mkdtemp(path.join(os.tmpdir(),'obsidian-brain-home-'));
    const report=await installAgentHooks(context,{homeDir:fresh});
    assert(report.written.includes(path.join(fresh,'.copilot','hooks','obsidian-brain.json')));
    await fs.rm(fresh,{recursive:true,force:true});
   } finally {shim.workspace.workspaceFolders=folders;await fs.rm(ws,{recursive:true,force:true});}
  });
  await check('a config written earlier is removed once the workspace ships its own guard',async()=>{
   const ws=await fs.mkdtemp(path.join(os.tmpdir(),'obsidian-brain-ws-'));
   const fresh=await fs.mkdtemp(path.join(os.tmpdir(),'obsidian-brain-home-'));
   const folders=shim.workspace.workspaceFolders;
   const userConfig=path.join(fresh,'.copilot','hooks','obsidian-brain.json');
   try {
    shim.workspace.workspaceFolders=[{uri:{fsPath:ws}}];
    await installAgentHooks(context,{homeDir:fresh});
    assert(await exists(userConfig),'no workspace guard yet, so the user config is written');
    const wsHooks=path.join(ws,'.github','hooks');await fs.mkdir(wsHooks,{recursive:true});
    await fs.writeFile(path.join(wsHooks,'brain-guard.json'),JSON.stringify({hooks:{Stop:[{type:'command',command:'python3 .github/hooks/scripts/brain_guard.py --event Stop'}]}}));
    const report=await installAgentHooks(context,{homeDir:fresh});
    assert(report.removed.includes(userConfig),'the stale user config must be removed');
    assert(!await exists(userConfig),'otherwise the guard would fire twice per event');
   } finally {shim.workspace.workspaceFolders=folders;await fs.rm(fresh,{recursive:true,force:true});await fs.rm(ws,{recursive:true,force:true});}
  });
  await check('a missing bundled asset fails soft instead of throwing',async()=>{
   const report=await installAgentHooks({extensionUri:{fsPath:path.join(home,'no-such-extension')}},{homeDir:home});
   assert.equal(report.installed,false);
   assert(report.reason.length>0);
  });
 } finally {await fs.rm(home,{recursive:true,force:true});}
}
