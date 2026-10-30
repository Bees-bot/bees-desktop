import { readFile, unlink } from 'node:fs/promises';
import { launch, launchConfig } from './headless.mjs';

const stateDir='/var/lib/bees/client';
// A new container can reuse PID 1 left in its exclusive volume by the previous container.
try { if ((await readFile(stateDir+'/headless.lock','utf8')).trim() === String(process.pid)) await unlink(stateDir+'/headless.lock'); }
catch(error) { if(error.code!=='ENOENT') throw error; }
const controller=new AbortController();for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>controller.abort());
await launch(launchConfig({stateDir,host:'0.0.0.0',port:8080}),controller.signal);
