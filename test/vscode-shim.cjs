const fs = require('node:fs/promises');
const path = require('node:path');
const Module = require('node:module');
let vaultPath;
const watchers = [], tools = [], commands = new Map();
const disposable = () => ({dispose(){}});
const shim = {
  Uri: {file: fsPath => ({fsPath}), joinPath: (base, ...parts) => ({fsPath: path.join(base.fsPath, ...parts)})}, FileType: {File:1, Directory:2},
  RelativePattern: class {constructor(base, pattern){Object.assign(this,{base,pattern});}},
  LanguageModelToolResult: class {constructor(content){this.content=content;}},
  LanguageModelTextPart: class {constructor(value){this.value=value;}},
  ProgressLocation: {Notification:1}, ConfigurationTarget: {Global:1,Workspace:2,WorkspaceFolder:3},
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({get: key => key === 'vaultPath' ? vaultPath : undefined}),
    fs: {
      readFile: uri => fs.readFile(uri.fsPath),
      writeFile: (uri, data) => fs.writeFile(uri.fsPath, data),
      createDirectory: uri => fs.mkdir(uri.fsPath,{recursive:true}),
      readDirectory: async uri => (await fs.readdir(uri.fsPath,{withFileTypes:true})).map(e=>[e.name,e.isDirectory()?2:1]),
      stat: async uri => {const s=await fs.stat(uri.fsPath);return {mtime:s.mtimeMs,size:s.size,type:s.isDirectory()?2:1};},
      delete: (uri, options) => options?.recursive ? fs.rm(uri.fsPath,{recursive:true}) : fs.rm(uri.fsPath),
      rename: (a,b) => fs.rename(a.fsPath,b.fsPath)
    },
    createFileSystemWatcher: () => {
      const w = {disposed:false, callbacks:{}, dispose(){this.disposed=true;}};
      for(const event of ['Create','Change','Delete']) w['onDid'+event] = cb => {w.callbacks[event]=cb;return disposable();};
      watchers.push(w); return w;
    }
  },
  lm: {tools:[], registerTool: (name, tool) => {tools.push({name,tool});return disposable();}},
  commands: {registerCommand:(name,cb)=>{commands.set(name,cb);return disposable();},executeCommand:async()=>{}},
  window: {showInformationMessage:async()=>{},showWarningMessage:async()=>{},withProgress:async(_,cb)=>cb()}
};
const original = Module._load;
Module._load = function(name, ...args){return name==='vscode'?shim:original.call(this,name,...args);};
module.exports = {shim, watchers, tools, commands, setVault:p=>{vaultPath=p;}, runtime:path.resolve(process.env.BRAIN_RUNTIME || 'out')};
