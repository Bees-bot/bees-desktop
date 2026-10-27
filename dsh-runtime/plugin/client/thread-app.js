import { h, React, useEffect, useState, useRef, hosted, CustomAiSettings, OpenAiServersSettings, SubscriptionSettings, MarkdownText } from './runtime.js';
import { ask, confirmAction, openExternal, Button, when, droppedFiles, pastedFiles } from './common.js';
import { threadCss } from './thread-style.js';
import { THEME_PRESETS, nextThemePreset } from '../lib/themes.js';
import { AppearanceSettings, themeStyle, useAppearance } from './thread-appearance.js';
import { GLOBAL_SETTINGS, THREAD_SETTINGS, TEAM_SETTINGS, SettingsNav, ThreadDetails, SettingsPage } from './thread-panels.js';
import { scheduleDraft } from './thread-schedule-form.js';
import { ThreadFiles } from './thread-files.js';
import { ThreadKanban } from './thread-kanban.js';
import { DEFAULT_WORKFLOW, WORKFLOW_TEMPLATES, workflowTemplate, processName, workflowFor, isChatWorkflow } from '../lib/thread-workflow.js';
import { IntegrationSettings } from './thread-integrations.js';
import { Login } from './thread-login.js';
import { CreditSettings, FirstStart } from './thread-credits.js';
import { ThreadWorkspace } from './thread-layout.js';
import { TeamProcesses, WorkflowStages } from './thread-processes.js';
import { TeamAgents } from './thread-agents.js';
import { TeamMemory } from './thread-memory.js';
import { RootFolderSettings } from './thread-folders.js';
import { OrganizationAppearance } from './thread-organization-appearance.js';
import { BeesNavigation, TeamMenu, TeamSection, TeamManagement, closeHoverMenu, initials } from './thread-navigation.js';

async function api(input){const response=await fetch('/bees-api/threads',{...(input?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}:{}),credentials:'same-origin'}).catch(()=>{throw Object.assign(Error(offline),{status:503});});const value=await response.json().catch(()=>({error:offline}));
  // the gateway sends real 503s (at capacity, enrollment failed) with a message; show it instead of burying it under the generic offline text
  if(!response.ok)throw Object.assign(Error(typeof value.error==='string'&&value.error?value.error:response.status>=500?offline:value.error?.message??'Could not complete this request'),{status:response.status});return value;}
const offline="Bees can't be reached right now.";
const command=(action,threadId,values={})=>api({action,threadId,operationId:crypto.randomUUID(),...values});
const icon=(name,props={})=>h('svg',{width:20,height:20,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,...props},
  ...( {star:[h('path',{key:1,d:'m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z'})],organization:[h('path',{key:1,d:'M4 21V5h11v16M15 11h5v10M2 21h20M8 9h3M8 13h3M8 17h3M17 15h1M17 18h1'})],team:[h('circle',{key:1,cx:9,cy:7,r:3}),h('path',{key:2,d:'M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v2'})],personal:[h('path',{key:1,d:'m3 10 9-7 9 7v11h-6v-7H9v7H3Z'})],accounts:[h('rect',{key:1,x:3,y:6,width:16,height:15,rx:3}),h('path',{key:2,d:'M7 3h12a3 3 0 0 1 3 3v11M7 18a4 4 0 0 1 8 0'}),h('circle',{key:3,cx:11,cy:12,r:2})],gear:[h('path',{key:1,d:'m9 3 1-1h4l1 3 3 1 3 1 1 4-2 2-1 3-1 3-4 1-2-2-3-1-3-1-1-4 2-2 1-3Z'}),h('circle',{key:2,cx:12,cy:11,r:3})],sun:[h('circle',{key:1,cx:12,cy:12,r:4}),h('path',{key:2,d:'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5'})],moon:[h('path',{key:1,d:'M21 13a9 9 0 0 1-10-10A9 9 0 1 0 21 13Z'})],check:[h('path',{key:1,d:'m5 12 4 4L19 6'})],hide:[h('path',{key:1,d:'m3 3 18 18M10 5l2-.2c5 0 9 7.2 9 7.2a19 19 0 0 1-3 4M6 6a22 22 0 0 0-3 6s4 7 9 7a11 11 0 0 0 5-1M10 10a3 3 0 0 0 4 4'})],process:[h('rect',{key:1,x:3,y:3,width:6,height:6,rx:1}),h('rect',{key:2,x:15,y:15,width:6,height:6,rx:1}),h('path',{key:3,d:'M9 6h6a3 3 0 0 1 3 3v6M3 18h6M6 15v6'})],goal:[h('circle',{key:1,cx:12,cy:12,r:9}),h('circle',{key:2,cx:12,cy:12,r:4})],plus:[h('path',{key:1,d:'M12 5v14M5 12h14'})],chat:[h('path',{key:1,d:'M21 11a8 8 0 0 1-8 8H6l-4 3 1-7A8 8 0 1 1 21 11Z'})],search:[h('circle',{key:1,cx:10,cy:10,r:6}),h('path',{key:2,d:'m15 15 5 5'})],file:[h('path',{key:1,d:'M14 2H5v20h14V7Z M14 2v6h5 M8 13h8 M8 17h6'})],send:[h('path',{key:1,d:'m3 3 18 9-18 9 4-9Z M7 12h14'})],share:[h('path',{key:1,d:'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M16 4a4 4 0 0 1 0 8 M20 15v6 M17 18h6'}),h('circle',{key:2,cx:8.5,cy:7,r:4})],settings:[h('path',{key:1,d:'M4 7h16 M4 17h16'}),h('circle',{key:2,cx:8,cy:7,r:3,fill:'currentColor'}),h('circle',{key:3,cx:16,cy:17,r:3,fill:'currentColor'})],transfer:[h('path',{key:1,d:'M4 7h15l-4-4 M20 17H5l4 4 M19 7l-4 4 M5 17l4-4'})],more:[h('circle',{key:1,cx:5,cy:12,r:1}),h('circle',{key:2,cx:12,cy:12,r:1}),h('circle',{key:3,cx:19,cy:12,r:1})],close:[h('path',{key:1,d:'m6 6 12 12 M18 6 6 18'})]}[name]??[]));
function Field({label,...props}){return h('label',{className:'bc-field'},h('span',null,label),h('input',props));}
// the dialog unmounts while open, so focus would drop to the page top
function Dialog({title,onClose,children,wide=false}){const ref=useRef();useEffect(()=>{const opener=document.activeElement;ref.current.showModal();return()=>opener?.focus?.();},[]);return h('dialog',{ref,className:'bc-dialog'+(wide?' bc-dialog-wide':''),onCancel:onClose},h('header',null,h('h2',null,title),h('button',{className:'bc-icon',onClick:onClose,'aria-label':'Close'},icon('close'))),children);}
function Question({run,threadId,act}){const [answers,setAnswers]=useState({});const [picked,setPicked]=useState({});const p=run.pending;if(!p)return null;return h('section',{className:'bc-question'},h('strong',null,p.kind==='approval'?'Your approval is needed':'Bees has a question'),p.text?h('p',{className:'bc-preserve'},p.text):null,(p.questions??[]).map(q=>h('div',{key:q.id,className:'bc-field'},h('span',null,q.question),q.detail?h('small',null,q.detail):null,q.options?.length?h('div',{className:'bc-actions'},q.options.map(o=>h('button',{type:'button',key:o.label,className:(q.multiSelect?picked[q.id]?.includes(o.label):answers[q.id]===o.label)?'bc-primary':undefined,'aria-pressed':q.multiSelect?!!picked[q.id]?.includes(o.label):undefined,onClick:()=>q.multiSelect?setPicked({...picked,[q.id]:picked[q.id]?.includes(o.label)?picked[q.id].filter(l=>l!==o.label):[...picked[q.id]??[],o.label]}):setAnswers({...answers,[q.id]:o.label})},o.label))):null,h('input',{'aria-label':q.question,value:answers[q.id]??'',placeholder:q.options?.length?'Or type your own answer':undefined,onChange:e=>setAnswers({...answers,[q.id]:e.target.value})}))),p.kind==='approval'?h('div',{className:'bc-actions'},h('button',{className:'bc-primary',onClick:()=>act('answer',{questionId:p.id,approved:true})},'Approve'),h('button',{onClick:()=>act('answer',{questionId:p.id,approved:false})},'Reject')):h('button',{className:'bc-primary',onClick:()=>act('answer',{questionId:p.id,answers:(p.questions??[]).map(q=>{const v=(answers[q.id]??'').trim(),s=picked[q.id]??[];return q.options?.some(o=>o.label===v)?{id:q.id,selected:[...new Set([...s,v])]}:{id:q.id,selected:s,...v?{custom:v}:{}};})})},'Send answer'));}
// installed copies look for a new release every 6 hours; the shell answers nothing for dev builds and disk image copies
function UpdateBar(){const [version,setVersion]=useState(null),[status,setStatus]=useState('');const invoke=window.__TAURI__?.core?.invoke;
  useEffect(()=>{if(!invoke)return;const check=()=>invoke('check_for_update').then(setVersion,()=>{});check();const timer=setInterval(check,6*60*60*1000);return()=>clearInterval(timer);},[]);
  if(!version)return null;const installing=status==='installing';
  return h('div',{className:'bc-notice',role:'status'},status&&!installing?status:`Bees ${version} is ready to install.`,h('button',{onClick:()=>void openExternal(`https://github.com/Bees-bot/bees-desktop/releases/tag/v${version}`)},"What's new"),h('button',{className:'bc-primary',disabled:installing,onClick:()=>{setStatus('installing');invoke('install_update').then(restarting=>{if(!restarting)setStatus('');},e=>setStatus('Update failed: '+e));}},installing?'Downloading…':'Update and restart'),h('button',{disabled:installing,onClick:()=>setVersion(null)},'Later'));}
