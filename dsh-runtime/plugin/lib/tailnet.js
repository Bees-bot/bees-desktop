import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

// an app started from the Dock has no Homebrew PATH, so look where the installers put the cli
const cli=['/Applications/Tailscale.app/Contents/MacOS/Tailscale','/opt/homebrew/bin/tailscale','/usr/local/bin/tailscale','C:\\Program Files\\Tailscale\\tailscale.exe'].find(existsSync)??'tailscale';
// some installs run tailscaled on a non-default socket, which the cli only finds through --socket
const socket=process.env.TAILSCALE_SOCKET?[`--socket=${process.env.TAILSCALE_SOCKET}`]:[];
export const unshareCommand=[cli,...socket,'serve','--https=8443','off'];
const tailscale=async(...args)=>(await promisify(execFile)(cli,[...socket,...args],{encoding:'utf8',timeout:20_000,windowsHide:true})).stdout;
const fail=message=>error=>{throw Error(error.code==='ENOENT'?'Tailscale is not installed on this computer. Get it from https://tailscale.com/download and sign in.':message);};

// serves 127.0.0.1:port on https://<this computer's tailnet name>:8443 and returns that name
export async function share(port){
  const status=JSON.parse(await tailscale('status','--json').catch(fail('Tailscale is not running. Open the Tailscale app on this computer and sign in.')));
  if(status.BackendState!=='Running')throw Error('Tailscale is not connected. Open the Tailscale app on this computer and sign in.');
  const name=status.Self?.DNSName?.replace(/\.$/,'');
  if(!name||!status.CurrentTailnet?.MagicDNSEnabled)throw Error('MagicDNS is off. Turn it on under DNS in the Tailscale admin console.');
  const served=JSON.parse(await tailscale('serve','status','--json')||'{}'),target=`http://127.0.0.1:${port}`;
  // serve --bg silently replaces whatever 8443 already proxied, and funnel would make it public
  if(served.AllowFunnel?.[`${name}:8443`]||served.TCP?.['8443']&&served.Web?.[`${name}:8443`]?.Handlers?.['/']?.Proxy!==target)
    throw Error('Another program already uses Tailscale port 8443. Stop it with: tailscale serve --https=8443 off');
  await tailscale('serve','--bg','--https=8443',target).catch(fail('Tailscale could not share Bees. Turn on HTTPS certificates under DNS in the Tailscale admin console.'));
  return name;
}

export const unshare=()=>tailscale('serve','--https=8443','off');
