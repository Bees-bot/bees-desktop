import { createServer, request as httpsRequest, Agent } from 'node:https';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createSecureContext, TLSSocket, connect as tlsConnect } from 'node:tls';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import selfsigned from 'selfsigned';
import WebSocket, { createWebSocketStream } from 'ws';
import { Duplex,Writable } from 'node:stream';
import { threadError } from './thread-store.js';

export async function peerCertificate(root) {
  mkdirSync(root,{recursive:true,mode:0o700});const path=join(root,'peer-identity.json');
  if(existsSync(path))return JSON.parse(readFileSync(path,'utf8'));
  const generated=await selfsigned.generate([{name:'commonName',value:'bees-client'}],{keySize:2048,algorithm:'sha256',notAfterDate:new Date(Date.now()+3650*86400000)});
  const identity={key:generated.private,cert:generated.cert};writeFileSync(path,JSON.stringify(identity),{flag:'wx',mode:0o600});return identity;
}
async function jsonBody(req) {let size=0;const parts=[];for await(const chunk of req){size+=chunk.length;if(size>16_000_000)throw threadError('Peer request is too large');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString()||'{}');}
const response=(res,status,value)=>{if(res.destroyed)return;const body=JSON.stringify(value);res.writeHead(status,{'content-type':'application/json','content-length':Buffer.byteLength(body),'cache-control':'no-store'});res.end(body);};

// TLS may flush many records in one write. Bound WebSocket messages independently of file size.
function relayStream(ws,touch=()=>{}){
  const wire=createWebSocketStream(ws,{highWaterMark:65536});ws.on('message',()=>touch());
  const framed=new Writable({highWaterMark:65536,write(chunk,_encoding,done){
    touch();let offset=0;const next=error=>{if(error)return done(error);if(offset===chunk.length)return done();const end=Math.min(offset+32768,chunk.length),part=chunk.subarray(offset,end);offset=end;wire.write(part,next);};next();
  },final:done=>wire.end(done)});
  return Duplex.from({readable:wire,writable:framed});
}

export class ThreadPeer {
  constructor(directory,identity,receive){this.directory=directory;this.identity=identity;this.receive=receive;this.incoming=new Set();this.sockets=new Set();}
  async start() {
    const handler=async(req,res)=>{
      try{
        if(req.method!=='POST'||req.url!=='/exchange')return response(res,404,{error:'Unavailable'});
        const connection=String(req.headers.authorization??'').replace(/^Bearer\s+/i,'');
        const grant=await this.directory.request('/connections/'+encodeURIComponent(connection));
        if(grant.target_client_id!==this.directory.clientId)throw threadError('Wrong recipient',403);
        response(res,200,{result:await this.receive(grant,await jsonBody(req))});
      }catch(e){response(res,e.status??400,{error:e.message});}
    };
    this.direct=createServer({...this.identity,minVersion:'TLSv1.3'},handler);
    this.http=createHttpServer(handler);
    this.direct.on('connection',s=>{this.sockets.add(s);s.on('close',()=>this.sockets.delete(s));});
    this.direct.requestTimeout=30000;this.direct.headersTimeout=10000;
    await new Promise((ok,bad)=>this.direct.once('error',bad).listen(0,'0.0.0.0',ok));
    const port=this.direct.address().port;
    this.endpoints=Object.values(networkInterfaces()).flat().filter(a=>a&&a.family==='IPv4'&&!a.internal).slice(0,8).map(a=>`https://${a.address}:${port}`);
    if(process.env.BEES_PEER_ENDPOINT)this.endpoints=[process.env.BEES_PEER_ENDPOINT];
    const poll=()=>this.polling??=(async()=>{
      if(!this.directory.token)return;
      for(const {id} of await this.directory.request('/incoming'))if(!this.incoming.has(id))this.accept(id);
    })().catch(e=>{this.lastError=e.message;}).finally(()=>{this.polling=null;});
    this.timer=setInterval(()=>void poll(),1500);this.timer.unref();void poll();
    return this;
  }
  websocket(id){const url=new URL('/api/relay/'+encodeURIComponent(id),this.directory.url);url.protocol=url.protocol==='https:'?'wss:':'ws:';return new WebSocket(url,{headers:{authorization:`Bearer ${this.directory.token}`},perMessageDeflate:false});}
  accept(id){
    if(this.closed)return;
    this.incoming.add(id);const ws=this.websocket(id);
    // idle limit, not a deadline: a big file on a slow link keeps the relay open while bytes flow
    const expiry=setTimeout(()=>{this.incoming.delete(id);socket.destroy();},65000);expiry.unref();const duplex=relayStream(ws,()=>expiry.refresh());
    const socket=new TLSSocket(duplex,{isServer:true,secureContext:createSecureContext({...this.identity,minVersion:'TLSv1.3'})});
    this.sockets.add(socket);
    socket.on('error',()=>socket.destroy());ws.on('error',()=>socket.destroy());
    socket.on('close',()=>{this.sockets.delete(socket);this.incoming.delete(id);ws.close();});
    this.http.emit('connection',socket);
    socket.on('close',()=>clearTimeout(expiry));
  }
  async send(threadId,targetClientId,payload,{relayOnly=false}={}) {
    if(this.closed)throw threadError('Client is stopping');
    const grant=await this.directory.request('/connections',{threadId,targetClientId});
    const send=(endpoint,socket)=>new Promise((ok,bad)=>{
      const bytes=Buffer.from(JSON.stringify(payload));
      if(bytes.length>16_000_000)return bad(threadError('Peer request is too large'));
      const agent=socket?new Agent({keepAlive:false}):false;if(agent)agent.createConnection=()=>socket;
      const req=httpsRequest(new URL('/exchange',endpoint),{method:'POST',ca:grant.target.certificate,servername:'bees-client',minVersion:'TLSv1.3',agent,timeout:socket?30000:2500,
        headers:{authorization:`Bearer ${grant.id}`,'content-type':'application/json','content-length':bytes.length}},res=>{
        const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>16_000_000){req.destroy(threadError('Peer response is too large'));return;}chunks.push(chunk);});
        res.on('end',()=>{try{const body=JSON.parse(Buffer.concat(chunks).toString());if(res.statusCode!==200)throw threadError(body.error??'Peer request failed',res.statusCode);ok(body.result);}catch(e){bad(e);}});res.on('error',bad);
      });this.sockets.add(req);req.on('close',()=>this.sockets.delete(req));req.on('error',bad);req.on('timeout',()=>req.destroy(threadError('Peer connection timed out',408)));req.end(bytes);
    });
    // shortcut: routable addresses first, then the private relay; add ICE only if relay egress warrants it.
    try{
      if(!relayOnly)for(const endpoint of grant.target.endpoints){try{return await send(endpoint);}catch(e){if(e.status&&e.status!==408)throw e;}}
      const ws=this.websocket(grant.id);const duplex=relayStream(ws);
      ws.on('error',e=>duplex.destroy(e));
      const socket=tlsConnect({socket:duplex,ca:grant.target.certificate,servername:'bees-client',minVersion:'TLSv1.3'});
      socket.on('error',()=>{});
      try{return await send('https://bees-client',socket);}finally{socket.destroy();duplex.destroy();ws.close();}
    }finally{void this.directory.request('/connections/'+grant.id,undefined,'DELETE').catch(()=>{});}
  }
  async close(){this.closed=true;clearInterval(this.timer);for(const s of this.sockets)s.destroy();await new Promise(resolve=>this.direct.close(resolve));this.http.close();}
}