function AiConnections({ctx,preferences,modelSettings,models,onModel,current,credits}){
  return h('div',{className:'bc-form'},credits?.available?h('p',{className:'bc-muted'},'Bees Credits uses your personal balance on desktop and web. See Credits & billing to buy tokens or manage auto-renew.'):credits?.message?h('p',{role:'status'},credits.message):null,h('label',{className:'bc-field'},h('span',null,'Default AI'),h('select',{value:current??'',onChange:e=>onModel(e.target.value)},h('option',{value:''},'Use connected system default'),models.map(m=>h('option',{key:m.id,value:m.id},m.name)))),!hosted&&ctx&&preferences&&modelSettings?h(React.Fragment,null,
    h(SubscriptionSettings,{ctx,preferences,modelSettings,ask,openExternal,Button,pickFile:window.__TAURI__?.core?.invoke?options=>window.__TAURI__.core.invoke('plugin:dialog|open',{options}):undefined,onChange:()=>{}}),
    h(CustomAiSettings,{ctx,preferences,modelSettings,ask,confirmAction,openExternal,Button}),
    h(OpenAiServersSettings,{ctx,preferences,modelSettings,ask,Button})
  ):h('p',{className:'bc-muted'},'AI connections are supplied by this hosted Bees Client.'));
}

