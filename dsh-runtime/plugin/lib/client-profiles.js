import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync,renameSync } from 'node:fs';
import { join } from 'node:path';
import { ThreadClient } from './thread-client.js';
import { threadError } from './thread-store.js';
import { authConfig, desktopSignIn, serverOrigin } from './thread-auth.js';

/** Account content and peer credentials never share a client database. User-added AI connections belong to this machine. */
export class ClientProfiles {
  constructor(root,options={}){this.root=root;this.options=options;this.clients=new Map();mkdirSync(root,{recursive:true,mode:0o700});this.path=join(root,'accounts.json');this.state=existsSync(this.path)?JSON.parse(readFileSync(this.path,'utf8')):{anonymous:'personal',active:'personal',accounts:{},onboarding:null};}
  save(){if(this.active){this.state.servers??={};this.state.servers[this.active.directory.url]=this.state.active;}const temporary=this.path+'.tmp';writeFileSync(temporary,JSON.stringify(this.state),{mode:0o600});renameSync(temporary,this.path);}
  async open(slot){if(!/^[a-zA-Z0-9-]+$/.test(slot))throw threadError('Invalid client profile');if(!this.clients.has(slot))this.clients.set(slot,await new ThreadClient(join(this.root,slot),this.options).start());return this.clients.get(slot);}
  savedDirectory(slot){if(!/^[a-zA-Z0-9-]+$/.test(slot))throw threadError('Invalid client profile');const path=join(this.root,slot,'directory.json');return this.clients.get(slot)?.directory??(existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{});}
  accounts(){return Object.entries(this.state.accounts).flatMap(([id,slot])=>{const directory=this.savedDirectory(slot);return directory.token&&directory.user&&(!this.configuredServer||directory.url===this.configuredServer)?[{id,user:directory.user,url:directory.url,active:slot===this.state.active}]:[];}).sort((a,b)=>(a.user.email??'').localeCompare(b.user.email??''));}
  async snapshot(){return {...await this.active.snapshot(),onboarding:this.state.onboarding===undefined?'existing':this.state.onboarding,localActive:this.state.active===this.state.anonymous,localOrganizations:this.clients.get(this.state.anonymous)?.organizations().filter(org=>org.local)??[],folders:this.options.folders?.snapshot(this.active.store,this.active.organizations()),accounts:this.accounts().map(account=>{const client=this.clients.get(this.state.accounts[account.id]);return {...account,organizations:client?.organizations()??[],organizationError:client?.organizationError??null};})};}
  async start(){
    const url=this.configuredServer=process.env.BEES_ACCOUNT_API_URL&&serverOrigin(process.env.BEES_ACCOUNT_API_URL);
    this.state.servers??={};const prior=this.savedDirectory(this.state.active);if(prior.url)this.state.servers[prior.url]=this.state.active;
    if(url&&this.savedDirectory(this.state.active).url&&this.savedDirectory(this.state.active).url!==url){
      this.state.active=this.state.servers[url]??Object.values(this.state.accounts).find(slot=>{const d=this.savedDirectory(slot);return d.url===url&&d.token;})??'personal-'+this.key(url,'anonymous');
      if(!Object.values(this.state.accounts).includes(this.state.active))this.state.anonymous=this.state.active;
    }
    if(url&&this.savedDirectory(this.state.anonymous).url&&this.savedDirectory(this.state.anonymous).url!==url)this.state.anonymous='personal-'+this.key(url,'anonymous');
    this.active=await this.open(this.state.active);this.active.directory.save();if(this.active.directory.user&&this.active.directory.token){const key=this.key(this.active.directory.url,this.active.directory.user.id);this.state.accounts[key]=this.state.active;}await Promise.all(this.accounts().map(account=>this.state.accounts[account.id]).filter(slot=>slot!==this.state.active).map(slot=>this.open(slot)));if(!process.env.BEES_HOSTED_CLIENT)await this.open(this.state.anonymous);this.save();return this;
  }
  key(url,user){return createHash('sha256').update(url+'\n'+user).digest('hex');}
  async login(input){
    const signed=await this.active.directory.signIn(input);
    const response=await fetch(signed.url+'/api/me',{headers:{authorization:'Bearer '+signed.session},signal:AbortSignal.timeout(20000)});const user=response.ok&&(await response.json().catch(()=>({}))).user;if(!user)throw response.status===401?threadError('Sign in again',401):threadError("Bees can't be reached right now.",502);
    const key=this.key(signed.url,user.id);
    const slot=this.state.accounts[key]??(!this.active.directory.user&&!Object.values(this.state.accounts).includes(this.state.active)&&!this.active.organizations().some(org=>org.local)?this.state.active:key);
    const client=await this.open(slot);client.directory.url=signed.url;await client.directory.resume(signed.session,client.identity.cert,client.peer.endpoints);await client.refresh();
    this.state.accounts[key]=slot;this.state.active=slot;this.active=client;this.save();return user;
  }
  async logout(){const prior=this.state.active,client=this.active;
    if(this.savedDirectory(this.state.anonymous).url&&this.savedDirectory(this.state.anonymous).url!==client.directory.url)this.state.anonymous='personal-'+this.key(client.directory.url,'anonymous');
    if(Object.values(this.state.accounts).includes(this.state.anonymous))this.state.anonymous='personal-'+randomUUID();this.state.active=this.state.anonymous;this.active=await this.open(this.state.active);
    this.active.directory.url=client.directory.url;this.active.directory.save();this.save();
    // Signed-out accounts must stop syncing, serving peers, and running schedules.
    if(prior!==this.state.active){this.clients.delete(prior);client.directory.token=null;client.directory.save();await client.close();}return {ok:true};}
  async settingsClient(accountId){
    const account=this.accounts().find(account=>account.id===accountId);
    if(accountId!=null&&!account)throw threadError('Sign in to this account again',401);
    return this.open(account?this.state.accounts[account.id]:process.env.BEES_HOSTED_CLIENT?this.state.active:this.state.anonymous);
  }
  async command(input){
    if(input.action==='createLocalOrganization'){
      if(process.env.BEES_HOSTED_CLIENT)throw threadError('Open Bees Desktop to create a local organization');
      if(this.savedDirectory(this.state.anonymous).user||Object.values(this.state.accounts).includes(this.state.anonymous)){this.state.anonymous='personal-'+randomUUID();this.save();}
      return (await this.settingsClient(null)).command(input);
    }
    if(input.action==='settingsSnapshot'||Object.hasOwn(input,'settingsAccountId')){
      const client=await this.settingsClient(input.settingsAccountId);
      if(input.action==='settingsSnapshot')return {...await client.snapshot(),folders:this.options.folders?.snapshot(client.store,client.organizations())};
      if(input.action==='setRootFolder'){
        if(!this.options.folders)throw threadError('Folder settings are unavailable');
        return this.options.folders.set(input.directory,[...this.clients.values()],client,input.organizationId);
      }
      const {settingsAccountId,...request}=input;
      return client.command(request);
    }
    if(input.action==='completeOnboarding'){
      if(input.mode==='local'){
        if(process.env.BEES_HOSTED_CLIENT)throw threadError('Open Bees Desktop to use models running on your computer');
        if(this.savedDirectory(this.state.anonymous).user||Object.values(this.state.accounts).includes(this.state.anonymous))this.state.anonymous='personal-'+randomUUID();
        await this.command({action:'selectOrganization',accountId:null,organizationId:null});
      }else if(input.mode==='cloud'){
        if(!this.active.directory.user||!this.active.directory.token)throw threadError('Sign in to create an organization',401);
        const org=input.organizationId?this.active.organizations().find(org=>org.id===input.organizationId):await this.active.command({action:'createOrganization',name:input.name});
        if(!org)throw threadError('Organization membership required',403);
        await this.active.command({action:'organizations'});
        await this.active.command({action:'preferences',values:{selectedOrganizationId:org.id}});
      }else throw threadError('Choose a Bees or local organization');
      this.state.onboarding=input.mode;this.save();return {ok:true};
    }
    if(input.action==='setRootFolder'){
      if(!this.options.folders)throw threadError('Folder settings are unavailable');
      return this.options.folders.set(input.directory,[...this.clients.values()],this.active,input.organizationId);
    }
    if(input.action==='switchAccount'||input.action==='selectOrganization'){
      const account=this.accounts().find(account=>account.id===input.accountId);
      if(!account&&!(input.action==='selectOrganization'&&input.accountId==null))throw threadError('Sign in to this account again',401);
      const slot=account?this.state.accounts[account.id]:process.env.BEES_HOSTED_CLIENT?this.state.active:this.state.anonymous,client=await this.open(slot);
      if(input.action==='selectOrganization'){
        const organizationId=input.organizationId??null;
        if(organizationId&&!client.organizations().some(org=>org.id===organizationId))throw threadError('Organization membership required',403);
        await client.command({action:'preferences',values:{selectedOrganizationId:organizationId}});
      }
      this.state.active=slot;this.active=client;this.save();return {ok:true};
    }
    if(input.action==='authConfig')return authConfig(input.url??this.active.directory.url);
    if(input.action==='startLogin'){
      if(process.env.BEES_HOSTED_CLIENT)throw threadError('Sign in through Bees Cloud');
      this.pendingLogin?.close();
      const url=serverOrigin(input.url??this.active.directory.url);
      await authConfig(url);
      this.pendingLogin=await desktopSignIn(url,input,session=>this.login({url,session}));
      return {id:this.pendingLogin.id,url:this.pendingLogin.url};
    }
    if(input.action==='cancelLogin'){if(this.pendingLogin?.id===input.id){this.pendingLogin.close();this.pendingLogin=null;}return {ok:true};}
    if(input.action==='finishLogin'){
      const pending=this.pendingLogin;if(!pending||pending.id!==input.id)throw threadError('Sign-in attempt expired');
      const result=pending.result;
      if(!result)return {pending:true};
      this.pendingLogin=null;if(result.error)throw threadError(result.error);
      return result.user;
    }
    if(input.action==='resumeSession'){const user=await this.active.directory.resume(input.session,this.active.identity.cert,this.active.peer.endpoints);await this.active.refresh();return user;}
    if(input.action==='login')return this.login(input);if(input.action==='logout')return this.logout();return this.active.command(input);
  }
  async close(){this.pendingLogin?.close();await Promise.all([...this.clients.values()].map(c=>c.close()));}
}
