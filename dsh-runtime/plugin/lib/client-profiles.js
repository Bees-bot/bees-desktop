import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync,renameSync } from 'node:fs';
import { join } from 'node:path';
import { ThreadClient } from './thread-client.js';
import { threadError } from './thread-store.js';

/** Account content and peer credentials never share a client database. AI connections belong to this machine. */
export class ClientProfiles {
  constructor(root,options={}){this.root=root;this.options=options;this.clients=new Map();mkdirSync(root,{recursive:true,mode:0o700});this.path=join(root,'accounts.json');this.state=existsSync(this.path)?JSON.parse(readFileSync(this.path,'utf8')):{anonymous:'personal',active:'personal',accounts:{}};}
  save(){const temporary=this.path+'.tmp';writeFileSync(temporary,JSON.stringify(this.state),{mode:0o600});renameSync(temporary,this.path);}
  async open(slot){if(!/^[a-zA-Z0-9-]+$/.test(slot))throw threadError('Invalid client profile');if(!this.clients.has(slot))this.clients.set(slot,await new ThreadClient(join(this.root,slot),this.options).start());return this.clients.get(slot);}
  async start(){this.active=await this.open(this.state.active);if(this.active.directory.user){const key=this.key(this.active.directory.url,this.active.directory.user.id);this.state.accounts[key]=this.state.active;this.save();}return this;}
  key(url,user){return createHash('sha256').update(url+'\n'+user).digest('hex');}
  async login(input){
    const signed=await this.active.directory.signIn(input);
    const response=await fetch(signed.url+'/api/me',{headers:{authorization:'Bearer '+signed.session},signal:AbortSignal.timeout(20000)});if(!response.ok)throw threadError('Sign in again',401);const {user}=await response.json();
    const key=this.key(signed.url,user.id);
    const slot=this.state.accounts[key]??(!this.active.directory.user&&!Object.values(this.state.accounts).includes(this.state.active)?this.state.active:key);
    const client=await this.open(slot);client.directory.url=signed.url;await client.directory.resume(signed.session,client.identity.cert,client.peer.endpoints);await client.refresh();
    this.state.accounts[key]=slot;this.state.active=slot;this.active=client;this.save();return user;
  }
  async logout(){const prior=this.state.active,client=this.active;if(Object.values(this.state.accounts).includes(this.state.anonymous))this.state.anonymous='personal-'+randomUUID();this.state.active=this.state.anonymous;this.active=await this.open(this.state.active);this.save();
    // a signed-out account must not keep syncing, serving peers or running its schedules
    if(prior!==this.state.active){this.clients.delete(prior);client.directory.token=null;client.directory.save();await client.close();}return {ok:true};}
  async command(input){if(input.action==='resumeSession'){const user=await this.active.directory.resume(input.session,this.active.identity.cert,this.active.peer.endpoints);await this.active.refresh();return user;}if(input.action==='login')return this.login(input);if(input.action==='logout')return this.logout();return this.active.command(input);}
  async close(){await Promise.all([...this.clients.values()].map(c=>c.close()));}
}
