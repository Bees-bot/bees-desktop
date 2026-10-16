import { DurableObject } from 'cloudflare:workers';

export class BeesMachine extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    if(ctx.container?.running)void ctx.blockConcurrencyWhile(()=>ctx.container.setInactivityTimeout(6*60*60*1000));
  }
  async fetch(request) {
    const container=this.ctx.container;
    const body=await request.json();
    if(body.action==='stop') {await container.destroy();return Response.json({stopped:true});}
    if(body.action==='status') {
      if(container.running)await container.setInactivityTimeout(6*60*60*1000);
      return Response.json({running:container.running});
    }
    if(body.action!=='start'||typeof body.code!=='string'||body.code.length>100)return new Response('Invalid command',{status:400});
    if(container.running)return Response.json({running:true});
    container.start({entrypoint:['node','dsh-runtime/runner-cloud.mjs'],enableInternet:true,env:{
      BEES_CONTROL_PLANE_URL:this.env.BEES_CONTROL_PLANE_URL,BEES_PAIR_CODE:body.code,
      ...(this.env.BEES_RUNNER_MODEL_PROFILE?{BEES_RUNNER_MODEL_PROFILE:this.env.BEES_RUNNER_MODEL_PROFILE}:{})
    }});
    await container.setInactivityTimeout(6*60*60*1000);
    this.ctx.waitUntil(container.monitor().catch(()=>console.error('Bees machine stopped unexpectedly')));
    return Response.json({started:true});
  }
}
export default {
  async fetch(request,env) {
    if(!env.BEES_MANAGER_TOKEN||env.BEES_MANAGER_TOKEN.length<32)return new Response('Manager secret unavailable',{status:503});
    const expected=new TextEncoder().encode(`Bearer ${env.BEES_MANAGER_TOKEN}`),offered=new TextEncoder().encode(request.headers.get('authorization')||'');
    const a=new Uint8Array(await crypto.subtle.digest('SHA-256',expected)),b=new Uint8Array(await crypto.subtle.digest('SHA-256',offered));let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a[i]^b[i];
    if(mismatch)return new Response('Unauthorized',{status:401});
    const match=new URL(request.url).pathname.match(/^\/machines\/([a-f0-9-]{36})$/i);
    if(request.method!=='POST'||!match)return new Response('Not found',{status:404});
    return env.MACHINES.getByName(match[1]).fetch(request);
  }
};