export function ThreadApp({ctx,preferences,modelSettings,brandMark}) {
  const [data,setData]=useState(null), [selected,setSelected]=useState(null), [thread,setThread]=useState(null);
  const [query,setQuery]=useState(''), [navigation,setNavigation]=useState(null), [suggestion,setSuggestion]=useState(null);
  const [layoutToolbar,setLayoutToolbar]=useState(null);
  const [organizationId,setOrganizationId]=useState(undefined);
  const organizations=data?.organizations??[];
  const [newTemplate,setNewTemplate]=useState('goals'),[composing,setComposing]=useState(false);
  const [teamId,setTeamId]=useState(null),[team,setTeam]=useState(null),[collapsed,setCollapsed]=useState({}),[teamSection,setTeamSection]=useState('general');
  const [dialog,setDialog]=useState(null), [settingsSection,setSettingsSection]=useState('ai'), [threadSection,setThreadSection]=useState('general');
  const [error,setError]=useState(''), [notice,setNotice]=useState(''), [busy,setBusy]=useState(false), [preview,setPreview]=useState(null);
  const [email,setEmail]=useState(''), [role,setRole]=useState('viewer'), [target,setTarget]=useState(''), [inviteLink,setInviteLink]=useState('');
  const selectedRef=useRef(selected), profileEpoch=useRef(0), loginReturn=useRef(null); selectedRef.current=selected;
  const preference=useAppearance(preferences,data?.settings);
  const teamRows=data?.teams??[],teamIds=new Set(teamRows.map(t=>t.id));
  const selectedOrganizationId=organizationId===undefined?(data?.settings?.selectedOrganizationId??null):organizationId;
  const allTeams=[...teamRows,...(data?.directory?.threads??[]).filter(t=>t.kind==='team'&&!teamIds.has(t.id)).map(t=>({id:t.id,organizationId:t.organization_id,title:'Shared team',ownerClientId:t.owner_client_id,shared:true}))];
  const teams=allTeams.filter(t=>selectedOrganizationId?t.organizationId===selectedOrganizationId:!t.organizationId||!organizations.some(o=>o.id===t.organizationId));
  const hiddenTeamIds=data?.settings?.hiddenTeamIds??[],visibleTeams=teams.filter(t=>!hiddenTeamIds.includes(t.id));
  const currentTeamId=visibleTeams.find(t=>t.id===(teamId??data?.settings?.selectedTeamId))?.id??visibleTeams.find(t=>t.id===data?.defaultTeamId)?.id??visibleTeams[0]?.id;
  const teamRef=useRef(currentTeamId);teamRef.current=currentTeamId;
  const theme=THEME_PRESETS.find(t=>t.id===preference.themePreset)??THEME_PRESETS.find(t=>t.id==='corporate');
  const refresh=async()=>{const epoch=profileEpoch.current;const next=await api();if(epoch===profileEpoch.current)setData(next);return next;};
  const read=async id=>{const epoch=profileEpoch.current;const value=await command('read',id);if(epoch===profileEpoch.current&&selectedRef.current===id)setThread(value);return value;};
  const readTeam=async id=>{const epoch=profileEpoch.current;const value=await command('read',id);if(epoch===profileEpoch.current&&teamRef.current===id)setTeam(value);return value;};
  const perform=async fn=>{setBusy(true);setError('');setNotice('');try{return await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const act=(action,values={})=>perform(async()=>{const id=selected;const result=await command(action,id,values);await refresh();if(id)await read(id);return result;});
  const select=id=>{if(id!==selected){setThread(null);setError(e=>e===offline?e:'');}const row=data?.threads.find(t=>t.id===id)??data?.directory?.threads.find(t=>t.id===id);const parent=row?.teamId??row?.team_id;if(parent&&allTeams.some(t=>t.id===parent))setTeamId(parent);selectedRef.current=id;setSelected(id);setComposing(false);setNewTemplate('goals');setSuggestion(null);setNavigation({id:'conversation'});setDialog(null);setInviteLink('');setNotice('');};
  const navigate=next=>{setNavigation({id:next});setDialog(null);};
  const closeDialog=()=>{const returnTo=loginReturn.current;loginReturn.current=null;setDialog(returnTo?'team':null);setError('');setNotice('');};
  const openSettings=(section,id=selected)=>{if(id!==selected)select(id);setThreadSection(section);setInviteLink('');setNotice('');setDialog('thread');};
  const openTeamSettings=(section='general',id=currentTeamId)=>{if(id!==currentTeamId){select(null);setTeamId(id);setTeam(null);}setTeamSection(section);setInviteLink('');setNotice('');setDialog('team');};
  const openGlobal=section=>{setSettingsSection(section);setDialog('settings');setNotice('');};
  useEffect(()=>{
    const previousTitle=document.title;document.title='Bees Client';
    const style=document.createElement('style');style.textContent=threadCss;document.head.append(style);
    const dismissMenus=event=>{for(const menu of document.querySelectorAll('.bc-thread-menu[open],.bc-brand-menu[data-open]'))if(!menu.contains(event.target)){if(menu.matches('.bc-brand-menu'))closeHoverMenu(menu);else menu.open=false;}};
    document.addEventListener('pointerdown',dismissMenus,true);
    // a menu on the last thread opened under the bottom edge of the list
    const revealMenu=event=>{if(event.target.matches?.('.bc-thread-menu[open]'))event.target.querySelector('nav')?.scrollIntoView({block:'nearest'});};
    document.addEventListener('toggle',revealMenu,true);
    // a file dropped outside a drop area would open in place of the app
    const blockDrop=event=>{if(!event.dataTransfer?.types?.includes('Files'))return;if(event.type==='dragover'&&!event.defaultPrevented)event.dataTransfer.dropEffect='none';event.preventDefault();};
    document.addEventListener('dragover',blockDrop);document.addEventListener('drop',blockDrop);
    // a call that failed while the server was down left its error up after the connection came back
    let alive=true;const tick=()=>{if(alive)void refresh().then(next=>{if(!next?.connectionError)setError(e=>e===offline?'':e);}).catch(e=>{setError(e.message);setData(previous=>previous?{...previous,connectionError:e.message}:previous);if(hosted&&e.status===401)setDialog('login');});};
    tick();const timer=setInterval(tick,5000);
    return()=>{alive=false;clearInterval(timer);document.removeEventListener('pointerdown',dismissMenus,true);document.removeEventListener('toggle',revealMenu,true);document.removeEventListener('dragover',blockDrop);document.removeEventListener('drop',blockDrop);style.remove();document.title=previousTitle;};
  },[]);
  // a reload opened the empty start screen instead of the thread you were in
  const restored=useRef(false);
  useEffect(()=>{if(!data||restored.current)return;let id=null;try{id=localStorage.getItem('bees:open-thread');}catch{}
    const found=!!id&&(data.threads.some(t=>t.id===id)||!!data.directory?.threads.some(t=>t.id===id&&t.kind!=='team'));
    if(!found&&data.connectionError)return;restored.current=true;if(found&&!selectedRef.current)select(id);},[data]);
  useEffect(()=>{if(restored.current)try{selected?localStorage.setItem('bees:open-thread',selected):localStorage.removeItem('bees:open-thread');}catch{}},[selected]);
  useEffect(()=>{setPreview(null);setThread(null);if(selected)void read(selected).catch(e=>{if(selectedRef.current===selected)setError(e.message);});},[selected]);
  // the owner deleted it or took our access away, so close it instead of showing the old copy
  useEffect(()=>{if(selected&&thread)void read(selected).catch(()=>{if(selectedRef.current===selected&&data&&!data.connectionError&&!data.threads.some(t=>t.id===selected)&&!data.directory?.threads.some(t=>t.id===selected)){select(null);setNotice('That thread was deleted, or you no longer have access to it.');}});},[data]);
  useEffect(()=>{setTeam(null);if(currentTeamId)void readTeam(currentTeamId).catch(e=>setError(e.message));},[currentTeamId]);
  useEffect(()=>{if(currentTeamId)void readTeam(currentTeamId).catch(()=>{});},[data]);
  useEffect(()=>{if(preferences?.getSnapshot().status==='ready')(ctx?.get?.('theme')??ctx?.theme)?.setTheme(theme.dark?'dark':'light');},[ctx,theme.id]);
  const loadOrganizations=async()=>{const value=await command('organizations');await refresh();return value.organizations;};
  const chooseOrganization=(id,accountId,settings=false)=>perform(async()=>{
    profileEpoch.current++;await command('selectOrganization',null,{accountId,organizationId:id});clearAccount();setOrganizationId(id);await refresh();if(settings)openGlobal('organizations');
  });
  const createOrganization=accountId=>{if(!data?.user&&!accountId){setDialog('login');return;}void perform(async()=>{const name=await ask('Organization name','');if(!name?.trim())return;if(accountId&&accountId!==data?.accounts?.find(account=>account.active)?.id){profileEpoch.current++;await command('switchAccount',null,{accountId});clearAccount();}const org=await command('createOrganization',null,{name});await loadOrganizations();select(null);setTeamId(null);setOrganizationId(org.id);await command('preferences',null,{values:{selectedOrganizationId:org.id}});await refresh();});};
  const saveAppearance=values=>perform(async()=>{
    if(preferences){if(preferences.getSnapshot().status!=='ready')throw Error('Settings are still loading');for(const [key,value] of Object.entries(values))await preferences.set(key,value);}
    else {await command('preferences',null,{values});await refresh();}
  });
  const clearAccount=()=>{profileEpoch.current++;select(null);setOrganizationId(undefined);setTeamId(null);setTeam(null);setCollapsed({});setThread(null);setPreview(null);setSuggestion(null);setData(null);};
  // the thread is saved on its first message, so an unused New Goal or New Chat leaves nothing behind
  // composing keeps the empty thread on screen on a phone, where the list and the thread take turns
  const create=(templateId='goals',id=currentTeamId)=>{select(null);setComposing(true);setTeamId(id);setNewTemplate(templateId);setCollapsed(values=>({...values,[id]:false}));requestAnimationFrame(()=>document.querySelector('.bc-composer textarea')?.focus());};
  const deleteThread=t=>perform(async()=>{if(!await confirmAction(`Delete “${t.title}”? Its messages, runs and files are removed for everyone in it. This can’t be undone.`,'Delete'))return;await command('delete',t.id);if(selectedRef.current===t.id)select(null);await refresh();});
  const chooseTeam=id=>perform(async()=>{select(null);setTeamId(id);setTeam(null);setCollapsed(values=>({...values,[id]:false}));await command('preferences',null,{values:{selectedTeamId:id,hiddenTeamIds:hiddenTeamIds.filter(hidden=>hidden!==id)}});await refresh();});
  const hideTeam=id=>perform(async()=>{if(threads.some(t=>t.id===selected&&threadTeamId(t)===id)||currentTeamId===id){select(null);setTeamId(null);setTeam(null);}await command('preferences',null,{values:{hiddenTeamIds:[...new Set([...hiddenTeamIds,id])]}});await refresh();});
  const createTeam=()=>perform(async()=>{const name=await ask('Team name','');if(!name?.trim())return;const next=await command('createTeam',null,{name,...(selectedOrganizationId?{organizationId:selectedOrganizationId}:{})});await refresh();select(null);setTeamId(next.id);});
  const checkSize=files=>{const big=files.find(file=>file.size>10_000_000);if(big)throw Error(`${big.name} is over 10 MB. Files must be 10 MB or smaller.`);};
  const encode=file=>new Promise((ok,bad)=>{const reader=new FileReader();reader.onload=()=>ok(reader.result.split(',')[1]);reader.onerror=()=>bad(Error('Could not read '+file.name));reader.readAsDataURL(file);});
  // checked before perform, whose finally would clear busy while the first send is still out
  const send=(text,discussion=false,onAccepted,files=[])=>!text.trim()||busy||!canWrite||active&&!discussion?Promise.resolve(false):perform(async()=>{
    // read files before creating the thread, so a bad file never leaves an empty thread behind
    checkSize(files);const contents=await Promise.all(files.map(encode));
    let id=selected;if(!id){const created=await command('create',null,{templateId:newTemplate,teamId:currentTeamId});id=created.id;select(id);}
    // the file ids ride on the message, so it shows what was sent with it
    const ids=files.map(()=>crypto.randomUUID());
    for(const [i,file] of files.entries())await command('attach',id,{name:file.name,path:file.name,content:contents[i],operationId:ids[i]});
    await command(discussion?'discussion':'message',id,{text,...(ids.length?{files:ids}:{})});onAccepted?.();
    if(!discussion)await command('run',id,{text});await refresh();await read(id);return true;
  });
  const attach=(files,prefix='',id=selected)=>perform(async()=>{
    if(!id)throw Error('Start a thread before attaching files');
    checkSize(files);
    for(const file of files)await command('attach',id,{name:file.name,path:prefix+(file.webkitRelativePath||file.name),content:await encode(file)});
    if(id===currentTeamId)await readTeam(id);else await read(id);setNotice(`Added ${files.length} file${files.length===1?'':'s'}.`);return true;
  });
  const roster=data?.directory??{threads:[],participants:[],clients:[],invitations:[]};
  const known=new Set(data?.threads?.map(t=>t.id));
  const threadTeamId=t=>allTeams.some(team=>team.id===t.teamId)?t.teamId:data?.defaultTeamId;
  const threads=[...(data?.threads??[]),...roster.threads.filter(t=>t.kind!=='team'&&!known.has(t.id)).map(t=>({id:t.id,teamId:t.team_id,title:'Shared thread',shared:true,ownerClientId:t.owner_client_id}))]
    .filter(t=>visibleTeams.some(team=>team.id===threadTeamId(t))&&(t.id===query.trim()||(t.title+' '+(t.preview??'')).toLowerCase().includes(query.trim().toLowerCase())));
  const authority=roster.threads.find(t=>t.id===selected), participants=roster.participants.filter(p=>p.thread_id===selected);
  const owner=roster.clients.find(c=>c.id===(authority?.owner_client_id??thread?.ownerClientId));
  const own=!!thread&&thread.ownerClientId===data?.clientId, manage=!!thread&&(own||thread.ownerUserId===data?.user?.id);
  const run=thread?.runs?.at(-1), active=run?.status==='running';
  // the 5 second roster tick is too slow to watch a reply come in
  useEffect(()=>{if(!active||!selected)return;const timer=setInterval(()=>void read(selected).catch(()=>{}),1500);return()=>clearInterval(timer);},[active,selected]);
  const canEdit=!selected||!!thread&&(own||participants.some(p=>p.user_id===data?.user?.id&&p.role!=='viewer'));
  const canWrite=canEdit&&!thread?.frozen&&!thread?.unavailable;
  const canConfigure=manage&&canWrite;
  const teamParticipants=roster.participants.filter(p=>p.thread_id===currentTeamId),teamOwn=!!team&&team.ownerClientId===data?.clientId;
  const teamRole=teamParticipants.find(p=>p.user_id===data?.user?.id)?.role;
  const canConfigureTeam=!!team&&(teamOwn||team.ownerUserId===data?.user?.id)&&!team.frozen&&!team.unavailable;
  const canCreateInTeam=!!team&&(!team.shared||['owner','editor'].includes(teamRole))&&!team.frozen&&!team.unavailable;
  const viewOnly=selected?!!thread&&!canEdit&&!thread.unavailable:teamRole==='viewer';
  const peerNames=new Map(roster.participants.map(p=>[p.user_id,p.name??p.email]));
  const transferClients=roster.clients.filter(c=>c.id!==data?.clientId&&(c.user_id===data?.user?.id||participants.some(p=>p.user_id===c.user_id&&p.role!=='viewer')));
  const previewFile=file=>setPreview({...file,url:`/bees-api/thread-file?thread=${selected}&artifact=${file.id}`});
  const saveThread=values=>perform(async()=>{await command('configure',selected,values);await refresh();await read(selected);setNotice('Thread settings saved.');});
  const saveFolder=values=>perform(async()=>{await command('setRootFolder',null,values);await refresh();setNotice('Folder settings saved.');return true;});
  const saveTeam=values=>perform(async()=>{await command('configure',currentTeamId,values);await refresh();await readTeam(currentTeamId);setNotice(values.processes!==undefined?'Processes saved. Start a new thread to use them.':'Team settings saved. Changes apply to new runs in every thread.');return true;});
  const leaveTeam=()=>perform(async()=>{if(!await confirmAction(`Leave ${team.title}? You lose access to its threads. Threads you started on this computer stay with you.`,'Leave'))return;await command('leave',currentTeamId);setDialog(null);select(null);setTeamId(null);setTeam(null);await refresh();});
  const teamAction=(action,values)=>perform(async()=>{await command(action,currentTeamId,values);await refresh();await readTeam(currentTeamId);});
  const files=thread?h(ThreadFiles,{key:selected,thread,canWrite,busy,onAttach:attach,onPreview:previewFile,preview,onClosePreview:()=>setPreview(null)}):null;
  const signInForApps=()=>{loginReturn.current=currentTeamId;setError('');setDialog('login');};
  const integrations=section=>team?h(IntegrationSettings,{key:currentTeamId+section,threadId:currentTeamId,canManage:(teamOwn||['owner','editor'].includes(teamRole))&&!team.unavailable&&!team.frozen,signedIn:data?.signedIn??!!data?.user,onSignIn:signInForApps,request:command,perform,page:section}):null;
  const configuration=(section,note)=>team?h(React.Fragment,null,canConfigureTeam||!note?null:h('p',{className:'bc-muted'},'Only the team owner can change shared settings.'),h(WorkflowSettings,{key:currentTeamId+section+(canConfigureTeam?'':team.revision),thread:team,agents:team.agents??[],scope:'team',section,disabled:!canConfigureTeam,busy,onSave:saveTeam})):h('p',{role:'status'},'Loading team settings…');
  const members=h('section',{className:'bc-form'},h('h3',null,'Members'),
    !teamParticipants.length?h('p',null,'Only you have access to this private team.'):null,
    teamParticipants.map(p=>h('div',{key:p.user_id,className:'bc-person'},h('span',null,p.name??p.email),h('small',null,{owner:'Owner',editor:'Can contribute and run work',viewer:'Can view'}[p.role]??p.role),
      canConfigureTeam&&p.role!=='owner'?h('button',{disabled:busy,onClick:async()=>{if(await confirmAction(`Remove ${p.name??p.email} from this team? They lose access to all of its threads.`,'Remove'))void teamAction('remove',{userId:p.user_id});}},'Remove'):null)),
    canConfigureTeam?h('button',{onClick:()=>setTeamSection('invitations')},'Invite someone'):null,
    team?.shared&&!teamOwn&&teamRole&&teamRole!=='owner'?h('button',{disabled:busy,onClick:leaveTeam},'Leave team'):null);
  const invitations=h('form',{className:'bc-form',onSubmit:event=>{event.preventDefault();void perform(async()=>{
    if(!data?.user){setDialog('login');return;}const invite=await command('share',currentTeamId,{email,role});setInviteLink(invite.url);setNotice(`Invited ${email}. It shows in their Bees sidebar, or you can send them the link below.`);setEmail('');await refresh();await readTeam(currentTeamId);
  });}},h('h3',null,'Invitations'),h('p',{className:'bc-muted'},'Invite someone to this team and all its threads, including people outside your organization.'),
    h(Field,{label:'Email',type:'email',required:true,disabled:!canConfigureTeam,value:email,onChange:e=>{setEmail(e.target.value);e.target.setCustomValidity(e.target.value.trim().toLowerCase()===data?.user?.email?.toLowerCase()?'This is your own email.':'');}}),
    h('label',{className:'bc-field'},h('span',null,'Access'),h('select',{value:role,disabled:!canConfigureTeam,onChange:e=>setRole(e.target.value)},
      h('option',{value:'viewer'},'Can view'),h('option',{value:'editor'},'Can contribute and run work'))),
    h('button',{type:'submit',className:'bc-primary',disabled:busy||!canConfigureTeam},data?.user?'Create invitation':'Sign in to invite'),
    inviteLink?h('label',{className:'bc-field'},h('span',null,'Invitation link'),h('input',{readOnly:true,value:inviteLink,onFocus:e=>e.target.select()})):null);
  const transfer=h('form',{className:'bc-form',onSubmit:e=>{e.preventDefault();void act('transfer',{targetClientId:target});}},
    h('h3',null,'Transfer thread'),h('p',{className:'bc-muted'},own?'Move the thread, its files and its runs to another computer in this thread. Sign in to its add-ons again there and choose browser access.':`Only ${owner?.name??'the computer running this thread'} can transfer it.`),
    own?h('select',{'aria-label':'Move to',value:target,required:true,onChange:e=>setTarget(e.target.value)},h('option',{value:''},transferClients.length?'Choose a computer':'No other computer has joined this thread yet'),transferClients.map(c=>h('option',{key:c.id,value:c.id},c.name))):null,
    own?h('button',{className:'bc-primary',type:'submit',disabled:busy||active||!data?.user||!transferClients.length},active?'Wait for the run to finish':thread?.frozen?'Resend offer':'Offer transfer'):null,
    own&&authority?.transfer_client_id?h('button',{type:'button',onClick:()=>act('cancelTransfer')},'Cancel pending transfer'):null);
  const verifyEmail=()=>perform(async()=>{await command('verifyEmail');setNotice('Check your email to verify your account.');});
  const account=h('section',{className:'bc-form'},h('h3',null,'Accounts'),
    (data?.accounts??[]).map(account=>h('div',{key:account.id,className:'bc-person'},h('div',null,h('strong',null,account.user.email),h('small',{className:'bc-account-server'},account.url)),
      h('button',{disabled:busy||account.active,'aria-pressed':account.active,onClick:()=>perform(async()=>{await command('switchAccount',null,{accountId:account.id});clearAccount();await refresh();openGlobal('account');})},account.active?'✓ Current view':'Open'))),
    data?.user&&!data.user.emailVerified?h(React.Fragment,null,h('p',{className:'bc-muted'},'Your email isn’t verified yet. You need that to accept invitations or invite people to an organization.'),h('button',{disabled:busy,onClick:verifyEmail},'Send verification email')):null,
    h('button',{disabled:busy,onClick:()=>setDialog('login')},data?.user?'Add account':'Sign in'),
    data?.user?h('button',{disabled:busy,onClick:()=>perform(async()=>{await command('logout');clearAccount();await refresh();setDialog(hosted?'login':'settings');setSettingsSection('account');})},'Sign out of this account'):null);
  const threadContent=!thread?h('p',{role:'status'},'Loading thread settings…')
    :threadSection==='transfer'?transfer:h(React.Fragment,null,manage?null:h('p',{className:'bc-muted'},'Only the person who started this thread can rename it.'),h(WorkflowSettings,{key:selected,thread,scope:'thread',section:'general',disabled:!canConfigure,busy,onSave:saveThread}));
  const teamFiles=team?h(ThreadFiles,{key:currentTeamId,thread:team,canWrite:canConfigureTeam,busy,onAttach:(files,prefix)=>attach(files,prefix,currentTeamId),onPreview:file=>setPreview({...file,url:`/bees-api/thread-file?thread=${currentTeamId}&artifact=${file.id}`}),preview,onClosePreview:()=>setPreview(null)}):null;
  const legacyRows=(data?.threads??[]).filter(t=>t.teamId===currentTeamId&&t.legacySettings&&t.ownerClientId===data?.clientId);
  const teamContent=!team?h('p',{role:'status'},'Loading team settings…')
    :teamSection==='processes'?h(TeamProcesses,{key:currentTeamId,team,canManage:canConfigureTeam,canCreate:canCreateInTeam,busy,onSave:processes=>saveTeam({processes}),onStart:templateId=>create(templateId,currentTeamId)})
    :teamSection==='agents'?h(TeamAgents,{key:currentTeamId,team,models:data?.models, presets:data?.agentPresets,canManage:canConfigureTeam,busy,onSave:agents=>saveTeam({agents})})
    :teamSection==='memory'?h(React.Fragment,null,h(TeamMemory,{key:currentTeamId,teamId:currentTeamId,canManage:canConfigureTeam,request:command}),configuration('memory'))
    :['general','workflow','schedule'].includes(teamSection)?configuration(teamSection)
    :teamSection==='members'?members:teamSection==='invitations'?invitations
    :teamSection==='folders'?teamFiles:integrations(teamSection);
  const globalContent=settingsSection==='ai'?h(AiConnections,{ctx,preferences,modelSettings,models:data?.models??[],current:data?.defaultModel,credits:data?.credits,onModel:model=>act('model',{model})})
    :settingsSection==='credits'?h(CreditSettings,{key:data?.user?.id??'local',connection:data?.credits,user:data?.user,request:(action,values)=>command(action,null,values),onRefresh:refresh,onSignIn:()=>setDialog('login')})
    :settingsSection==='appearance'?h(AppearanceSettings,{preference,onSave:saveAppearance,disabled:busy||!!preferences&&preferences.getSnapshot().status!=='ready'})
    :settingsSection==='organizations'?(data?.user?h(OrganizationsPanel,{key:data.user.id+selectedOrganizationId,perform,busy,icon,ctx,folders:data?.folders,onSaveFolder:saveFolder,organizationId:selectedOrganizationId,onChanged:loadOrganizations,onNotice:setNotice}):h('button',{onClick:()=>setDialog('login')},'Sign in to manage organizations'))
    :settingsSection==='storage'?h(RootFolderSettings,{ctx,folders:data?.folders,busy,onSave:saveFolder})
    :settingsSection==='account'?account
    :settingsSection==='instructions'?h('form',{className:'bc-form',key:data?.clientId,onSubmit:event=>{event.preventDefault();const systemInstructions=new FormData(event.currentTarget).get('instructions');void perform(async()=>{await command('preferences',null,{values:{systemInstructions}});await refresh();setNotice('System instructions saved.');});}},
      h('h3',null,'System instructions'),h('p',{className:'bc-muted'},'Used for new runs in every thread on this computer.'),h('textarea',{'aria-label':'System instructions',name:'instructions',rows:10,maxLength:20000,defaultValue:data?.settings?.systemInstructions??''}),h('button',{className:'bc-primary',disabled:busy||!data},'Save instructions'))
    :h('section',{className:'bc-form'},h('h3',null,'Data & files'),h('p',null,'Threads keep their own files and folders. Add files or whole folders from a thread’s Files tab.'),h('p',{className:'bc-muted'},'Files and results travel with a shared or transferred thread. AI connections, browser access and add-on keys and sign-ins stay on the computer where you set them up.'));
  const effectiveThread=thread&&{...thread,workflow:workflowFor(thread,team),instructions:[team?.instructions,thread.instructions].filter(Boolean).join('\n\n'),memory:[...(team?.memory??[]),...(thread.memory??[])]};
  const templates=[...WORKFLOW_TEMPLATES,...(team?.processes??[])];
  const conversation=discussion=>h(ThreadConversation,{key:selected??'welcome',thread:effectiveThread,discussion,peerNames,userId:data?.user?.id,userName:data?.user?.name||data?.user?.email?.split('@')[0],canWrite:selected?canWrite:canCreateInTeam,viewOnly,manage,run,active,busy,act,onSend:send,onAttach:attach,onFiles:()=>navigate('files'),onOpenFile:file=>{navigate('files');previewFile(file);},suggestion:selected?null:suggestion,templates,
    templateId:thread?.processId&&templates.some(t=>t.id===thread.processId)?thread.processId:effectiveThread?(workflowTemplate(effectiveThread.workflow)?.id??'custom'):newTemplate,
    onTemplateChange:templateId=>{setNewTemplate(templateId);if(thread)void act('configure',{workflow:templates.find(t=>t.id===templateId).workflow,processId:templateId});}});
  const renderWidget=page=>!thread?h('p',{className:'bc-muted',role:'status'},'Connecting to this thread…')
    :['conversation','discussion'].includes(page)?conversation(page==='discussion')
    :h('section',{className:'bc-conversation'+(page==='files'?' bc-files-tab':'')},
      page==='kanban'?h(ThreadKanban,{key:selected,thread:effectiveThread,onConversation:()=>navigate('conversation'),onWorkflow:()=>openTeamSettings('workflow')})
      :page==='files'?files:page==='addons'?integrations('addons'):['schedule','memory'].includes(page)?configuration(page,true)
      :h(ThreadDetails,{thread:effectiveThread,page,peerNames,userId:data?.user?.id,onSettings:openSettings,onFiles:()=>navigate('files')}));
  const renderThread=t=>h('div',{key:t.id,className:'bc-thread-row '+(selected===t.id?'active':'')},
    h('button',{className:'bc-thread',title:t.title,'aria-current':selected===t.id?'page':undefined,onClick:()=>select(t.id)},h('span',{className:'bc-thread-symbol'},icon(t.processId==='chat'?'chat':'goal')),
      h('span',null,h('strong',null,t.title),h('small',null,t.preview?.replace(/^\s*(?:#+|>|[-*+])\s|\*\*?|`/gm,'')??'Open shared work')),t.runs?.some(r=>r.status==='running')?h('span',{className:'bc-dot',title:'Running'}):null),
    h('div',{className:'bc-thread-meta'},
      h('details',{className:'bc-thread-menu',onKeyDown:event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary').focus();}}},
        h('summary',{'aria-label':`Settings for ${t.title}`,title:'Thread settings'},icon('more')),
        h('nav',{'aria-label':`${t.title} settings`},THREAD_SETTINGS.map(([id,label])=>h('button',{key:id,onClick:event=>{event.currentTarget.closest('details').open=false;openSettings(id,t.id);}},label)),
          t.ownerClientId===data?.clientId?h('button',{disabled:busy||t.runs?.some(r=>r.status==='running'),title:t.runs?.some(r=>r.status==='running')?'Stop the work running in this thread first':undefined,onClick:event=>{event.currentTarget.closest('details').open=false;deleteThread(t);}},'Delete'):null))));
  const acceptInvitation=invitation=>perform(async()=>{
    await command('acceptInvitation',null,{invitationId:invitation.id});
    const next=await refresh(),joined=next.directory.threads.find(t=>t.id===invitation.thread_id);
    const parent=joined?.kind==='team'?joined:next.directory.threads.find(t=>t.id===joined?.team_id);
    const scope=organizations.some(o=>o.id===parent?.organization_id)?parent.organization_id:null;
    setOrganizationId(scope);await command('preferences',null,{values:{selectedOrganizationId:scope}});
    if(joined?.kind==='team'){select(null);setTeamId(joined.id);setCollapsed(values=>({...values,[joined.id]:false}));}else select(invitation.thread_id);
  });
  const teamThreads=id=>threads.filter(t=>threadTeamId(t)===id);
  const settingsOpen=dialog==='settings'||dialog==='team', modalOpen=dialog==='thread'||dialog==='login';
  const currentTeam=teams.find(t=>t.id===currentTeamId);
  const settingsTitle=dialog==='team'?`Team settings${currentTeam?' · '+currentTeam.title:''}`:settingsSection==='organizations'?'Org settings':'Global settings';
  if(data?.onboarding===null)return h('div',{className:'bc-app bc-onboarding-app','data-bees-theme':theme.id,style:themeStyle(theme)},
    h(FirstStart,{user:data.user,organizations,busy,error,onSignIn:()=>setDialog('login'),
      onVerify:verifyEmail,
      onCloud:values=>void perform(async()=>{await command('completeOnboarding',null,{mode:'cloud',...values});clearAccount();await refresh();}),
      onLocal:()=>void perform(async()=>{await command('completeOnboarding',null,{mode:'local'});clearAccount();await refresh();openGlobal('ai');})}),
    notice?h('p',{role:'status'},notice):null,
    dialog==='login'?h(Dialog,{title:'Sign in',onClose:closeDialog},h(Login,{server:data.serverUrl,request:(action,values)=>command(action,null,values),onComplete:async()=>{await refresh();closeDialog();}})):null);
  return h('div',{className:'bc-app '+(selected||composing||settingsOpen?'has-thread':''),'data-bees-theme':theme.id,style:themeStyle(theme)},
    h(BeesNavigation,{brandMark,icon,organizations,accounts:data?.accounts??[],user:data?.user,localActive:data?.localActive,organizationId:selectedOrganizationId,theme,busy:busy||!data,
      onOrganization:chooseOrganization,onCreateOrganization:createOrganization,onGlobal:openGlobal,
      onTheme:()=>{const next=nextThemePreset(preference);void saveAppearance({themePreset:next.id,colorMode:next.dark?'dark':'light'});},onAccount:()=>openGlobal('account')}),
    h('aside',{className:'bc-sidebar','aria-label':'Threads'},
      h('div',{className:'bc-thread-create'},
        h('button',{'aria-label':'New Goal',disabled:busy||!canCreateInTeam,onClick:()=>create('goals')},icon('goal'),'New Goal'),
        h('button',{'aria-label':'New Chat',disabled:busy||!canCreateInTeam,onClick:()=>create('chat')},icon('chat'),'New Chat'),
        h(TeamManagement,{icon,busy:busy||!data,hasTeam:!!currentTeamId,onTeam:()=>openTeamSettings(),onCreateTeam:createTeam,hiddenTeams:teams.filter(team=>hiddenTeamIds.includes(team.id)),onSelectTeam:chooseTeam})),
      h('div',{className:'bc-search'},icon('search'),h('input',{'aria-label':'Search threads',placeholder:'Find a thread…',value:query,onChange:e=>setQuery(e.target.value)})),
      h('div',{className:'bc-thread-list'},visibleTeams.map(row=>h(TeamSection,{key:row.id,team:row,grouped:teams.length>1,active:currentTeamId===row.id,expanded:!!query||!collapsed[row.id],count:teamThreads(row.id).length,
        onToggle:()=>{if(currentTeamId!==row.id)void chooseTeam(row.id);else setCollapsed(values=>({...values,[row.id]:!values[row.id]}));},
        menu:h(TeamMenu,{team:row,icon,busy,canCreate:!row.shared||roster.participants.some(p=>p.thread_id===row.id&&p.user_id===data?.user?.id&&['owner','editor'].includes(p.role)),onCreate:create,onSettings:openTeamSettings,onHide:hideTeam})},
        teamThreads(row.id).map(renderThread),!teamThreads(row.id).length?h('p',{className:'bc-muted bc-empty-list'},query?'No matching threads.':'No threads yet. Start one with New Chat or New Goal.'):null)),
        !visibleTeams.length?h('p',{className:'bc-muted bc-empty-list'},teams.length?'Choose a hidden team from Manage teams to show it here.':'Create a team from Manage teams to get started.'):null),
      roster.invitations?.length?h('section',{className:'bc-invitations'},h('strong',null,'Invitations'),
        roster.invitations.map(i=>h('div',{key:i.id,className:'bc-person'},h('span',null,`${i.invited_by_name??'Someone'} invited you`,h('small',null,i.role==='viewer'?'Can view':'Can contribute and run work')),
          data.user?.emailVerified?h('button',{disabled:busy,onClick:()=>acceptInvitation(i)},'Accept'):null)),
        data.user?.emailVerified?null:h(React.Fragment,null,h('p',{className:'bc-muted'},'Verify your email to accept.'),h('button',{disabled:busy,onClick:verifyEmail},'Send verification email'))):null,
      h('footer',null,h('span',{className:'bc-dot '+(data?.connectionError?'offline':'')}),h('span',null,data?.connectionError?"Can't reach Bees right now":data?.user?'Connected to Bees':'Private on this machine',(data?.connectionError||data?.user)&&data?.serverUrl?h('small',{className:'bc-server-url'},data.serverUrl):null))),
    h('main',{className:'bc-main'},h(UpdateBar),settingsOpen?h(React.Fragment,null,
      error?h('p',{className:'bc-error',role:'alert'},error):null,notice?h('p',{className:'bc-notice',role:'status'},notice):null,
      h(SettingsPage,{title:settingsTitle,items:dialog==='team'?TEAM_SETTINGS:GLOBAL_SETTINGS,selected:dialog==='team'?teamSection:settingsSection,
        onSelect:section=>{if(dialog==='team')setTeamSection(section);else setSettingsSection(section);setNotice('');},onClose:closeDialog},
        dialog==='team'?h(React.Fragment,null,team&&!canConfigureTeam&&!['addons','browser'].includes(teamSection)?h('p',{className:'bc-muted'},'Only the team owner can change shared settings.'):null,teamContent,
          team&&legacyRows.length&&['general','memory','workflow','schedule','addons','browser'].includes(teamSection)?h(LegacyOverrides,{key:currentTeamId+teamSection,rows:legacyRows,section:teamSection,perform,busy,signedIn:data?.signedIn??!!data?.user,onSignIn:signInForApps}):null):globalContent))
      :null,h('section',{className:'bc-thread-surface',hidden:settingsOpen},
      h('header',{className:'bc-thread-header'},h('button',{className:'bc-icon bc-back-to-threads','aria-label':'Show threads',onClick:()=>select(null)},'‹'),h('div',null,h('h2',null,thread?.title??(selected?'Loading thread…':'A little help. A lot done.')),
        h('p',null,selected?(owner?.name??(own?'This machine':'Shared work')):'Your people, AI, and work in one conversation.')),
        selected?h('div',{className:'bc-actions'},
          h('button',{'aria-label':'Thread settings',onClick:()=>openSettings('general')},icon('more')),h('button',{title:'Invite to team',onClick:()=>openTeamSettings('invitations')},icon('share'),'Share'),h('span',{className:'bc-layout-toolbar',ref:setLayoutToolbar})):null),
      error&&!modalOpen?h('div',{className:'bc-error',role:'alert'},error,h('button',{className:'bc-icon','aria-label':'Dismiss error',onClick:()=>setError('')},icon('close'))):null,
      notice&&!modalOpen?h('div',{className:'bc-notice',role:'status'},notice):null,
      !hosted&&data&&!data.models?.length&&!data.credits?.available?h('div',{className:'bc-notice'},'Connect an AI model so Bees can reply. ',h('button',{className:'bc-primary',onClick:()=>{setSettingsSection('ai');setDialog('settings');}},'Open AI connections')):null,
      thread?.frozen?h('div',{className:'bc-notice'},'This thread is frozen for transfer. The recipient must accept, or you can cancel the offer.'):null,
      thread?.unavailable?h('div',{className:'bc-notice'},'Showing the copy saved here. ',thread.unavailable):null,
      authority?.transfer_client_id&&authority.transfer_client_id===data?.clientId?h('div',{className:'bc-notice'},'A thread transfer is waiting for you. ',h('button',{className:'bc-primary',onClick:()=>act('acceptTransfer')},'Accept transfer')):null,
      selected?h(ThreadWorkspace,{key:data.clientId,initialLayout:data.settings?.threadLayout,toolbar:layoutToolbar,navigation,renderWidget,
        onSave:async threadLayout=>{await command('preferences',null,{values:{threadLayout}});await refresh();}})
      :h('div',{className:'bc-welcome-view'},h('section',{className:'bc-conversation'},
        h('div',{className:'bc-welcome'},h('span',{className:'bc-welcome-mark'},'✳'),h('h2',null,'What would you like to get done?'),h('p',null,'Start with an idea. Add files and people as you go.'),
          h('div',{className:'bc-suggestions'},['Research a topic','Make sense of my files','Prepare a weekly update'].map(s=>h('button',{key:s,disabled:!canCreateInTeam,onClick:()=>setSuggestion({text:s})},s))))),conversation(false)))),
    modalOpen?h(Dialog,{wide:dialog==='thread',title:dialog==='thread'?`Thread settings${thread?' · '+thread.title:''}`:'Welcome to Bees',onClose:closeDialog},
      error?h('p',{className:'bc-error',role:'alert'},error):null,notice?h('p',{className:'bc-notice',role:'status'},notice):null,
      dialog==='thread'?h('div',{className:'bc-settings-layout'},h(SettingsNav,{items:THREAD_SETTINGS,selected:threadSection,onSelect:section=>{setThreadSection(section);setNotice('');},label:'Thread settings sections'}),h('div',{className:'bc-settings-content'},threadContent))
      :h(Login,{server:data?.serverUrl,request:(action,values)=>command(action,null,values),onComplete:async()=>{
        const returnTo=loginReturn.current;loginReturn.current=null;clearAccount();const next=await refresh();setError('');setNotice('');
        if(returnTo){const target=next.teams.find(team=>team.id===returnTo)??next.teams.find(team=>team.id===next.defaultTeamId);setTeamId(target?.id);setOrganizationId(target?.organizationId??null);setTeamSection('addons');setDialog('team');}
        else setDialog(null);
      }})):null);

}

export function ThreadConversation({thread,discussion,peerNames,userId,userName,canWrite,viewOnly,manage,run,active,busy,act,onSend,onAttach,onFiles,onOpenFile,suggestion,templateId='goals',onTemplateChange,templates=WORKFLOW_TEMPLATES}){
  const [draft,setDraft]=useState(''),[pending,setPending]=useState([]),end=useRef(),picker=useRef(),pinned=useRef(true);
  const addPending=picked=>setPending(current=>[...current.filter(f=>!picked.some(p=>p.name===f.name)),...picked]);
  const take=files=>thread?void onAttach(files):addPending(files);
  const chatting=isChatWorkflow(thread?.workflow)||templateId==='chat';
  const messages=(thread?.messages??[]).filter(m=>discussion?m.kind==='discussion':m.kind!=='discussion');
  // an older stopped or failed run would leave its message with no reply and no reason
  const unanswered=new Map();if(!discussion)for(const r of thread?.runs??[])if(r.error&&r.status!=='running'&&r!==run){let i=messages.findLastIndex(m=>m.createdAt<=r.createdAt);while(messages[i+1]?.kind==='assistant')i++;if(i>=0)unanswered.set(messages[i].id,r.error);}
  useEffect(()=>{if(suggestion&&!discussion)setDraft(suggestion.text);},[suggestion]);
  // follow new words and messages unless the person scrolled up to read, but always show one they just sent
  const sent=messages.filter(m=>m.authorId===userId||m.authorId==='local').length;
  useEffect(()=>{pinned.current=true;},[thread?.id,sent]);
  useEffect(()=>{if(pinned.current&&end.current?.getClientRects().length)end.current.scrollIntoView({block:'nearest'});},[messages.length,active&&run?.partial]);
  return h('div',{className:'bc-chat-widget'+(!discussion&&!messages.length?' bc-empty-chat':''),
    onDragOver:e=>{if(canWrite&&!busy&&e.dataTransfer.types.includes('Files'))e.preventDefault();},
    onDrop:e=>{const dropped=canWrite&&!busy?droppedFiles(e):[];if(!dropped.length)return;e.preventDefault();take(dropped);}},
    thread?h('section',{className:'bc-conversation','aria-label':discussion?'Discussion messages':'Conversation messages',onScroll:e=>{const b=e.currentTarget;pinned.current=b.scrollHeight-b.scrollTop-b.clientHeight<40;}},
      discussion&&!messages.length?h('p',{className:'bc-muted'},'Discuss this work with the people in your thread. Messages here do not start an AI run.'):null,
      messages.map(m=>h('article',{key:m.id,className:'bc-message '+m.kind},
        h('span',{className:'bc-avatar '+(m.kind==='assistant'?'bees':'')},m.kind==='assistant'?'✳':initials(peerNames.get(m.authorId)??(m.authorId===userId||m.authorId==='local'?userName:m.authorId))),h('div',null,
          h('div',{className:'bc-message-author'},m.kind==='assistant'?'Bees':peerNames.get(m.authorId)??(m.authorId===userId||m.authorId==='local'?'You':m.authorId),h('small',null,new Date(m.createdAt).toDateString()===new Date().toDateString()?new Date(m.createdAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):when(m.createdAt))),
          h('div',{className:'bc-bubble'},h(MarkdownText,{text:m.text,content:m.text})),
          m.files?.length?h('div',{className:'bc-pending-files bc-message-files'},m.files.map(fileId=>thread.artifacts?.find(a=>a.id===fileId)).filter(Boolean).map(file=>h('button',{key:file.id,type:'button',title:'Open '+file.name,onClick:()=>onOpenFile(file)},file.name))):null,unanswered.has(m.id)?h('p',{className:'bc-muted bc-unanswered'},unanswered.get(m.id)):null))),
      !discussion&&active&&run.partial?h('article',{className:'bc-message assistant'},h('span',{className:'bc-avatar bees'},'✳'),h('div',null,h('div',{className:'bc-message-author'},'Bees'),h('div',{className:'bc-bubble'},h(MarkdownText,{text:run.partial,content:run.partial})))):null,
      !discussion&&active?h('div',{className:'bc-working',role:'status'},h('span',{className:'bc-dot'}),chatting?'Bees is replying…':run.stage?`Bees is working on the ${run.stage} stage…`:'Bees is working…',h('button',{disabled:!canWrite,onClick:()=>act('stop')},'Stop')):null,
      !discussion&&run?.error?h('div',{className:'bc-notice'},run.error):null,
      !discussion&&run?.pending?h('fieldset',{disabled:!canWrite||run.pending.kind==='approval'&&!manage,className:'bc-fieldset'},h(Question,{key:run.pending.id,run,threadId:thread.id,act})):null,h('div',{ref:end})):null,
    h('form',{className:'bc-composer',onSubmit:e=>{e.preventDefault();const sent=draft;void onSend(sent,discussion,()=>{setDraft(current=>current===sent?'':current);setPending([]);},pending);}},
      h('textarea',{placeholder:viewOnly?'You can view this but not send messages. Ask the owner for edit access.':discussion?'Message the people in this thread…':active?'You can send once Bees finishes.':chatting?'Chat with Bees…':'Ask Bees to get something done…','aria-label':discussion?'Discussion message':'Message',disabled:!canWrite,value:draft,onChange:e=>setDraft(e.target.value),onPaste:e=>{const files=busy?[]:pastedFiles(e);if(files.length){e.preventDefault();take(files);}},onKeyDown:e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();e.currentTarget.form.requestSubmit();}}}),
      !discussion&&!messages.length&&!thread?.runs?.length?h('label',{className:'bc-template'},h('span',null,'Template'),h('select',{'aria-label':'Thread template',value:templateId,disabled:busy||!canWrite||!!thread&&!manage,onChange:e=>onTemplateChange(e.target.value)},
        templateId==='custom'?h('option',{value:'custom'},'Custom process'):null,
        templates.map(t=>h('option',{key:t.id,value:t.id},t.name+(t.id==='goals'?' (default)':''))))):null,
      pending.length?h('div',{className:'bc-pending-files'},pending.map(file=>h('span',{key:file.name},file.name,
        h('button',{type:'button',className:'bc-icon','aria-label':'Remove '+file.name,disabled:busy,onClick:()=>setPending(current=>current.filter(f=>f!==file))},icon('close'))))):null,
      h('div',{className:'bc-composer-footer'},h('button',{type:'button',className:'bc-icon','aria-label':thread?'Add files and folders':'Add files',disabled:!thread&&(busy||!canWrite),onClick:thread?onFiles:()=>picker.current.click()},icon('plus')),
        thread?null:h('input',{type:'file',multiple:true,hidden:true,ref:picker,onChange:e=>{const picked=[...e.target.files];e.target.value='';addPending(picked);}}),
        h('span',null,discussion?'Discussion':chatting?'Chat with AI':'Ask Bees'),h('span',{className:'bc-spacer'}),h('small',null,active?(chatting?'Bees is replying…':'Working on this machine'):chatting?'Your turn · ⌘ Enter to send':'⌘ Enter to send'),
        h('button',{className:'bc-send',type:'submit','aria-label':discussion?'Send discussion message':'Send message',disabled:busy||!canWrite||!draft.trim()||active&&!discussion},icon('send')))));
}

function WorkflowSettings({thread,onSave,agents=[],section='general',scope='thread',disabled=false,busy=false}){
  const [title,setTitle]=useState(thread.title),[instructions,setInstructions]=useState(thread.instructions??''),[memory,setMemory]=useState((thread.memory??[]).join('\n'));
  const [stages,setStages]=useState(thread.workflow??DEFAULT_WORKFLOW);
  const [scheduled,setScheduled]=useState(!!thread.schedule?.enabled),[recurrence,setRecurrence]=useState(scheduleDraft(thread.schedule));
  const update=(key,value)=>setRecurrence({...recurrence,[key]:value});
  return h('form',{className:'bc-form',onSubmit:e=>{e.preventDefault();if(disabled||busy)return;onSave(section==='general'?{title,...(scope!=='thread'?{instructions}:{})}:section==='memory'?{memory:memory.split('\n').map(s=>s.trim()).filter(Boolean)}:section==='workflow'?{workflow:stages}:{schedule:scheduled?recurrence:null});}},
    h('h3',null,({general:'General',memory:scope==='team'?'Team memory':'Thread memory',workflow:'Workflow',schedule:scope==='team'?'Team schedule':'Schedules'})[section]),
    h('fieldset',{disabled:disabled||busy,className:'bc-form bc-fieldset'},
    section==='general'?h(React.Fragment,null,
    h(Field,{label:scope==='team'?'Team name':'Thread name',value:title,required:true,pattern:'.*\\S.*',title:'Enter a name, not just spaces.',maxLength:180,onChange:e=>setTitle(e.target.value)}),
    scope!=='thread'?h('label',{className:'bc-field'},h('span',null,scope==='team'?'Instructions for every thread':'Existing thread instructions'),h('textarea',{value:instructions,rows:3,maxLength:20000,onChange:e=>setInstructions(e.target.value),placeholder:'How should Bees approach work in this team?'})):null,
    ):null,
    section==='memory'?h('label',{className:'bc-field'},h('span',null,scope==='team'?'Remember across this team · one note per line':'Remember in this thread · one note per line'),h('textarea',{value:memory,rows:3,onChange:e=>setMemory(e.target.value)})):null,
    section==='workflow'?h(React.Fragment,null,h('p',null,`${processName(stages)} · ${isChatWorkflow(stages)?'You → Chat → You ↻':stages.map(stage=>stage.name).concat('Done').join(' → ')}`),h('strong',null,'Stages'),h(WorkflowStages,{stages,agents,onChange:setStages,disabled:disabled||busy})):null,
    section==='schedule'?h(React.Fragment,null,thread.schedule?.nextAt?h('p',{className:'bc-muted'},'Next run: '+when(thread.schedule.nextAt)):null,thread.schedule?.error?h('p',{role:'status'},thread.schedule.error):null,
    h('label',{className:'bc-check'},h('input',{type:'checkbox',checked:scheduled,onChange:e=>setScheduled(e.target.checked)}),'Run on a schedule'),
    scheduled?h(React.Fragment,null,h(Field,{label:'What should Bees do each time?',value:recurrence.prompt,required:true,pattern:'.*\\S.*',title:'Say what Bees should do each time.',onChange:e=>update('prompt',e.target.value)}),h('label',{className:'bc-field'},h('span',null,'Repeats'),h('select',{value:recurrence.frequency,onChange:e=>update('frequency',e.target.value)},['daily','weekly','monthly','hourly','advanced'].map(f=>h('option',{key:f,value:f},({daily:'Daily',weekly:'Weekly',monthly:'Monthly',hourly:'Interval',advanced:'Custom cron'})[f])))),
      recurrence.frequency==='weekly'?h('label',{className:'bc-field'},h('span',null,'Day'),h('select',{value:recurrence.dayOfWeek,onChange:e=>update('dayOfWeek',Number(e.target.value))},['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d,i)=>h('option',{key:i,value:i},d)))):null,
      recurrence.frequency==='monthly'?h(Field,{label:'Day of month',type:'number',min:1,max:31,value:recurrence.dayOfMonth,onChange:e=>update('dayOfMonth',Number(e.target.value))}):null,
      recurrence.frequency==='hourly'?h(Field,{label:'Every (minutes)',type:'number',min:1,max:525600,value:recurrence.everyMinutes,onChange:e=>update('everyMinutes',Number(e.target.value))}):recurrence.frequency==='advanced'?h(Field,{label:'Five-field cron expression',value:recurrence.cronExpression,onChange:e=>update('cronExpression',e.target.value)}):h(Field,{label:'Time',type:'time',value:String(recurrence.hour??9).padStart(2,'0')+':'+String(recurrence.minute??0).padStart(2,'0'),onChange:e=>{const [hour,minute]=e.target.value.split(':').map(Number);setRecurrence({...recurrence,hour,minute});}}),
      h(Field,{label:'Timezone',list:'bc-timezones',value:recurrence.timezone,onChange:e=>update('timezone',e.target.value)}),h('datalist',{id:'bc-timezones'},(Intl.supportedValuesOf?.('timeZone')??[]).map(z=>h('option',{key:z,value:z}))),h('small',null,scope==='team'?'Each run starts a new thread in this team. It runs on the team owner’s computer while Bees is open there.':'It runs on the computer that owns this thread while Bees is open there.')):null):null,
    disabled?null:h('button',{className:'bc-primary',type:'submit'},busy?'Saving…':scope==='team'?'Save team settings':'Save thread settings')));
}

function LegacyOverrides({rows,section,perform,busy,signedIn,onSignIn}){
  const [id,setId]=useState(rows[0]?.id),[doc,setDoc]=useState(null);
  useEffect(()=>{let current=true;setDoc(null);if(id)void perform(async()=>{const value=await command('read',id);if(current)setDoc(value);});return()=>{current=false;};},[id]);
  return h('details',{className:'bc-legacy-settings'},h('summary',null,'Existing thread settings'),
    h('p',{className:'bc-muted'},'Settings saved before teams are preserved for these threads. Team instructions and memory are added to them; a saved team workflow takes priority.'),
    h('select',{'aria-label':'Existing thread settings',value:id,onChange:e=>setId(e.target.value)},rows.map(row=>h('option',{key:row.id,value:row.id},row.title))),
    doc?['addons','browser'].includes(section)?h(IntegrationSettings,{key:id+section,threadId:id,scope:'thread',canManage:!doc.frozen&&!doc.unavailable,signedIn,onSignIn,request:command,perform,page:section})
      :h(WorkflowSettings,{key:id+section,thread:doc,scope:'legacy',section,busy,disabled:doc.frozen||!!doc.unavailable,onSave:values=>perform(async()=>{setDoc(await command('configure',id,values));})}):null);
}

function OrganizationsPanel({perform,busy,icon,ctx,folders,onSaveFolder,organizationId,onChanged,onNotice}){
  const [data,setData]=useState({organizations:[],invitations:[]}),[id,setId]=useState(organizationId??''),[members,setMembers]=useState({members:[],clients:[]}),[name,setName]=useState(''),[email,setEmail]=useState('');
  const load=async()=>{const next=await command('organizations');setData(next);return next;};useEffect(()=>{void perform(async()=>{const next=await load();if(!id&&next.organizations.length===1)setId(next.organizations[0].id);});},[]);
  // heartbeats land every 5s, so re-read the clients to keep Online honest
  useEffect(()=>{let current=true;setMembers({members:[],clients:[]});const get=async()=>{const next=await command('organizationMembers',null,{organizationId:id});if(current)setMembers({...next,at:Date.now()});};if(id)void perform(get);const timer=id?setInterval(()=>void get().catch(()=>{}),15000):null;return()=>{current=false;clearInterval(timer);};},[id]);
  const organization=data.organizations.find(org=>org.id===id);
  const admin=['owner','admin'].includes(organization?.role);
  return h('section',{className:'bc-form'},h('h3',null,'Organizations'),h('p',{className:'bc-muted'},'See your colleagues and their computers. Thread invitations decide who can open each thread.'),
    data.invitations.map(i=>h('div',{key:i.id,className:'bc-person'},h('span',null,(i.invited_by_name?i.invited_by_name+' invited you to ':'You’re invited to ')+(i.organization_name??'an organization')),h('button',{disabled:busy,onClick:()=>perform(async()=>{await command('acceptOrganization',null,{invitationId:i.id});await load();setId(i.organization_id);await onChanged?.();onNotice?.(`You joined ${i.organization_name??'the organization'}.`);})},'Join'))),
    h('form',{className:'bc-actions',onSubmit:e=>{e.preventDefault();if(!busy&&name.trim())void perform(async()=>{const org=await command('createOrganization',null,{name:name.trim()});setName('');await load();setId(org.id);await onChanged?.();});}},h('input',{'aria-label':'Organization name',placeholder:'Organization name',maxLength:120,value:name,onChange:e=>setName(e.target.value)}),h('button',{type:'submit',disabled:busy||!name.trim()},'Create')),
    data.organizations.length?h('select',{'aria-label':'Organization',value:id,onChange:e=>setId(e.target.value)},h('option',{value:''},'Choose an organization'),data.organizations.map(o=>h('option',{key:o.id,value:o.id},o.name))):null,
    organization?h(OrganizationAppearance,{key:organization.id,organization,icon,busy,onSave:appearance=>perform(async()=>{await command('organizationAppearance',null,{organizationId:id,appearance});await load();await onChanged?.();return true;})}):null,
    organization?h(RootFolderSettings,{key:organization.id,ctx,folders,organization,busy,onSave:onSaveFolder}):null,
    id?members.members.map(m=>h('div',{key:m.user_id,className:'bc-person'},h('span',null,m.name??m.email),h('small',null,{owner:'Owner',admin:'Admin',member:'Member'}[m.role]??m.role),admin&&m.role!=='owner'?h('button',{disabled:busy,onClick:()=>perform(async()=>{if(!await confirmAction(`Remove ${m.name??m.email} from this organization?`,'Remove'))return;await command('removeOrganizationMember',null,{organizationId:id,userId:m.user_id});setMembers(await command('organizationMembers',null,{organizationId:id}));})},'Remove'):null)):null,
    id?members.clients.map(c=>h('small',{key:c.id},c.name+' · '+(members.at-Date.parse(c.last_seen_at)<30000?'Online':'Offline'))):null,
    id&&admin?h('form',{className:'bc-actions',onSubmit:e=>{e.preventDefault();const to=email.trim();if(!busy&&to)void perform(async()=>{await command('inviteOrganization',null,{organizationId:id,email:to});setEmail('');onNotice?.(`Invited ${to}. They can join from Organization settings in Bees.`);});}},h('input',{'aria-label':'Invite colleague by email',type:'email',required:true,placeholder:'Colleague’s email',value:email,onChange:e=>setEmail(e.target.value)}),h('button',{type:'submit',disabled:busy||!email.trim()},'Invite')):null);
}
