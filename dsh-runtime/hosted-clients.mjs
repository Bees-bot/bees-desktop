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
const exec=promisify(execFile);
const hash=v=>createHash('sha256').update(v).digest('hex');
const json=(res,status,value,headers={})=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',...headers});res.end(JSON.stringify(value));};
async function body(req){const parts=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16_000_000)throw Error('Request too large');parts.push(chunk);}return Buffer.concat(parts);}

/** Each account receives an isolated container and a persistent volume, never a shared writable runtime. */
export function dockerClients({image,stateRoot,directoryUrl,maxClients=50}){
  if(!/^(?:.+@)?sha256:[a-f0-9]{64}$/.test(image??''))throw Error('BEES_CLIENT_IMAGE must be pinned to a reviewed image digest');
  const pending=new Map();
  return async(user,session)=>{
    const id=hash(directoryUrl+'\n'+user.id);if(pending.has(id))return pending.get(id);
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
          ...['BEES_DSH_TOKEN','BEES_THREAD_SESSION','BEES_ACCOUNT_API_URL','BEES_CLIENT_NAME','BEES_HOSTED_CLIENT','BEES_HOSTED_MODEL','BEES_MODEL_PROFILE','BEES_HOSTED_RUNS_PER_DAY'].flatMap(k=>['-e',k]),'--entrypoint','node',image,'dsh-runtime/client-cloud.mjs'],
          {env:{...process.env,BEES_DSH_TOKEN:credential.token,BEES_THREAD_SESSION:session,BEES_ACCOUNT_API_URL:directoryUrl,BEES_CLIENT_NAME:'Bees Cloud',BEES_HOSTED_CLIENT:'1',BEES_HOSTED_RUNS_PER_DAY:process.env.BEES_HOSTED_RUNS_PER_DAY??'1'},maxBuffer:1_000_000});
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
}

