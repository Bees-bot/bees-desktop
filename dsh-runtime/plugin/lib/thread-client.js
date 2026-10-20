import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { ThreadStore, checkpointDigest, canonical, threadError, text, validId } from './thread-store.js';
import { ThreadPeer, peerCertificate } from './thread-peer.js';
import { schedule, nextOccurrence } from './thread-schedule.js';
import { THEME_PRESETS } from './themes.js';
import { DEFAULT_WORKFLOW, WORKFLOW_TEMPLATES, workflowFor, workflowTemplate, isValidWorkflow } from './thread-workflow.js';
import { normalizeThreadLayout } from './thread-layout.js';
import { authConfig, serverOrigin } from './thread-auth.js';

export class DirectoryConnection {
  constructor(root,clientId){this.path=join(root,'directory.json');this.clientId=clientId;this.stop=new AbortController();if(existsSync(this.path))Object.assign(this,JSON.parse(readFileSync(this.path,'utf8')));this.url??=process.env.BEES_ACCOUNT_API_URL??'https://app.bees.bot';}
  save(){writeFileSync(this.path,JSON.stringify({url:this.url,token:this.token,user:this.user}),{mode:0o600});}
  async request(path,body,method=body===undefined?'GET':'POST'){
    const result=await fetch(this.url+'/api/directory'+(path==='/'?'':path),{method,headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.any([this.stop.signal,AbortSignal.timeout(20000)])}).catch(e=>{throw this.stop.signal.aborted?e:threadError("Bees can't be reached right now.",502);});
    const value=await (result.ok?result.json():result.json().catch(()=>({})));if(!result.ok)throw threadError(value.error?.message??'Bees Server could not complete the request',result.status);return value;
  }
  async signIn({url,email,password,name,session}){
    const server=new URL(serverOrigin(url??this.url));
    await authConfig(server.origin);
    if(session)return {url:server.origin,session:text(session,8192)};
    const response=await fetch(server.origin+'/api/auth/'+(name?'sign-up/email':'sign-in/email'),{method:'POST',headers:{'content-type':'application/json',origin:server.origin},body:JSON.stringify({email,password,...(name?{name}:{})}),signal:AbortSignal.timeout(20000)});
    const value=await response.json();if(!response.ok)throw threadError(value.message??'Sign in failed',response.status);
    return {url:server.origin,session:response.headers.get('set-auth-token')??value.token};
  }
  async login(input,certificate,endpoints){const signed=await this.signIn(input);const prior=this.url;this.url=signed.url;try{return await this.resume(signed.session,certificate,endpoints);}catch(e){this.url=prior;throw e;}}
  async resume(session,certificate,endpoints){
    const headers={authorization:`Bearer ${session}`,'content-type':'application/json'};
    const me=await fetch(this.url+'/api/me',{headers,signal:AbortSignal.timeout(20000)});if(!me.ok)throw threadError('Sign in again',401);
    const user=(await me.json()).user;
    if(this.user&&this.user.id!==user.id)throw threadError('Use a separate client data directory for another account',409);
    const response=await fetch(this.url+'/api/directory/clients',{method:'POST',headers,body:JSON.stringify({id:this.clientId,name:process.env.BEES_CLIENT_NAME??hostname(),certificate,endpoints}),signal:AbortSignal.timeout(20000)});
    const value=await response.json();if(!response.ok)throw threadError(value.error?.message??'Client enrollment failed',response.status);
    this.token=value.token;this.user=user;this.save();return user;
  }
}

