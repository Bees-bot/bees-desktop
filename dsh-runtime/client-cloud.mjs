import { mkdir, writeFile } from 'node:fs/promises';
import { launch, launchConfig } from './headless.mjs';

const stateDir='/var/lib/bees/client';
if(process.env.BEES_MODEL_PROFILE){
  const profile=stateDir+'/dsh/profiles/bees';await mkdir(profile,{recursive:true,mode:0o700});
  await writeFile(profile+'/cordis.patch.yml',process.env.BEES_MODEL_PROFILE,{mode:0o600});delete process.env.BEES_MODEL_PROFILE;
}
const controller=new AbortController();for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>controller.abort());
await launch(launchConfig({stateDir,host:'0.0.0.0',port:8080}),controller.signal);
