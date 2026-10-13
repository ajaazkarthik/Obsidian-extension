const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const yauzl = require('yauzl');
async function extract(archive,directory) {
 const zip=await new Promise((res,rej)=>yauzl.open(archive,{lazyEntries:true},(e,z)=>e?rej(e):res(z)));
 const names=[];
 await new Promise((resolve,reject)=>{
  zip.on('error',reject);zip.on('end',resolve);
  zip.on('entry',entry=>{
   (async()=>{
    const name=entry.fileName;assert(!name.includes('..'));names.push(name);
    if(name.endsWith('/')){zip.readEntry();return;}
    const stream=await new Promise((res,rej)=>zip.openReadStream(entry,(e,s)=>e?rej(e):res(s)));
    const chunks=[];for await(const chunk of stream)chunks.push(chunk);
    const dest=path.join(directory,name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,Buffer.concat(chunks));zip.readEntry();
   })().catch(e=>{zip.close();reject(e);});
  });zip.readEntry();
 });return names;
}
(async()=>{
 const cwd=path.resolve(__dirname,'..');const archive=process.argv[2]||path.join(cwd,'releases/obsidian-brain-2.11.1.vsix');
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'obsidian-brain-package-'));
 try {
  const names=await extract(archive,temp);
  const expected=['[Content_Types].xml','extension.vsixmanifest','extension/package.json','extension/readme.md','extension/changelog.md','extension/LICENSE.txt',
   ...['extension','brainTool','vaultIndexer','filesystemBackend'].flatMap(m=>[`extension/out/${m}.js`,`extension/out/${m}.d.ts`]),
   ...['remember','recall','summarize','compress','auto-save'].map(n=>`extension/prompts/brain-${n}.prompt.md`),
   'extension/prompts/brain-usage.instructions.md','extension/.github/agents/brain-manager.agent.md'];
  assert.deepEqual(names.sort(),expected.sort());
  const packaged=JSON.parse(await fs.readFile(path.join(temp,'extension/package.json'),'utf8'));
  const local=JSON.parse(await fs.readFile(path.join(cwd,'package.json'),'utf8'));assert.deepEqual(packaged,local);
  const xml=await fs.readFile(path.join(temp,'extension.vsixmanifest'),'utf8');assert(xml.includes('Version="2.11.1"'));assert(xml.includes('Publisher="ubanishathanvenkatesan"'));assert(!xml.includes('Microsoft.VisualStudio.Code.PreRelease'));
  for(const m of ['extension','brainTool','vaultIndexer','filesystemBackend'])for(const ext of ['js','d.ts']) {
   assert.equal(await fs.readFile(path.join(temp,`extension/out/${m}.${ext}`),'utf8'),await fs.readFile(path.join(cwd,`out/${m}.${ext}`),'utf8'));
  }
  console.log(`PASS VSIX allowlist (${names.length} entries), identity, version, stable release and runtime/declaration byte parity`);
  execFileSync(process.execPath,[path.join(__dirname,'acceptance.cjs')],{cwd,stdio:'inherit',env:{...process.env,BRAIN_RUNTIME:path.join(temp,'extension/out')}});
  console.log('PASS packaged runtime acceptance suite; extracted fixtures cleaned');
 } finally {await fs.rm(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
