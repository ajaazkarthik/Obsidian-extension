const path = require('node:path');
const fs = require('node:fs/promises');
const {execFileSync} = require('node:child_process');
const {pack} = require('@vscode/vsce/out/package');
(async()=>{
 const cwd=path.resolve(__dirname,'..');
 execFileSync(process.execPath,[require.resolve('typescript/bin/tsc'),'-p',cwd],{cwd,stdio:'inherit'});
 execFileSync(process.execPath,['test/acceptance.cjs'],{cwd,stdio:'inherit'});
 const packagePath=path.join(cwd,'releases/obsidian-brain-2.11.1.vsix');
 await fs.mkdir(path.dirname(packagePath),{recursive:true});
 // Run vsce's pack step directly: compile/test already ran using this Node runtime.
 // This avoids a nested npm prepublish command and does not install dependencies.
 const result=await pack({cwd,packagePath,dependencies:false});
 console.log(`Built ${result.packagePath} (${result.files.length} files)`);
 execFileSync(process.execPath,['test/package.cjs',packagePath],{cwd,stdio:'inherit'});
})().catch(e=>{console.error(e);process.exitCode=1;});
