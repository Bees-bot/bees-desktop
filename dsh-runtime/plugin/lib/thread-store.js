import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => JSON.stringify(value, (_key,v) => v && typeof v==='object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
export const checkpointDigest = doc => digest(canonical(doc));
export const threadError = (text,status=400) => Object.assign(new Error(text),{status});
const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const validId = value => {if(typeof value!=='string'||!idPattern.test(value)) throw threadError('Invalid identity');return value;};
export const text = (value,max=20000) => {if(typeof value!=='string'||!value.trim()||value.length>max)throw threadError('Enter valid text');return value.trim();};
export const threadPath = value => {
  if(typeof value!=='string'||!value||value.length>500||value.split('/').some(part=>!part||part==='.'||part==='..'||/[\x00-\x1f\\:*?"<>|]/.test(part)||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))throw threadError('Use a relative file or folder path inside this thread');
  return value;
};
const now=()=>new Date().toISOString();

export class ThreadStore {
  constructor(root,clientId=randomUUID()) {
    this.root=root;this.clientId=validId(clientId);
    mkdirSync(join(root,'objects'),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(join(root,'threads.db'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,document TEXT NOT NULL,staged INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    // An interrupted agent may have made an external change. Recovery always needs an explicit retry.
    for(const {id,document} of this.db.prepare('SELECT id,document FROM threads WHERE staged=0').all()) {
      const doc=JSON.parse(document);let changed=false;
      for(const run of doc.runs) if(doc.ownerClientId===this.clientId&&run.status==='running') {run.status='uncertain';run.error='This client stopped during execution. Review external actions before retrying.';changed=true;}
      if(changed) this.save({...doc,revision:doc.revision+1});
    }
  }
  close(){this.db.close();}
  preference(key,value){if(value!==undefined)this.db.prepare('INSERT INTO preferences VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));return JSON.parse(this.db.prepare('SELECT value FROM preferences WHERE key=?').get(key)?.value??'null');}
  list(){return this.db.prepare('SELECT document,staged FROM threads ORDER BY json_extract(document,\'$.updatedAt\') DESC').all().map(({document,staged})=>{const d=JSON.parse(document);return {id:d.id,title:d.title,ownerClientId:d.ownerClientId,ownerUserId:d.ownerUserId,shared:d.shared,revision:d.revision,updatedAt:d.updatedAt,preview:d.messages.at(-1)?.text?.slice(0,120)??'',runs:d.runs.map(r=>({id:r.id,status:r.status})),staged:!!staged};});}
  get(id){const row=this.db.prepare('SELECT document,staged FROM threads WHERE id=?').get(validId(id));if(!row)throw threadError('Thread is not available on this client',404);return {...JSON.parse(row.document),staged:!!row.staged};}
  document(id){const {staged,...doc}=this.get(id);return doc;}
  save(doc,staged=false){this.validate(doc);this.db.prepare('INSERT INTO threads VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,document=excluded.document,staged=excluded.staged').run(doc.id,doc.revision,canonical(doc),Number(staged));return doc;}
  validate(doc){
    validId(doc.id);validId(doc.ownerClientId);text(doc.ownerUserId,200);text(doc.title,180);
    if(!Number.isSafeInteger(doc.revision)||doc.revision<1||!Number.isSafeInteger(doc.epoch)||doc.epoch<1)throw threadError('Invalid thread revision');
    if(!Array.isArray(doc.messages)||doc.messages.length>10000||!Array.isArray(doc.artifacts)||doc.artifacts.length>1000||!Array.isArray(doc.runs)||doc.runs.length>1000||Buffer.byteLength(canonical(doc))>8_000_000)throw threadError('Thread exceeds its storage limit');
    const known=new Set();
    if(doc.folders!==undefined&&(!Array.isArray(doc.folders)||doc.folders.length>1000))throw threadError('Invalid thread folders');
    const paths=new Set();
    for(const a of doc.artifacts)if(a.path!==undefined){threadPath(a.path);if(paths.has(a.path.toLowerCase()))throw threadError('A file already exists at this path');paths.add(a.path.toLowerCase());}
    const folders=(doc.folders??[]).map(value=>threadPath(value).toLowerCase());
    for(const folder of folders)if(paths.has(folder))throw threadError('A file occupies this folder');
    for(const path of [...paths,...folders]){
      const parts=path.split('/');
      for(let i=1;i<parts.length;i++)if(paths.has(parts.slice(0,i).join('/')))throw threadError('A file occupies a parent folder');
    }
    if(doc.operations!==undefined){if(!Array.isArray(doc.operations)||doc.operations.length>50000||new Set(doc.operations).size!==doc.operations.length)throw threadError('Invalid operation ledger');for(const operation of doc.operations)validId(operation);}
    for(const a of doc.artifacts){validId(a.id);text(a.name,200);if(known.has(a.id)||/[\x00-\x1f/\\]/.test(a.name)||['.','..'].includes(a.name)||!/^[a-f0-9]{64}$/.test(a.digest)||!Number.isSafeInteger(a.size)||a.size<0||a.size>10_000_000)throw threadError('Invalid attachment');known.add(a.id);}
    if(doc.artifacts.reduce((n,a)=>n+a.size,0)>250_000_000)throw threadError('Thread file limit reached');
    const messages=new Set();for(const m of doc.messages){validId(m.id);if(messages.has(m.id))throw threadError('Duplicate message');messages.add(m.id);text(m.text,100000);text(m.authorId,200);if(!['user','assistant','discussion','system'].includes(m.kind))throw threadError('Invalid message');}
  }
  create(title,userId='local') {const at=now();return this.save({id:randomUUID(),title:text(title,180),ownerClientId:this.clientId,ownerUserId:userId,shared:false,epoch:1,revision:1,createdAt:at,updatedAt:at,messages:[],artifacts:[],runs:[],memory:[]});}
  writable(doc){if(doc.staged||doc.ownerClientId!==this.clientId)throw threadError('Changes must be accepted by the owning client',409);if(this.preference(`frozen:${doc.id}`))throw threadError('This thread is being transferred',409);}
  mutate(id,operation,fn){
    validId(operation);const doc=this.get(id);this.writable(doc);delete doc.staged;
    doc.operations??=[];if(doc.operations.includes(operation))return doc;
    this.db.exec('BEGIN IMMEDIATE');
    try{fn(doc);doc.operations.push(operation);doc.revision++;doc.updatedAt=now();this.save(doc);this.db.exec('COMMIT');return doc;}catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  message(id,operation,body,authorId,kind='user'){return this.mutate(id,operation,doc=>{
    const messageText=text(body,100000);
    if(doc.title==='New thread'&&!doc.messages.length&&(kind==='user'||kind==='discussion'))doc.title=messageText.slice(0,80).trim();
    doc.messages.push({id:operation,authorId,text:messageText,kind,createdAt:now()});
  });}
  objectPath(hash){if(!/^[a-f0-9]{64}$/.test(hash))throw threadError('Invalid file digest');return join(this.root,'objects',hash);}
  putObject(bytes,expected){if(!Buffer.isBuffer(bytes)||bytes.length>10_000_000)throw threadError('Files must be 10 MB or smaller');const hash=digest(bytes);if(expected&&expected!==hash)throw threadError('File integrity check failed');const path=this.objectPath(hash);if(existsSync(path)){if(lstatSync(path).isSymbolicLink()||digest(readFileSync(path))!==hash)throw threadError('Stored file failed verification');}else writeFileSync(path,bytes,{flag:'wx',mode:0o600});return hash;}
  object(doc,id){const artifact=doc.artifacts.find(a=>a.id===validId(id));if(!artifact)throw threadError('File is not part of this thread',404);const path=this.objectPath(artifact.digest);if(!existsSync(path)||lstatSync(path).isSymbolicLink())throw threadError('File has not arrived on this client',404);const bytes=readFileSync(path);if(bytes.length!==artifact.size||digest(bytes)!==artifact.digest)throw threadError('File integrity check failed');return {artifact,bytes};}
  attach(id,operation,name,bytes,authorId,path){name=text(name,200);if(/[\x00-\x1f/\\]/.test(name)||['.','..'].includes(name))throw threadError('Invalid attachment name');if(path!==undefined)threadPath(path);const doc=this.get(id);this.writable(doc);validId(operation);if(doc.operations?.includes(operation))return this.document(id);if(doc.artifacts.length>=1000||doc.artifacts.reduce((n,a)=>n+a.size,0)+bytes.length>250_000_000)throw threadError('Thread file limit reached');const hash=this.putObject(bytes);return this.mutate(id,operation,doc=>{doc.artifacts.push({id:operation,name,...(path!==undefined?{path}:{}),digest:hash,size:bytes.length,authorId,createdAt:now()});});}
  import(doc,authority,{staged=false}={}) {
    this.validate(doc);
    if(doc.shared!==true)throw threadError('A shared snapshot must retain its directory authority');
    if(doc.ownerClientId!==authority.owner_client_id||doc.ownerUserId!==authority.owner_user_id||doc.epoch!==Number(authority.epoch))throw threadError('Snapshot is from a stale owner',409);
    const old=this.db.prepare('SELECT revision,document,staged FROM threads WHERE id=?').get(doc.id);
    if(old){const prior=JSON.parse(old.document);if(prior.epoch>doc.epoch||prior.epoch===doc.epoch&&old.revision>doc.revision)return prior;if(prior.epoch===doc.epoch&&old.revision===doc.revision&&old.document!==canonical(doc))throw threadError('Conflicting thread snapshot',409);}
    return this.save(doc,staged);
  }
  prepareTransfer(id){const doc=this.get(id);this.writable(doc);if(doc.runs.some(r=>['running','waiting'].includes(r.status)))throw threadError('Stop or finish active work before transferring',409);this.preference(`frozen:${id}`,true);const document=this.document(id);return {document,digest:checkpointDigest(document)};}
  activateTransfer(id,authority,expected){const doc=this.document(id);if(checkpointDigest(doc)!==expected)throw threadError('Transfer checkpoint changed',409);for(const a of doc.artifacts)this.object(doc,a.id);if(authority.owner_client_id!==this.clientId||Number(authority.epoch)!==doc.epoch+1)throw threadError('Transfer has not been accepted',409);return this.save({...doc,ownerClientId:this.clientId,ownerUserId:authority.owner_user_id,epoch:Number(authority.epoch),revision:doc.revision+1,updatedAt:now()});}
}