export class ThreadClient {
  constructor(root,options={}) {
    mkdirSync(root,{recursive:true,mode:0o700});const idPath=join(root,'client-id');
    if(!existsSync(idPath))writeFileSync(idPath,randomUUID(),{flag:'wx',mode:0o600});
    this.store=new ThreadStore(root,readFileSync(idPath,'utf8').trim());
    this.directory=new DirectoryConnection(root,this.store.clientId);this.jobs=new Map();this.finishing=new Set();this.options=options;
    if(!this.store.preference('defaultTeam'))this.store.preference('defaultTeam',this.store.create('Default',this.directory.user?.id??'local',DEFAULT_WORKFLOW,undefined,'team').id);
    for(const row of this.store.list())if(row.kind!=='team'&&!row.teamId)this.store.preference(`team:${row.id}`,this.store.preference('defaultTeam'));
    this.roster={threads:[],participants:[],clients:[],invitations:[]};
  }
  async start(){this.identity=await peerCertificate(this.store.root);this.peer=await new ThreadPeer(this.directory,this.identity,(grant,input)=>this.receive(grant,input)).start();if(process.env.BEES_THREAD_SESSION&&!this.directory.token)await this.directory.resume(process.env.BEES_THREAD_SESSION,this.identity.cert,this.peer.endpoints);delete process.env.BEES_THREAD_SESSION;this.timer=setInterval(()=>{void this.refresh().then(()=>this.replicate()).catch(e=>{this.connectionError=e.message;});void this.scheduled();},5000);this.timer.unref();if(this.directory.token)await this.refresh().catch(e=>{this.connectionError=e.message;});return this;}
  async refresh(){if(!this.directory.token||this.closing)return;const heartbeat=await this.directory.request('/heartbeat',{endpoints:this.peer.endpoints});if(heartbeat.user)this.directory.user=heartbeat.user;
    // a thread shared while the roster was in flight is missing from it, so only judge threads shared before the fetch
    const sharedBefore=new Set(this.store.list().filter(t=>t.shared).map(t=>t.id));this.roster=await this.directory.request('/');if(this.closing)return;this.connectionError=null;
    for(const local of this.store.list())if(sharedBefore.has(local.id)&&!this.roster.threads.some(t=>t.id===local.id)){this.store.preference(`frozen:${local.id}`,true);this.jobs.get(local.id)?.abort();}
    for(const authority of this.roster.threads){const local=this.store.list().find(t=>t.id===authority.id);if(local?.ownerClientId===this.store.clientId&&authority.owner_client_id!==this.store.clientId){this.store.preference(`frozen:${authority.id}`,true);this.jobs.get(authority.id)?.abort();}if(local?.staged&&authority.owner_client_id===this.store.clientId){const doc=this.store.document(local.id);this.store.activateTransfer(local.id,authority,checkpointDigest(doc));this.store.preference(`frozen:${local.id}`,false);}}
    this.options.notify?.();
  }
  async authority(id){await this.refresh();const t=this.roster.threads.find(t=>t.id===id);if(!t)throw threadError('Thread access is unavailable',403);return t;}
  async fence(id){const doc=this.store.get(id);this.store.writable(doc);if(doc.shared){const t=await this.authority(id);if(t.owner_client_id!==this.store.clientId||Number(t.epoch)!==doc.epoch)throw threadError('This client no longer owns the thread',409);}return doc;}
  async snapshot(){const rows=this.store.list();return {product:'Bees Client',clientId:this.store.clientId,user:this.directory.user??null,serverUrl:this.directory.url,connectionError:this.connectionError??null,threads:rows.filter(t=>t.kind!=='team'),teams:rows.filter(t=>t.kind==='team'&&(!t.shared||!this.directory.token||this.connectionError||this.roster.threads.some(row=>row.id===t.id))),defaultTeamId:this.store.preference('defaultTeam'),directory:this.roster,models:await this.options.models?.()??[],defaultModel:this.store.preference('model'),settings:this.store.preference('settings')??{}};}
  async registerThread(id,input={}){await this.fence(id);let doc=this.store.document(id);if(!this.directory.token)throw threadError('Sign in to share or transfer a thread',401);
    const team=this.store.teamFor(id);
    if(team&&!team.shared)await this.registerThread(team.id);
    if(!doc.shared){const authority=await this.directory.request('/threads',{id:doc.id,clientId:this.store.clientId,kind:doc.kind??'thread',...(team?{teamId:team.id}:{}),...((input.organizationId??doc.organizationId)?{organizationId:input.organizationId??doc.organizationId}:{})});doc=this.store.mutate(id,randomUUID(),d=>{d.ownerUserId=this.directory.user.id;d.epoch=Number(authority.epoch);d.shared=true;if(team)d.teamId=team.id;});}
    else if(team&&!doc.teamId){await this.directory.request(`/threads/${id}/team`,{teamId:team.id});doc=this.store.mutate(id,randomUUID(),d=>{d.teamId=team.id;});}
    return doc;
  }
  async share(id,input){await this.registerThread(id,input);
    if(this.store.get(id).kind==='team')for(const row of this.store.list())if(row.teamId===id&&row.ownerClientId===this.store.clientId)await this.registerThread(row.id);
    const invite=await this.directory.request(`/threads/${id}/invitations`,{email:input.email,role:input.role??'editor'});await this.refresh();return {...invite,url:this.directory.url+'/app?invitation='+invite.id};
  }
  async receive(grant,input){
    if(!input||!['snapshot','object','command','checkpoint'].includes(input.kind))throw threadError('Invalid peer operation');
    const id=grant.thread_id;
    if(input.kind==='snapshot'||input.kind==='object'){
      const doc=this.store.document(id);if(doc.epoch!==Number(grant.epoch))throw threadError('Stale thread replica',409);
      if(input.kind==='snapshot')return doc;
      const {artifact,bytes}=this.store.object(doc,input.artifactId);return {artifact,content:bytes.toString('base64')};
    }
    if(input.kind==='checkpoint'){
      const authority=await this.authority(id);
      if(grant.source_client_id!==authority.owner_client_id||authority.transfer_client_id!==this.store.clientId||input.document.id!==id||checkpointDigest(input.document)!==authority.transfer_digest)throw threadError('Invalid transfer checkpoint',403);
      this.store.import(input.document,authority,{staged:true});return {received:true,digest:checkpointDigest(input.document)};
    }
    if(!['owner','editor'].includes(grant.source_role))throw threadError('This participant can only view the thread',403);
    if(['share','remove'].includes(input.command?.action)){
      if(this.store.document(id).ownerUserId!==grant.source_user_id)throw threadError('Only the thread owner may change participants',403);
      return this.command({...input.command,threadId:id});
    }
    return this.localCommand(id,input.command,grant.source_user_id);
  }
  async sync(id){return this.syncAuthority(await this.authority(id));}
  async syncAuthority(authority){const id=authority.id;if(authority.owner_client_id===this.store.clientId)return this.store.document(id);
    if(authority.team_id){const team=this.roster.threads.find(t=>t.id===authority.team_id);if(team)await this.syncAuthority(team);}
    const local=this.store.list().find(t=>t.id===id);if(local?.staged&&authority.transfer_client_id===this.store.clientId&&checkpointDigest(this.store.document(id))===authority.transfer_digest)return this.store.document(id);
    // both stamps are server time, so a wrong laptop clock can't make an online owner look offline
    const seen=c=>Date.parse(this.roster.clients?.find(x=>x.id===c)?.last_seen_at);if(seen(this.store.clientId)-seen(authority.owner_client_id)>30000)throw threadError("The owner's laptop can't be reached right now.",408);
    const doc=await this.peer.send(id,authority.owner_client_id,{kind:'snapshot'});
    if(this.closing)throw threadError('Client is stopping');
    const imported=this.store.import(doc,authority);
    await this.files(imported,authority.owner_client_id);return imported;
  }
  async replicate(){if(this.replicating||!this.directory.token||this.closing)return;this.replicating=true;try{for(const t of this.roster.threads){if(this.closing)break;if(t.owner_client_id===this.store.clientId)continue;try{await this.syncAuthority(t);}catch{/* An offline owner keeps the last authorized copy available. */}}}finally{this.replicating=false;}}
  async files(doc,source){for(const a of doc.artifacts){try{this.store.object(doc,a.id);continue;}catch{}const object=await this.peer.send(doc.id,source,{kind:'object',artifactId:a.id});if(object.artifact.digest!==a.digest||object.artifact.size!==a.size)throw threadError('File manifest changed');const bytes=Buffer.from(object.content,'base64');if(bytes.length!==a.size)throw threadError('Incomplete file transfer');this.store.putObject(bytes,a.digest);}}
  ensureOrganizationTeam(organization){
    const key=`organizationDefault:${validId(organization.id)}`;
    if(this.store.preference(key))return this.store.preference(key);
    const existing=this.store.list().find(t=>t.kind==='team'&&t.organizationId===organization.id)
      ??this.roster.threads.find(t=>t.kind==='team'&&t.organization_id===organization.id);
    const team=existing??this.store.create('Default',this.directory.user?.id??'local',DEFAULT_WORKFLOW,undefined,'team',{organizationId:organization.id});
    this.store.preference(key,team.id);return team.id;
  }
  async command(input){
    if(input.action==='createTeam'){
      const name=text(input.name,180),organizationId=input.organizationId===undefined?undefined:validId(input.organizationId);
      if(organizationId){const {organizations}=await this.directory.request('/organizations');if(!organizations.some(o=>o.id===organizationId))throw threadError('Organization membership required',403);}
      const doc=this.store.create(name,this.directory.user?.id??'local',DEFAULT_WORKFLOW,undefined,'team',{organizationId});
      this.options.notify?.();return doc;
    }
    if(input.action==='create'){
      const team=this.store.get(input.teamId??this.store.preference('defaultTeam'));
      if(team.kind!=='team')throw threadError('Choose a team');
      if(team.shared){const authority=await this.authority(team.id);const role=this.roster.participants.find(p=>p.thread_id===team.id&&p.user_id===this.directory.user?.id)?.role;if(!['owner','editor'].includes(role))throw threadError('Team editor access required',403);if(authority.kind!=='team')throw threadError('Team unavailable',409);}
      const configuration=team.shared?await this.syncAuthority(this.roster.threads.find(t=>t.id===team.id)):team;
      const template=[...WORKFLOW_TEMPLATES,...(configuration.processes??[])].find(t=>t.id===(input.templateId??'goals'));
      if(!template)throw threadError('Choose a valid thread template');
      const doc=this.store.create(input.title??'New thread',this.directory.user?.id??'local',template.workflow,team.id,'thread',{processId:input.templateId?template.id:undefined});
      try{if(team.shared)await this.registerThread(doc.id);}catch(e){this.store.db.prepare('DELETE FROM threads WHERE id=?').run(doc.id);throw e;}
      this.options.notify?.();return doc;
    }
    if(input.action==='login'){const result=await this.directory.login(input,this.identity.cert,this.peer.endpoints);await this.refresh();return result;}
    if(input.action==='logout'){this.directory.token=null;this.directory.save();this.roster={threads:[],participants:[],clients:[],invitations:[]};return {ok:true};}
    if(input.action==='model'){this.store.preference('model',input.model);return {ok:true};}
    if(input.action==='preferences'){
      const values=input.values;
      if(!values||typeof values!=='object'||Array.isArray(values))throw threadError('Invalid preferences');
      for(const [key,value] of Object.entries(values)){
        if(key==='systemInstructions'){if(typeof value!=='string'||value.length>20000)throw threadError('Keep system instructions under 20,000 characters');}
        else if(key==='colorMode'){if(!['dark','light'].includes(value))throw threadError('Invalid color mode');}
        else if(['themePreset','darkThemePreset','lightThemePreset'].includes(key)){
          const theme=THEME_PRESETS.find(t=>t.id===value);
          if(!theme||key==='darkThemePreset'&&!theme.dark||key==='lightThemePreset'&&theme.dark)throw threadError('Invalid theme');
        }else if(key==='selectedOrganizationId'){
          if(value!==null)validId(value);
        }else if(key==='threadLayout'){
          const layout=normalizeThreadLayout(value);
          if(!layout)throw threadError('Invalid thread layout');
          values[key]=layout;
        }else throw threadError('Unknown preference');
      }
      return this.store.preference('settings',{...this.store.preference('settings'),...values});
    }
    if(input.action==='organizations'){const result=await this.directory.request('/organizations');for(const org of result.organizations)if(org.role==='owner')this.ensureOrganizationTeam(org);return result;}
    if(input.action==='createOrganization'){const org=await this.directory.request('/organizations',{name:input.name});this.ensureOrganizationTeam(org);this.options.notify?.();return org;}
    if(input.action==='organizationMembers')return this.directory.request(`/organizations/${validId(input.organizationId)}/members`);
    if(input.action==='inviteOrganization')return this.directory.request(`/organizations/${validId(input.organizationId)}/invitations`,{email:input.email,role:input.role??'member'});
    if(input.action==='removeOrganizationMember')return this.directory.request(`/organizations/${validId(input.organizationId)}/members/${encodeURIComponent(input.userId)}`,{},'DELETE');
    if(input.action==='acceptOrganization')return this.directory.request(`/organization-invitations/${validId(input.invitationId)}/accept`,{});
    if(input.action==='verifyEmail'){const r=await fetch(this.directory.url+'/api/auth/send-verification-email',{method:'POST',headers:{'content-type':'application/json',origin:this.directory.url},body:JSON.stringify({email:this.directory.user.email,callbackURL:this.directory.url+'/app'}),signal:AbortSignal.timeout(20000)});if(!r.ok)throw threadError('Could not send verification email');return {ok:true};}
    if(input.action==='acceptInvitation'){const result=await this.directory.request('/invitations/'+validId(input.invitationId)+'/accept',{});await this.refresh();return result;}
    const id=validId(input.threadId);
    if(['integrations','saveIntegration','toggleIntegration','removeIntegration','setBrowser','openBrowser','connectGoogle'].includes(input.action)){
      const doc=this.store.get(id);
      if(doc.kind==='team'){
        if(doc.shared){await this.authority(id);const role=this.roster.participants.find(p=>p.thread_id===id&&p.user_id===this.directory.user?.id)?.role;if(!['owner','editor'].includes(role))throw threadError('Team editor access required',403);}
      }else{
        await this.fence(id);
        if(doc.shared&&doc.ownerUserId!==this.directory.user?.id)throw threadError('Only the thread owner may manage integrations',403);
      }
      if(!this.options.integrations)throw threadError('Integrations are unavailable on this client');
      return this.options.integrations.command(this.store,id,input);
    }
    if(input.action==='read'){
      let doc;
      try{doc=await this.sync(id);}catch(e){doc=this.store.get(id);if(doc.ownerClientId!==this.store.clientId||doc.shared)doc.unavailable=e.status===403?'You no longer have access to this thread.':e.status===502?"Bees can't be reached right now.":!e.status||e.status===408?"The owner's laptop can't be reached right now.":e.message;}
      await this.options.recoverActivity?.(this.store,doc);
      return {...this.store.get(id),teamId:doc.teamId??this.store.preference(`team:${id}`),...(doc.unavailable?{unavailable:doc.unavailable}:{}),frozen:doc.ownerClientId===this.store.clientId&&!!this.store.preference(`frozen:${id}`)};
    }
    if(['share','remove'].includes(input.action)){const authority=await this.authority(id).catch(e=>{if(this.store.get(id).shared)throw e;return null;});if(authority&&authority.owner_client_id!==this.store.clientId)return this.peer.send(id,authority.owner_client_id,{kind:'command',command:input});}
    if(input.action==='share')return this.share(id,input);
    if(input.action==='remove'){await this.fence(id);await this.directory.request(`/threads/${id}/participants/${encodeURIComponent(input.userId)}`,{},'DELETE');const authority=await this.authority(id);this.store.mutate(id,randomUUID(),d=>{d.epoch=Number(authority.epoch);});return this.store.document(id);}
    if(input.action==='transfer'){
      const frozen=this.store.preference(`frozen:${id}`);
      if(!frozen)await this.registerThread(id);
      const checkpoint=frozen?{document:this.store.document(id),digest:checkpointDigest(this.store.document(id))}:this.store.prepareTransfer(id);
      try{await this.directory.request(`/threads/${id}/transfer`,{targetClientId:input.targetClientId,epoch:checkpoint.document.epoch,digest:checkpoint.digest});await this.peer.send(id,input.targetClientId,{kind:'checkpoint',document:checkpoint.document});await this.refresh();return {offered:true};}
      catch(e){throw threadError('Transfer is pending. Keep this client running and retry delivery. '+e.message,409);}
    }
    if(input.action==='cancelTransfer'){await this.directory.request(`/threads/${id}/transfer/cancel`,{});this.store.preference(`frozen:${id}`,false);await this.refresh();return this.store.document(id);}
    if(input.action==='acceptTransfer'){
      const authority=await this.authority(id);const doc=this.store.document(id);
      if(!doc.staged&&!this.store.get(id).staged)throw threadError('Wait for the source client to deliver the checkpoint',409);
      if(checkpointDigest(doc)!==authority.transfer_digest)throw threadError('Checkpoint verification failed');
      await this.files(doc,authority.owner_client_id);
      const accepted=await this.directory.request(`/threads/${id}/transfer/accept`,{epoch:doc.epoch,digest:authority.transfer_digest});
      const result=this.store.activateTransfer(id,accepted,authority.transfer_digest);this.store.preference(`frozen:${id}`,false);await this.refresh();return result;
    }
    const authority=this.roster.threads.find(t=>t.id===id);const local=this.store.list().find(t=>t.id===id);
    if(authority&&authority.owner_client_id!==this.store.clientId)return this.peer.send(id,authority.owner_client_id,{kind:'command',command:input});
    if(!local)throw threadError('Thread unavailable',404);
    return this.localCommand(id,input,this.directory.user?.id??'local');
  }
  async localCommand(id,input,actor){
    await this.fence(id);validId(input.operationId);
    let result;
    if(input.action==='message'||input.action==='discussion')result=this.store.message(id,input.operationId,input.text,actor,input.action==='discussion'?'discussion':'user');
    else if(input.action==='attach'){const bytes=typeof input.content==='string'&&input.content.length<=13_333_336?Buffer.from(input.content,'base64'):null;if(!bytes||bytes.toString('base64')!==input.content)throw threadError('Invalid attachment');result=this.store.attach(id,input.operationId,input.name,bytes,actor,input.path);}
    else if(input.action==='folder')result=this.store.mutate(id,input.operationId,d=>{d.folders??=[];if(!d.folders.includes(input.path))d.folders.push(input.path);});
    else if(input.action==='configure'){
      const doc=this.store.document(id);if(doc.shared&&actor!==doc.ownerUserId)throw threadError('Only the thread owner may configure execution',403);
      const workflow=input.workflow??doc.workflow??DEFAULT_WORKFLOW;
      if(!isValidWorkflow(workflow))throw threadError('Invalid workflow stages');
      if(input.processId!==undefined){const process=[...WORKFLOW_TEMPLATES,...(this.store.teamFor(id)?.processes??[])].find(p=>p.id===input.processId);if(doc.kind==='team'||!process||canonical(process.workflow)!==canonical(workflow))throw threadError('Choose a valid team process');}
      if(input.memory!==undefined&&(!Array.isArray(input.memory)||input.memory.length>100||input.memory.some(m=>typeof m!=='string'||m.length>10000)))throw threadError('Invalid thread memory');
      // Preserve the next occurrence when an unchanged schedule is saved.
      const fresh=input.schedule===undefined?undefined:schedule(input.schedule),same=s=>s&&checkpointDigest({...s,nextAt:0,error:0,attemptAt:0});
      const recurrence=fresh===undefined||same(fresh)===same(doc.schedule)?doc.schedule:fresh;
      result=this.store.mutate(id,input.operationId,d=>{if(input.processes!==undefined)d.processes=input.processes;if(input.workflow!==undefined&&d.kind!=='team')d.processId=input.processId??workflowTemplate(workflow)?.id??'custom';if(input.title!==undefined)d.title=text(input.title,180);if(input.instructions!==undefined){if(typeof input.instructions!=='string'||input.instructions.length>20000)throw threadError('Invalid instructions');d.instructions=input.instructions.trim();}d.workflow=workflow.map(s=>({name:s.name,kind:s.kind,...(s.model?{model:s.model}:{})}));if(input.workflow!==undefined&&d.kind==='team')d.workflowConfigured=true;if(input.memory!==undefined)d.memory=input.memory;d.schedule=recurrence;});
    }
    else if(input.action==='answer'){
      const pending=this.options.pending?.(input.questionId);const doc=this.store.document(id);
      if(!pending||pending.threadId!==id)throw threadError('This question is no longer waiting',409);
      if(pending.kind==='approval'&&doc.shared&&actor!==doc.ownerUserId)throw threadError('Only the thread owner may approve an external action',403);
      if(Buffer.byteLength(JSON.stringify(input.answers??{}))>64000)throw threadError('Keep the answer under 64 KB');
      this.options.answer(input.questionId,{...input,actorId:actor});result=this.store.document(id);
    }
    else if(input.action==='run'){
      const configuration=this.store.document(id);
      const teamAuthority=this.roster.threads.find(t=>t.id===configuration.teamId&&t.kind==='team');
      if(teamAuthority)await this.syncAuthority(teamAuthority);
      const team=this.store.teamFor(id);
      if(configuration.kind==='team')throw threadError('Start work in a thread');
      if(team?.shared)await this.authority(team.id);
      if(this.store.document(id).runs.some(r=>r.id===input.operationId))return this.store.document(id);
      if(this.jobs.has(id))throw threadError('Work is already running in this thread',409);
      const quota=Number(process.env.BEES_HOSTED_RUNS_PER_DAY??0),day=new Date().toISOString().slice(0,10);
      const admissions=this.store.preference('admissions:'+day)??[];if(quota&&admissions.length>=quota)throw threadError('Daily hosted workflow allowance reached. Use a local client or try again tomorrow.',429);
      const prompt=text(input.text);const run={id:input.operationId,prompt,status:'running',createdAt:new Date().toISOString(),model:this.store.preference('model'),instructions:[this.store.preference('settings')?.systemInstructions,team?.instructions,configuration.instructions].filter(Boolean).join('\n\n'),workflow:workflowFor(configuration,team)};
      result=this.store.mutate(id,input.operationId,doc=>{doc.runs.push(run);});
      if(!result.runs.some(r=>r.id===run.id))throw threadError('This operation identity was already used',409);
      if(quota)this.store.preference('admissions:'+day,[...admissions,run.id]);
      const abort=new AbortController();this.jobs.set(id,abort);
      const executionThread={...this.store.document(id),memory:[...(team?.memory??[]),...(configuration.memory??[])]};
      const finished=(async()=>{try{const output=await this.options.execute({thread:executionThread,team,run,signal:abort.signal,store:this.store});await this.fence(id);this.store.mutate(id,randomUUID(),doc=>{const r=doc.runs.find(r=>r.id===run.id);r.status='completed';r.completedAt=new Date().toISOString();doc.messages.push({id:randomUUID(),authorId:'bees',kind:'assistant',text:output||'Work completed.',createdAt:r.completedAt});});}catch(e){try{this.store.mutate(id,randomUUID(),doc=>{const r=doc.runs.find(r=>r.id===run.id);r.status=abort.signal.aborted?'cancelled':'failed';r.error=abort.signal.aborted?'Stopped before it finished.':e.message;});}catch(write){console.error(`Bees Client could not record the end of run ${run.id}: ${write.message}`);}}finally{this.jobs.delete(id);this.options.notify?.();}})();
      this.finishing.add(finished);void finished.finally(()=>this.finishing.delete(finished));
    } else if(input.action==='stop'){this.jobs.get(id)?.abort();result=this.store.document(id);}
    else throw threadError('Unknown thread command');
    this.options.notify?.();return result;
  }
  async scheduled(){
    if(this.scheduling||this.closing)return;this.scheduling=true;
    try{for(const row of this.store.list()){
      if(row.ownerClientId!==this.store.clientId||row.staged||this.jobs.has(row.id)||this.store.preference(`frozen:${row.id}`))continue;
      const doc=this.store.document(row.id),s=doc.schedule;if(!s?.enabled||Date.parse(s.nextAt)>Date.now()||Date.parse(s.attemptAt??0)>Date.now()-60000)continue;
      const hash=checkpointDigest({thread:row.id,occurrence:s.nextAt});const operationId=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
      try{
        let target=row.id;
        if(doc.kind==='team'){
          await this.fence(doc.id);
          const key=`scheduled-thread:${doc.id}:${s.nextAt}`;
          target=this.store.preference(key);
          if(!target){
            this.store.db.exec('BEGIN IMMEDIATE');
            try{target=this.store.create(s.prompt.slice(0,80),doc.ownerUserId,doc.workflow,doc.id).id;this.store.preference(key,target);this.store.db.exec('COMMIT');}catch(e){this.store.db.exec('ROLLBACK');throw e;}
          }
          if(doc.shared)await this.registerThread(target);
        }
        await this.localCommand(target,{action:'run',operationId,text:s.prompt},doc.ownerUserId);this.store.mutate(row.id,randomUUID(),d=>{d.schedule.nextAt=nextOccurrence(s,new Date()).toISOString();delete d.schedule.error;});}
      catch(e){try{this.store.mutate(row.id,randomUUID(),d=>{d.schedule.error=e.message;d.schedule.attemptAt=new Date().toISOString();});}catch{}}
    }}finally{this.scheduling=false;}
  }
  async close(){this.closing=true;clearInterval(this.timer);this.directory.stop.abort();for(const abort of this.jobs.values())abort.abort();await Promise.allSettled([...this.finishing]);await this.peer.close();this.store.close();}
}
