import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { authConfig, browserSignInUrl } from './plugin/lib/thread-auth.js';
import { kubernetesClients } from './hosted-kubernetes.mjs';
import { hostedClientActivity, isFreeClient } from './hosted-lifecycle.mjs';
const execute=promisify(execFile);
const hash=v=>createHash('sha256').update(v).digest('hex');
const json=(res,status,value,headers={})=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',...headers});res.end(JSON.stringify(value));};
async function body(req){const parts=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16_000_000)throw Error('Request too large');parts.push(chunk);}return Buffer.concat(parts);}

/** Each account receives an isolated container and a persistent volume, never a shared writable runtime. */
export function dockerClients({image,stateRoot,directoryUrl,maxClients=50,exec=execute}){
  if(!/^(?:.+@)?sha256:[a-f0-9]{64}$/.test(image??''))throw Error('BEES_CLIENT_IMAGE must be pinned to a reviewed image digest');
  const pending=new Map(),stopping=new Map();
  const provision=async(user,session)=>{
    const id=hash(directoryUrl+'\n'+user.id);if(stopping.has(id))await stopping.get(id);
    // a dead container keeps its cached promise and its port can go to another account, so check it still takes this token
    const cached=pending.get(id);if(cached){const client=await cached;try{if((await fetch(client.url+'/bees-api/active-runs',{headers:{authorization:'Bearer '+client.token},signal:AbortSignal.timeout(2000)})).ok)return client;}catch{}if(pending.get(id)===cached)pending.delete(id);if(pending.has(id))return pending.get(id);}
    if(pending.size>=maxClients)throw Error('Hosted client capacity reached');
    const started=(async()=>{
      await mkdir(stateRoot,{recursive:true,mode:0o700});const record=join(stateRoot,id+'.json');let credential;
      try{credential=JSON.parse(await readFile(record,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;credential={token:randomBytes(32).toString('base64url')};await writeFile(record,JSON.stringify(credential),{mode:0o600,flag:'wx'});}
      const name='bees-client-'+id.slice(0,32);
      let running;
      try{running=JSON.parse((await exec('docker',['inspect',name])).stdout)[0];}catch{}
      if(running&&running.Config.Labels['bees.client']!==id)throw Error('Container ownership mismatch');
      if(running&&!running.State.Running){await exec('docker',['rm',name]);running=null;}
      if(!running){
        // The native-addon loader caches shared libraries in /tmp, which must permit mmap execution.
        await exec('docker',['run','-d','--name',name,'--label','bees.client='+id,'--restart','unless-stopped','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--memory','2g','--cpus','2','--tmpfs','/tmp:rw,exec,nosuid,size=512m','--mount',`type=volume,source=${name},target=/var/lib/bees`,'-p','127.0.0.1::8080',
          ...['BEES_DSH_TOKEN','BEES_THREAD_SESSION','BEES_ACCOUNT_API_URL','BEES_CLIENT_NAME','BEES_HOSTED_CLIENT','BEES_HOSTED_RUNS_PER_DAY'].flatMap(k=>['-e',k]),'--entrypoint','node',image,'dsh-runtime/client-cloud.mjs'],
          {env:{...process.env,BEES_DSH_TOKEN:credential.token,BEES_THREAD_SESSION:session,BEES_ACCOUNT_API_URL:directoryUrl,BEES_CLIENT_NAME:'Bees Cloud',BEES_HOSTED_CLIENT:'1',BEES_HOSTED_RUNS_PER_DAY:process.env.BEES_HOSTED_RUNS_PER_DAY??'0'},maxBuffer:1_000_000});
      }
      const inspected=JSON.parse((await exec('docker',['inspect',name])).stdout)[0];
      if(inspected.Config.Labels['bees.client']!==id)throw Error('Container ownership mismatch');
      const port=inspected.NetworkSettings.Ports['8080/tcp']?.find(p=>p.HostIp==='127.0.0.1')?.HostPort;if(!port)throw Error('Client port is not private');
      const result={url:'http://127.0.0.1:'+port,token:credential.token};
      const deadline=Date.now()+300000;
      while(Date.now()<deadline){try{const r=await fetch(result.url+'/healthz',{signal:AbortSignal.timeout(1000)});if(r.ok)return result;}catch{}await new Promise(r=>setTimeout(r,500));}
      throw Error('Hosted client did not become ready');
    })().catch(error=>{pending.delete(id);throw error;});pending.set(id,started);return started;
  };
  provision.stop=async user=>{
    const id=hash(directoryUrl+'\n'+user.id),name='bees-client-'+id.slice(0,32);
    if(stopping.has(id))return stopping.get(id);
    const operation=(async()=>{
      await pending.get(id)?.catch(()=>{});pending.delete(id);
      let container;
      try{container=JSON.parse((await exec('docker',['inspect',name])).stdout)[0];}
      catch(error){if(error.stderr?.includes('No such object'))return;throw error;}
      if(container.Config.Labels['bees.client']!==id)throw Error('Container ownership mismatch');
      if(container.State.Running)await exec('docker',['stop','--time','45',name]);
    })().finally(()=>stopping.delete(id));
    stopping.set(id,operation);return operation;
  };
  provision.running=async()=>{
    const names=(await exec('docker',['ps','--filter','label=bees.client','--format','{{.Names}}'])).stdout.trim().split('\n').filter(Boolean);
    if(!names.length)return [];
    const containers=JSON.parse((await exec('docker',['inspect',...names])).stdout);
    return Promise.all(containers.map(async container=>{
      const id=container.Config.Labels?.['bees.client'];
      if(!/^[a-f0-9]{64}$/.test(id??'')||container.Name!=='/bees-client-'+id.slice(0,32))throw Error('Container ownership mismatch');
      const {token}=JSON.parse(await readFile(join(stateRoot,id+'.json'),'utf8'));
      const port=container.NetworkSettings.Ports['8080/tcp']?.find(p=>p.HostIp==='127.0.0.1')?.HostPort;
      if(!port)throw Error('Client port is not private');
      return {id,url:'http://127.0.0.1:'+port,token};
    }));
  };
  return provision;
}

export function createHostedGateway({directoryUrl,assets,provision,publicUrl}){
  const directory=new URL(directoryUrl);if(directory.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(directory.hostname))throw Error('Use a secure Bees Server');
  let assetVersion;
  const activity=hostedClientActivity({provision,directoryUrl});
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url??'/',publicUrl??'http://localhost');
      if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==(publicUrl?new URL(publicUrl).origin:'http://'+req.headers.host))return json(res,403,{error:'Origin is not permitted'});
      if(url.pathname==='/healthz')return json(res,200,{status:'ok',service:'bees-hosted-clients'});
      if(url.pathname==='/bees-auth/finish'&&req.method==='GET'){
        res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"});
        return res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bees sign in</title><p role="status">Signing in… Return to Bees to continue.</p><script>
const state=new URLSearchParams(location.search).get('state'),result=Object.fromEntries(new URLSearchParams(location.hash.slice(1)));history.replaceState(null,'',location.pathname);
if(state){const channel=new BroadcastChannel('bees-sign-in-'+state);channel.postMessage(result);channel.close();window.close();}
</script>`);
      }
      if(url.pathname==='/'||url.pathname==='/app'||url.pathname==='/app/'){
        assetVersion??=hash(await readFile(join(assets,'app.js'))).slice(0,16);
        res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});return res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bees Client</title><link rel="stylesheet" href="/app/assets/app.css?v=${assetVersion}"><body><div id="bees-root"></div><script type="module" src="/app/assets/app.js?v=${assetVersion}"></script></body></html>`);
      }
      if(url.pathname.startsWith('/app/assets/')){const name=url.pathname.slice('/app/assets/'.length);if(!/^[a-zA-Z0-9_.-]+$/.test(name))return json(res,404,{error:'Unavailable'});let content;try{content=await readFile(join(assets,name));}catch(error){if(error.code==='ENOENT')return json(res,404,{error:'Unavailable'});throw error;}res.writeHead(200,{'content-type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'application/octet-stream','cache-control':'no-cache','x-content-type-options':'nosniff'});return res.end(content);}
      if(!['/bees-api/threads','/bees-api/thread-file'].includes(url.pathname))return json(res,404,{error:'Unavailable'});
      let bytes=req.method==='POST'?await body(req):undefined;
      const input=bytes&&url.pathname==='/bees-api/threads'?JSON.parse(bytes.toString()):null;
      if(input?.action==='authConfig')return json(res,200,await authConfig(directory.origin));
      if(input?.action==='startLogin'){
        if(!/^[a-f0-9-]{36}$/.test(input.state??''))return json(res,400,{error:'Invalid sign-in attempt'});
        const redirect=new URL('/bees-auth/finish',publicUrl??'http://'+req.headers.host);redirect.searchParams.set('state',input.state);
        return json(res,200,{url:browserSignInUrl(directory.origin,input,redirect.toString())});
      }
      if(['finishLogin','cancelLogin'].includes(input?.action))return json(res,400,{error:'Sign in through Bees Cloud'});
      const cookies=new Map(String(req.headers.cookie??'').split(';').map(part=>{const index=part.indexOf('=');return [part.slice(0,index).trim(),decodeURIComponent(part.slice(index+1))];}));
      const accountPrefix='bees_hosted_account_';
      const sessions=new Map([...cookies].filter(([name])=>new RegExp('^'+accountPrefix+'[a-f0-9]{64}$').test(name)).map(([name,token])=>[name.slice(accountPrefix.length),token]));
      const cookie=(name,value)=>res.setHeader('set-cookie',[...(res.getHeader('set-cookie')??[]),`${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/${publicUrl?.startsWith('https:')?'; Secure':''}${value?'':'; Max-Age=0'}`]);
      const identify=async token=>{
        const response=await fetch(directory.origin+'/api/me',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
        if(response.status===401)return null;
        if(!response.ok)throw Error("Bees can't be reached right now.");
        const {user}=await response.json();return {id:hash(directory.origin+'\n'+user.id),user,token};
      };
      const switching=['switchAccount','selectOrganization'].includes(input?.action);
      const targetAccountId=switching?input.accountId:input?.settingsAccountId;
      let token=cookies.get('bees_hosted_session')||sessions.values().next().value;
      if(targetAccountId!=null){token=sessions.get(targetAccountId);if(!token)return json(res,401,{error:'Sign in to this account again'});}
      if(input?.action==='logout'){
        const account=token?await identify(token):null;
        if(account&&provision.stop){
          const response=await fetch(directory.origin+'/api/directory/credits',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
          if(!response.ok)throw Error('Could not check credits before stopping this hosted client. Try signing out again.');
          const {credits}=await response.json();
          if(isFreeClient(credits))await provision.stop(account.user);
        }
        for(const [id,session] of sessions)if(session===token)cookie(accountPrefix+id,'');
        cookie('bees_hosted_session','');return json(res,200,{ok:true});
      }
      if(input?.action==='login'){
        if(input.session)token=String(input.session);
        else {
          const r=await fetch(directory.origin+'/api/auth/'+(input.name?'sign-up/email':'sign-in/email'),{method:'POST',headers:{'content-type':'application/json',origin:directory.origin,'x-forwarded-for':String(req.headers['x-real-ip']??req.socket.remoteAddress??'')},body:JSON.stringify({email:input.email,password:input.password,...(input.name?{name:input.name}:{})}),signal:AbortSignal.timeout(20000)});
          const value=await r.json();if(!r.ok)return json(res,r.status,{error:value.message??'Sign in failed'});token=r.headers.get('set-auth-token')??value.token;
        }
      }
      if(!token)return json(res,401,{error:'Sign in to Bees Client'});
      let account=await identify(token);
      if(!account&&req.method==='GET'&&url.pathname==='/bees-api/threads'){
        for(const [id,session] of sessions){
          const candidate=await identify(session);if(!candidate||candidate.id!==id){cookie(accountPrefix+id,'');continue;}
          account=candidate;token=session;cookie('bees_hosted_session',token);break;
        }
      }
      if(!account)return json(res,401,{error:'Sign in again'});
      if(targetAccountId!=null&&targetAccountId!==account.id)return json(res,401,{error:'Sign in to this account again'});
      activity.touch(account.user);
      const client=await provision(account.user,token);
      if(input?.action==='login'){
        const resumed=await fetch(client.url+'/bees-api/threads',{method:'POST',headers:{authorization:'Bearer '+client.token,'content-type':'application/json'},body:JSON.stringify({action:'resumeSession',session:token}),signal:AbortSignal.timeout(20000)});
        if(!resumed.ok)throw Error('Hosted client account enrollment failed');
        cookie(accountPrefix+account.id,token);cookie('bees_hosted_session',token);
        return json(res,200,{user:account.user});
      }
      if(input?.action==='resumeSession')return json(res,403,{error:'Sign in through Bees Cloud'});
      if(input?.action==='switchAccount'){cookie('bees_hosted_session',token);return json(res,200,{ok:true});}
      if(input?.action==='selectOrganization')bytes=Buffer.from(JSON.stringify({...input,accountId:null}));
      if(req.method==='GET'&&url.pathname==='/bees-api/threads'){
        const snapshot=await fetch(client.url+'/bees-api/threads',{headers:{authorization:'Bearer '+client.token},signal:AbortSignal.timeout(60000)});
        if(!snapshot.ok)return json(res,snapshot.status,{error:'Could not load this account'});
        const value=await snapshot.json();
        const accounts=await Promise.all([...sessions].filter(([id])=>id!==account.id).map(async([id,session])=>{
          const other=await identify(session).catch(()=>undefined);if(other===undefined)return null;if(!other||other.id!==id){cookie(accountPrefix+id,'');return null;}
          try{
            activity.touch(other.user);
            // a slow or stuck second account shouldn't hold up this one's page
            const target=await Promise.race([provision(other.user,session),new Promise((_,fail)=>setTimeout(fail,10000,Error('This account is waking up. Try again shortly.')))]);
            const response=await fetch(target.url+'/bees-api/snapshot',{headers:{authorization:'Bearer '+target.token},signal:AbortSignal.timeout(10000)});
            if(!response.ok)throw Error('Could not load organizations');
            const state=await response.json();return {id,user:other.user,url:directory.origin,active:false,organizations:state.organizations??[],organizationError:state.organizationError??null};
          }catch(error){return {id,user:other.user,url:directory.origin,active:false,organizations:[],organizationError:error.message};}
        }));
        accounts.push({id:account.id,user:account.user,url:directory.origin,active:true,organizations:value.organizations??[],organizationError:value.organizationError??null});
        if(sessions.get(account.id)!==token)cookie(accountPrefix+account.id,token);
        if(!cookies.get('bees_hosted_session'))cookie('bees_hosted_session',token);
        return json(res,200,{...value,localActive:false,accounts:accounts.filter(Boolean).sort((a,b)=>(a.user.email??'').localeCompare(b.user.email??''))});
      }
      const response=await fetch(client.url+url.pathname+url.search,{method:req.method,headers:{authorization:'Bearer '+client.token,'content-type':'application/json'},...(bytes?{body:bytes}:{}),signal:AbortSignal.timeout(60000)});
      const headers={'content-type':response.headers.get('content-type')??'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'};
      if(response.headers.get('content-disposition'))headers['content-disposition']=response.headers.get('content-disposition');
      if(response.ok&&input?.action==='selectOrganization')cookie('bees_hosted_session',token);
      res.writeHead(response.status,headers);for await(const chunk of response.body??[])if(!res.write(chunk))await once(res,'drain');res.end();
    }catch(e){if(!res.headersSent)json(res,503,{error:e.message});else res.destroy();}
  });
  const timer=setInterval(()=>void activity.sweep().catch(error=>console.warn('Idle hosted client sweep failed:',error.message)),60_000);
  timer.unref();server.once('close',()=>clearInterval(timer));
  return server;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const directoryUrl=process.env.BEES_ACCOUNT_API_URL??'https://app.bees.bot';
  const provision=process.env.BEES_CLIENT_BACKEND==='kubernetes'
    ?kubernetesClients({image:process.env.BEES_CLIENT_IMAGE,directoryUrl,namespace:process.env.BEES_CLIENT_NAMESPACE??'bees-clients',maxClients:Number(process.env.BEES_MAX_HOSTED_CLIENTS??10)})
    :dockerClients({image:process.env.BEES_CLIENT_IMAGE,stateRoot:process.env.BEES_GATEWAY_STATE??'/var/lib/bees-gateway',directoryUrl,maxClients:Number(process.env.BEES_MAX_HOSTED_CLIENTS??50)});
  createHostedGateway({directoryUrl,assets:resolve(process.env.BEES_CLIENT_ASSETS??'dist/hosted'),provision,publicUrl:process.env.BEES_HOSTED_CLIENT_URL}).listen(Number(process.env.PORT??3100),process.env.BEES_GATEWAY_HOST??'127.0.0.1');
}