export function createHostedGateway({directoryUrl,assets,provision,publicUrl}){
  const directory=new URL(directoryUrl);if(directory.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(directory.hostname))throw Error('Use a secure Bees Server');
  let assetVersion;
  return createServer(async(req,res)=>{
    try{
      const url=new URL(req.url??'/',publicUrl??'http://localhost');
      if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==(publicUrl?new URL(publicUrl).origin:'http://'+req.headers.host))return json(res,403,{error:'Origin is not permitted'});
      if(url.pathname==='/healthz')return json(res,200,{status:'ok',service:'bees-hosted-clients'});
      if(url.pathname==='/bees-auth/finish'&&req.method==='GET'){
        res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"});
        return res.end(`<!doctype html><title>Bees sign in</title><p>Return to Bees to finish signing in.</p><script>
const state=new URLSearchParams(location.search).get('state'),result=Object.fromEntries(new URLSearchParams(location.hash.slice(1)));history.replaceState(null,'',location.pathname);
if(state){const channel=new BroadcastChannel('bees-sign-in-'+state);channel.postMessage(result);channel.close();window.close();}
</script>`);
      }
      if(url.pathname==='/'||url.pathname==='/app'||url.pathname==='/app/'){
        assetVersion??=hash(await readFile(join(assets,'app.js'))).slice(0,16);
        res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});return res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bees Client</title><body><div id="bees-root"></div><script type="module" src="/app/assets/app.js?v=${assetVersion}"></script></body></html>`);
      }
      if(url.pathname.startsWith('/app/assets/')){const name=url.pathname.slice('/app/assets/'.length);if(!/^[a-zA-Z0-9_.-]+$/.test(name))return json(res,404,{error:'Unavailable'});let content;try{content=await readFile(join(assets,name));}catch(error){if(error.code==='ENOENT')return json(res,404,{error:'Unavailable'});throw error;}res.writeHead(200,{'content-type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'application/octet-stream','cache-control':'no-cache','x-content-type-options':'nosniff'});return res.end(content);}
      if(!['/bees-api/threads','/bees-api/thread-file'].includes(url.pathname))return json(res,404,{error:'Unavailable'});
      const bytes=req.method==='POST'?await body(req):undefined;
      const input=bytes&&url.pathname==='/bees-api/threads'?JSON.parse(bytes.toString()):null;
      if(input?.action==='authConfig')return json(res,200,await authConfig(directory.origin));
      if(input?.action==='startLogin'){
        if(!/^[a-f0-9-]{36}$/.test(input.state??''))return json(res,400,{error:'Invalid sign-in attempt'});
        const redirect=new URL('/bees-auth/finish',publicUrl??'http://'+req.headers.host);redirect.searchParams.set('state',input.state);
        return json(res,200,{url:browserSignInUrl(directory.origin,input,redirect.toString())});
      }
      if(['finishLogin','cancelLogin'].includes(input?.action))return json(res,400,{error:'Sign in through Bees Cloud'});
      let token=decodeURIComponent(String(req.headers.cookie??'').split(';').map(p=>p.trim().split('=')).find(([k])=>k==='bees_hosted_session')?.[1]??'');
      if(input?.action==='logout')return json(res,200,{ok:true},{'set-cookie':'bees_hosted_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});
      if(input?.action==='login'){
        if(input.session)token=String(input.session);
        else {
        const r=await fetch(directory.origin+'/api/auth/'+(input.name?'sign-up/email':'sign-in/email'),{method:'POST',headers:{'content-type':'application/json',origin:directory.origin,'x-forwarded-for':String(req.headers['x-real-ip']??req.socket.remoteAddress??'')},body:JSON.stringify({email:input.email,password:input.password,...(input.name?{name:input.name}:{})}),signal:AbortSignal.timeout(20000)});
        const value=await r.json();if(!r.ok)return json(res,r.status,{error:value.message??'Sign in failed'});token=r.headers.get('set-auth-token')??value.token;
        }
      }
      if(!token)return json(res,401,{error:'Sign in to Bees Client'});
      const auth=await fetch(directory.origin+'/api/me',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});if(!auth.ok)return json(res,401,{error:'Sign in again'});
      const {user}=await auth.json();const client=await provision(user,token);
      if(input?.action==='login'){
        const resumed=await fetch(client.url+'/bees-api/threads',{method:'POST',headers:{authorization:'Bearer '+client.token,'content-type':'application/json'},body:JSON.stringify({action:'resumeSession',session:token}),signal:AbortSignal.timeout(20000)});
        if(!resumed.ok)throw Error('Hosted client account enrollment failed');
        return json(res,200,{user},{'set-cookie':`bees_hosted_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/${publicUrl?.startsWith('https:')?'; Secure':''}`});
      }
      if(input?.action==='resumeSession')return json(res,403,{error:'Sign in through Bees Cloud'});
      const response=await fetch(client.url+url.pathname+url.search,{method:req.method,headers:{authorization:'Bearer '+client.token,'content-type':'application/json'},...(bytes?{body:bytes}:{}),signal:AbortSignal.timeout(60000)});
      const headers={'content-type':response.headers.get('content-type')??'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'};
      if(response.headers.get('content-disposition'))headers['content-disposition']=response.headers.get('content-disposition');
      res.writeHead(response.status,headers);for await(const chunk of response.body??[])if(!res.write(chunk))await once(res,'drain');res.end();
    }catch(e){if(!res.headersSent)json(res,503,{error:e.message});else res.destroy();}
  });
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const directoryUrl=process.env.BEES_ACCOUNT_API_URL??'https://app.bees.bot';
  const provision=process.env.BEES_CLIENT_BACKEND==='kubernetes'
    ?kubernetesClients({image:process.env.BEES_CLIENT_IMAGE,directoryUrl,namespace:process.env.BEES_CLIENT_NAMESPACE??'bees-clients',maxClients:Number(process.env.BEES_MAX_HOSTED_CLIENTS??10)})
    :dockerClients({image:process.env.BEES_CLIENT_IMAGE,stateRoot:process.env.BEES_GATEWAY_STATE??'/var/lib/bees-gateway',directoryUrl,maxClients:Number(process.env.BEES_MAX_HOSTED_CLIENTS??50)});
  createHostedGateway({directoryUrl,assets:resolve(process.env.BEES_CLIENT_ASSETS??'dist/hosted'),provision,publicUrl:process.env.BEES_HOSTED_CLIENT_URL}).listen(Number(process.env.PORT??3100),process.env.BEES_GATEWAY_HOST??'127.0.0.1');
}
