import { h, React, useEffect, useState, useRef, hosted, CustomAiSettings, OpenAiServersSettings, SubscriptionSettings, MarkdownText } from './runtime.js';
import { ask, confirmAction, openExternal, Button, when, droppedFiles, pastedFiles } from './common.js';
import { threadCss } from './thread-style.js';
import { THEME_PRESETS, nextThemePreset } from '../lib/themes.js';
import { AppearanceSettings, themeStyle, useAppearance } from './thread-appearance.js';
import { GLOBAL_SETTINGS, THREAD_SETTINGS, TEAM_SETTINGS, SettingsNav, ThreadDetails, SettingsPage } from './thread-panels.js';
import { ScheduleSettings } from './thread-schedule-form.js';
import { ThreadFiles } from './thread-files.js';
import { ReviewScreen } from './thread-review.js';
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
import { BeesNavigation, TeamMenu, TeamSection, TeamManagement, SettingsScopePicker, initials } from './thread-navigation.js';

async function api(input){const response=await fetch('/bees-api/threads',{...(input?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}:{}),credentials:'same-origin'}).catch(()=>{throw Object.assign(Error(offline),{status:503});});const value=await response.json().catch(()=>({error:offline}));
  // the gateway sends real 503s (at capacity, enrollment failed) with a message; show it instead of burying it under the generic offline text
  if(!response.ok)throw Object.assign(Error(typeof value.error==='string'&&value.error?value.error:response.status>=500?offline:value.error?.message??'Could not complete this request'),{status:response.status});return value;}
const offline="Bees can't be reached right now.";
const command=(action,threadId,values={})=>api({action,threadId,operationId:crypto.randomUUID(),...values});
const gearIconPaths=()=>[h('circle',{key:1,cx:12,cy:12,r:3}),h('path',{key:2,d:'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z'})];
const icon=(name,props={})=>h('svg',{width:20,height:20,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,...props},
  ...( {star:[h('path',{key:1,d:'m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z'})],edit:[h('path',{key:1,d:'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'}),h('path',{key:2,d:'m15 5 4 4'})],organization:[h('path',{key:1,d:'M4 21V5h11v16M15 11h5v10M2 21h20M8 9h3M8 13h3M8 17h3M17 15h1M17 18h1'})],team:[h('circle',{key:1,cx:9,cy:7,r:3}),h('path',{key:2,d:'M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v2'})],personal:[h('path',{key:1,d:'m3 10 9-7 9 7v11h-6v-7H9v7H3Z'})],accounts:[h('rect',{key:1,x:3,y:6,width:16,height:15,rx:3}),h('path',{key:2,d:'M7 3h12a3 3 0 0 1 3 3v11M7 18a4 4 0 0 1 8 0'}),h('circle',{key:3,cx:11,cy:12,r:2})],gear:gearIconPaths(),sun:[h('circle',{key:1,cx:12,cy:12,r:4}),h('path',{key:2,d:'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5'})],moon:[h('path',{key:1,d:'M21 13a9 9 0 0 1-10-10A9 9 0 1 0 21 13Z'})],check:[h('path',{key:1,d:'m5 12 4 4L19 6'})],hide:[h('path',{key:1,d:'m3 3 18 18M10 5l2-.2c5 0 9 7.2 9 7.2a19 19 0 0 1-3 4M6 6a22 22 0 0 0-3 6s4 7 9 7a11 11 0 0 0 5-1M10 10a3 3 0 0 0 4 4'})],process:[h('rect',{key:1,x:3,y:3,width:6,height:6,rx:1}),h('rect',{key:2,x:15,y:15,width:6,height:6,rx:1}),h('path',{key:3,d:'M9 6h6a3 3 0 0 1 3 3v6M3 18h6M6 15v6'})],schedule:[h('rect',{key:1,x:3,y:5,width:18,height:16,rx:2}),h('path',{key:2,d:'M16 3v4M8 3v4M3 11h18M8 15h3M8 18h6'})],goal:[h('circle',{key:1,cx:12,cy:12,r:9}),h('circle',{key:2,cx:12,cy:12,r:4})],plus:[h('path',{key:1,d:'M12 5v14M5 12h14'})],chat:[h('path',{key:1,d:'M21 11a8 8 0 0 1-8 8H6l-4 3 1-7A8 8 0 1 1 21 11Z'})],search:[h('circle',{key:1,cx:10,cy:10,r:6}),h('path',{key:2,d:'m15 15 5 5'})],file:[h('path',{key:1,d:'M14 2H5v20h14V7Z M14 2v6h5 M8 13h8 M8 17h6'})],send:[h('path',{key:1,d:'m3 3 18 9-18 9 4-9Z M7 12h14'})],share:[h('path',{key:1,d:'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M16 4a4 4 0 0 1 0 8 M20 15v6 M17 18h6'}),h('circle',{key:2,cx:8.5,cy:7,r:4})],settings:gearIconPaths(),transfer:[h('path',{key:1,d:'M4 7h15l-4-4 M20 17H5l4 4 M19 7l-4 4 M5 17l4-4'})],more:[h('circle',{key:1,cx:5,cy:12,r:1}),h('circle',{key:2,cx:12,cy:12,r:1}),h('circle',{key:3,cx:19,cy:12,r:1})],close:[h('path',{key:1,d:'m6 6 12 12 M18 6 6 18'})]}[name]??[]));
function Field({label,...props}){return h('label',{className:'bc-field'},h('span',null,label),h('input',props));}
// the dialog unmounts while open, so focus would drop to the page top
function Dialog({title,onClose,children,wide=false}){const ref=useRef();useEffect(()=>{const opener=document.activeElement;ref.current.showModal();return()=>opener?.focus?.();},[]);return h('dialog',{ref,className:'bc-dialog'+(wide?' bc-dialog-wide':''),onCancel:onClose},h('header',null,h('h2',null,title),h('button',{className:'bc-icon',onClick:onClose,'aria-label':'Close'},icon('close'))),children);}
function Question({run,threadId,act}){const [answers,setAnswers]=useState({});const [picked,setPicked]=useState({});const p=run.pending;if(!p)return null;return h('section',{className:'bc-question'},h('strong',null,p.kind==='approval'?'Your approval is needed':'Bees has a question'),p.text?h('p',{className:'bc-preserve'},p.text):null,(p.questions??[]).map(q=>h('div',{key:q.id,className:'bc-field'},h('span',null,q.question),q.detail?h('small',null,q.detail):null,q.options?.length?h('div',{className:'bc-actions'},q.options.map(o=>h('button',{type:'button',key:o.label,className:(q.multiSelect?picked[q.id]?.includes(o.label):answers[q.id]===o.label)?'bc-primary':undefined,'aria-pressed':q.multiSelect?!!picked[q.id]?.includes(o.label):undefined,onClick:()=>q.multiSelect?setPicked({...picked,[q.id]:picked[q.id]?.includes(o.label)?picked[q.id].filter(l=>l!==o.label):[...picked[q.id]??[],o.label]}):setAnswers({...answers,[q.id]:o.label})},o.label))):null,h('input',{'aria-label':q.question,value:answers[q.id]??'',placeholder:q.options?.length?'Or type your own answer':undefined,onChange:e=>setAnswers({...answers,[q.id]:e.target.value})}))),p.kind==='approval'?h('div',{className:'bc-actions'},h('button',{className:'bc-primary',onClick:()=>act('answer',{questionId:p.id,approved:true})},'Approve'),h('button',{className:'danger',onClick:()=>act('answer',{questionId:p.id,approved:false})},'Reject')):h('button',{className:'bc-primary',disabled:(p.questions??[]).some(q=>!(answers[q.id]??'').trim()&&!picked[q.id]?.length),onClick:()=>act('answer',{questionId:p.id,answers:(p.questions??[]).map(q=>{const v=(answers[q.id]??'').trim(),s=picked[q.id]??[];return q.options?.some(o=>o.label===v)?{id:q.id,selected:[...new Set([...s,v])]}:{id:q.id,selected:s,...v?{custom:v}:{}};})})},'Send answer'));}
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
  ):h('p',{className:'bc-muted'},'On the web, Bees replies with Bees Credits. Connecting your own AI is only available in the desktop app.'));
}

export function ThreadApp({ctx,preferences,modelSettings,brandMark}) {
  const [data,setData]=useState(null), [selected,setSelected]=useState(null), [thread,setThread]=useState(null);
  const [query,setQuery]=useState(''), [navigation,setNavigation]=useState(null), [suggestion,setSuggestion]=useState(null);
  const [layoutToolbar,setLayoutToolbar]=useState(null);
  const [renamingTitle,setRenamingTitle]=useState(false), [titleDraft,setTitleDraft]=useState('');
  const [organizationId,setOrganizationId]=useState(undefined);
  const [settingsAccountId,setSettingsAccountId]=useState(undefined),[settingsOrganizationId,setSettingsOrganizationId]=useState(undefined),[settingsTeamId,setSettingsTeamId]=useState(null),[settingsData,setSettingsData]=useState(null),[settingsTeam,setSettingsTeam]=useState(null);
  const settingsEpoch=useRef(0);
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
  const currentTeamId=teams.find(t=>t.id===teamId)?.id??visibleTeams.find(t=>t.id===data?.defaultTeamId)?.id??visibleTeams[0]?.id;
  const configuring=dialog==='settings'||dialog==='team';
  const configAccountId=settingsAccountId===undefined?(data?.accounts?.find(account=>account.active)?.id??null):settingsAccountId;
  const configOrganizationId=settingsOrganizationId===undefined?selectedOrganizationId:settingsOrganizationId;
  const configTeamRows=settingsData?.teams??[];
  const configTeams=[...configTeamRows,...(settingsData?.directory?.threads??[]).filter(row=>row.kind==='team'&&!configTeamRows.some(team=>team.id===row.id)).map(row=>({id:row.id,organizationId:row.organization_id,title:'Shared team'}))];
  const settingsTeams=configTeams.filter(row=>configOrganizationId?row.organizationId===configOrganizationId:!row.organizationId||!settingsData?.organizations.some(org=>org.id===row.organizationId));
  const configTeamId=settingsTeams.find(row=>row.id===settingsTeamId)?.id??settingsTeams.find(row=>row.id===currentTeamId)?.id??settingsTeams[0]?.id;
  const settingsCommand=(action,id,values={})=>command(action,id,{...values,settingsAccountId:configAccountId});
  const settingsTeamRef=useRef(configTeamId);settingsTeamRef.current=configTeamId;
  const teamRef=useRef(currentTeamId);teamRef.current=currentTeamId;
  const theme=THEME_PRESETS.find(t=>t.id===preference.themePreset)??THEME_PRESETS.find(t=>t.id==='corporate');
  const refresh=async()=>{const epoch=profileEpoch.current;const next=await api();if(epoch===profileEpoch.current)setData(next);return next;};
  const read=async id=>{const epoch=profileEpoch.current;const value=await command('read',id);if(epoch===profileEpoch.current&&selectedRef.current===id)setThread(value);return value;};
  const readTeam=async id=>{const epoch=profileEpoch.current;const value=await command('read',id);if(epoch===profileEpoch.current&&teamRef.current===id)setTeam(value);return value;};
  const perform=async fn=>{setBusy(true);setError('');setNotice('');try{return await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const act=(action,values={})=>perform(async()=>{const id=selected;const result=await command(action,id,values);await refresh();if(id)await read(id);return result;});
  const saveTitle=()=>{const trimmed=titleDraft.trim();setRenamingTitle(false);if(trimmed&&trimmed!==thread?.title)void act('configure',{title:trimmed});};
  const select=(id,keepDialog=false)=>{if(id!==selected){setThread(null);setError(e=>e===offline?e:'');}setRenamingTitle(false);const row=data?.threads.find(t=>t.id===id)??data?.directory?.threads.find(t=>t.id===id);const parent=row?.teamId??row?.team_id;if(parent&&allTeams.some(t=>t.id===parent))setTeamId(parent);selectedRef.current=id;setSelected(id);setComposing(false);setNewTemplate('goals');setSuggestion(null);setNavigation({id:'conversation'});if(!keepDialog)setDialog(null);setInviteLink('');setNotice('');};
  const navigate=next=>{setNavigation({id:next});setDialog(null);};
  const closeDialog=()=>{const returnTo=loginReturn.current;loginReturn.current=null;setDialog(returnTo?'team':null);setError('');setNotice('');};
  const openSettings=section=>{setThreadSection(section);setInviteLink('');setNotice('');navigate('settings');};
  const openTeamSettings=(section='general',id=currentTeamId)=>{setSettingsAccountId(data?.accounts?.find(account=>account.active)?.id??null);setSettingsOrganizationId(selectedOrganizationId);setSettingsTeamId(id);const mapped=section==='workflow'?'processes':section==='invitations'?'members':section;setTeamSection(mapped);setInviteLink('');setNotice('');setDialog('team');};
  const openGlobal=section=>{if(section==='organizations'&&!configAccountId&&data?.accounts?.length)selectSettingsAccount(data.accounts[0].id);setSettingsSection(section);setDialog('settings');setNotice('');};
  const openAccount=()=>{setDialog('account');setNotice('');};
  useEffect(()=>{
    const previousTitle=document.title;document.title='Bees Client';
    const style=document.createElement('style');style.textContent=threadCss;document.head.append(style);
    const dismissMenus=event=>{for(const menu of document.querySelectorAll('.bc-thread-menu[open]'))if(!menu.contains(event.target))menu.open=false;};
    document.addEventListener('pointerdown',dismissMenus,true);
    // Keep menus near the bottom of the sidebar in view.
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
  useEffect(()=>{if(typeof document==='undefined')return;const root=document.documentElement,styles=themeStyle(theme);for(const [prop,val] of Object.entries(styles))root.style.setProperty(prop,val);root.style.colorScheme=theme.dark?'dark':'light';root.setAttribute('data-bees-theme',theme.id);},[theme.id]);
  const refreshSettings=async()=>{const epoch=settingsEpoch.current;const next=await settingsCommand('settingsSnapshot');if(epoch===settingsEpoch.current)setSettingsData(next);return next;};
  useEffect(()=>{settingsEpoch.current++;setSettingsData(null);setSettingsTeam(null);if(!configuring)return;let alive=true;const load=()=>refreshSettings().catch(e=>{if(alive)setError(e.message);});void load();const timer=setInterval(load,5000);return()=>{alive=false;settingsEpoch.current++;clearInterval(timer);};},[configuring,configAccountId]);
  const readSettingsTeam=async id=>{const epoch=settingsEpoch.current;const value=await settingsCommand('read',id);if(epoch===settingsEpoch.current&&settingsTeamRef.current===id)setSettingsTeam(value);return value;};
  useEffect(()=>{setSettingsTeam(null);setPreview(null);if(configuring&&configTeamId)void readSettingsTeam(configTeamId).catch(e=>setError(e.message));},[configuring,configAccountId,configTeamId]);
  useEffect(()=>{if(configuring&&configTeamId)void readSettingsTeam(configTeamId).catch(()=>{});},[settingsData]);
  const selectSettingsAccount=id=>{settingsEpoch.current++;setSettingsAccountId(id);setSettingsData(null);setSettingsOrganizationId(null);setSettingsTeamId(null);setSettingsTeam(null);};
  const selectSettingsOrganization=(id,accountId=configAccountId)=>{if(accountId!==configAccountId)selectSettingsAccount(accountId);setSettingsOrganizationId(id);setSettingsTeamId(null);setSettingsSection('organizations');setDialog('settings');};
  const chooseOrganization=(id,accountId)=>perform(async()=>{
    profileEpoch.current++;await command('selectOrganization',null,{accountId,organizationId:id});clearAccount();setOrganizationId(id);await refresh();
  });
  const saveAppearance=values=>perform(async()=>{
    if(preferences){if(preferences.getSnapshot().status!=='ready')throw Error('Settings are still loading');for(const [key,value] of Object.entries(values))await preferences.set(key,value);}
    else {await command('preferences',null,{values});await refresh();}
  });
  const clearAccount=()=>{profileEpoch.current++;settingsEpoch.current++;setSettingsAccountId(undefined);setSettingsOrganizationId(undefined);setSettingsTeamId(null);setSettingsTeam(null);setSettingsData(null);select(null);setOrganizationId(undefined);setTeamId(null);setTeam(null);setCollapsed({});setThread(null);setPreview(null);setSuggestion(null);setData(null);};
  // the thread is saved on its first message, so an unused New Goal or New Chat leaves nothing behind
  // composing keeps the empty thread on screen on a phone, where the list and the thread take turns
  const create=(templateId='goals',id=currentTeamId)=>{select(null);setComposing(true);setTeamId(id);setNewTemplate(templateId);setCollapsed(values=>({...values,[id]:false}));requestAnimationFrame(()=>document.querySelector('.bc-composer textarea')?.focus());};
  const deleteThread=t=>perform(async()=>{if(!await confirmAction(`Delete “${t.title}”? Its messages, runs and files are removed for everyone in it. This can’t be undone.`,'Delete'))return;await command('delete',t.id);if(selectedRef.current===t.id)select(null);await refresh();});
  const showTeam=id=>perform(async()=>{setCollapsed(values=>({...values,[id]:false}));await command('preferences',null,{values:{hiddenTeamIds:hiddenTeamIds.filter(hidden=>hidden!==id)}});await refresh();});
  const hideTeam=id=>perform(async()=>{await command('preferences',null,{values:{hiddenTeamIds:[...new Set([...hiddenTeamIds,id])]}});await refresh();});
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
  const teamParticipants=roster.participants.filter(p=>p.thread_id===currentTeamId);
  const teamRole=teamParticipants.find(p=>p.user_id===data?.user?.id)?.role;
  const canCreateInTeam=!!team&&(!team.shared||['owner','editor'].includes(teamRole))&&!team.frozen&&!team.unavailable;
  const settingsParticipants=(settingsData?.directory?.participants??[]).filter(p=>p.thread_id===configTeamId),teamOwn=!!settingsTeam&&settingsTeam.ownerClientId===settingsData?.clientId;
  const settingsRole=settingsParticipants.find(p=>p.user_id===settingsData?.user?.id)?.role;
  const canConfigureTeam=!!settingsTeam&&(teamOwn||settingsTeam.ownerUserId===settingsData?.user?.id)&&!settingsTeam.frozen&&!settingsTeam.unavailable;
  const viewOnly=selected?!!thread&&!canEdit&&!thread.unavailable:teamRole==='viewer';
  const peerNames=new Map(roster.participants.map(p=>[p.user_id,p.name??p.email]));
  const transferClients=roster.clients.filter(c=>c.id!==data?.clientId&&(c.user_id===data?.user?.id||participants.some(p=>p.user_id===c.user_id&&p.role!=='viewer')));
  const previewFile=file=>setPreview({...file,url:`/bees-api/thread-file?thread=${selected}&artifact=${file.id}`});
  const saveThread=values=>perform(async()=>{await command('configure',selected,values);await refresh();await read(selected);setNotice('Thread settings saved.');});
  const saveFolder=values=>perform(async()=>{await command('setRootFolder',null,values);await refresh();setNotice('Folder settings saved.');return true;});
  const saveTeam=values=>perform(async()=>{await settingsCommand('configure',configTeamId,values);await refreshSettings();await refresh();await readSettingsTeam(configTeamId);setNotice(values.processes!==undefined?'Processes saved. Start a new thread to use them.':values.workflow!==undefined?'Default process saved. New threads in this team will use these stages.':'Team settings saved. Changes apply to new runs in every thread.');return true;});
  const leaveTeam=()=>perform(async()=>{if(!await confirmAction(`Leave ${settingsTeam.title}? You lose access to its threads. Threads you started on this computer stay with you.`,'Leave'))return;await settingsCommand('leave',configTeamId);setSettingsTeamId(null);setSettingsTeam(null);await refreshSettings();await refresh();});
  const teamAction=(action,values)=>perform(async()=>{await settingsCommand(action,configTeamId,values);await refreshSettings();await refresh();await readSettingsTeam(configTeamId);});
  const files=thread?h(ThreadFiles,{key:selected,thread,canWrite,busy,onAttach:attach,onPreview:previewFile,preview,onClosePreview:()=>setPreview(null)}):null;
  const signInForApps=()=>{loginReturn.current=configTeamId;setError('');setDialog('login');};
  const integrations=section=>settingsTeam?h(IntegrationSettings,{key:configAccountId+configTeamId+section,threadId:configTeamId,canManage:(teamOwn||['owner','editor'].includes(settingsRole))&&!settingsTeam.unavailable&&!settingsTeam.frozen,signedIn:settingsData?.signedIn??!!settingsData?.user,onSignIn:signInForApps,request:settingsCommand,perform,page:section}):null;
  const configuration=(section,note)=>settingsTeam?h(React.Fragment,null,canConfigureTeam||!note?null:h('p',{className:'bc-muted'},'Only the team owner can change shared settings.'),h(WorkflowSettings,{key:configAccountId+configTeamId+section+(canConfigureTeam?'':settingsTeam.revision),thread:settingsTeam,agents:settingsTeam.agents??[],scope:'team',section,disabled:!canConfigureTeam,busy,onSave:saveTeam})):h('p',{role:'status'},'Loading team settings…');
  const invitations=h('form',{className:'bc-form',onSubmit:event=>{event.preventDefault();void perform(async()=>{
    if(!settingsData?.user){setDialog('login');return;}const invite=await settingsCommand('share',configTeamId,{email,role});setInviteLink(invite.url);setNotice(`Invited ${email}. It shows in their Bees sidebar, or you can send them the link below.`);setEmail('');setRole('viewer');await refresh();await readSettingsTeam(configTeamId);
  });}},h('h3',null,'Invite to team'),h('p',{className:'bc-muted'},'Invite someone to this team and all its threads, including people outside your organization.'),
    h(Field,{label:'Email',type:'email',required:true,disabled:!canConfigureTeam,value:email,autoComplete:'email',autoCorrect:'off',autoCapitalize:'off',spellCheck:false,onChange:e=>{setEmail(e.target.value);e.target.setCustomValidity(e.target.value.trim().toLowerCase()===settingsData?.user?.email?.toLowerCase()?'This is your own email.':'');}}),
    h('label',{className:'bc-field'},h('span',null,'Access'),h('select',{value:role,disabled:!canConfigureTeam,onChange:e=>setRole(e.target.value)},
      h('option',{value:'viewer'},'Can view'),h('option',{value:'editor'},'Can contribute and run work'))),
    h('button',{type:'submit',className:'bc-primary',disabled:busy||!canConfigureTeam},settingsData?.user?'Create invitation':'Sign in to invite'),
    inviteLink?h('label',{className:'bc-field'},h('span',null,'Invitation link'),h('input',{readOnly:true,value:inviteLink,onFocus:e=>e.target.select()})):null);
  const members=h('section',{className:'bc-form'},h('h3',null,'Members'),
    !settingsParticipants.length?h('p',null,'Only you have access to this private team.'):null,
    settingsParticipants.map(p=>h('div',{key:p.user_id,className:'bc-person'},h('span',null,p.name??p.email),h('small',null,{owner:'Owner',editor:'Can contribute and run work',viewer:'Can view'}[p.role]??p.role),
      canConfigureTeam&&p.role!=='owner'?h('button',{className:'danger',disabled:busy,onClick:async()=>{if(await confirmAction(`Remove ${p.name??p.email} from this team? They lose access to all of its threads.`,'Remove'))void teamAction('remove',{userId:p.user_id});}},'Remove'):null)),
    settingsTeam?.shared&&!teamOwn&&settingsRole&&settingsRole!=='owner'?h('button',{className:'danger',disabled:busy,onClick:leaveTeam},'Leave team'):null,
    canConfigureTeam?h('div',{className:'bc-form-section'},invitations):null);
  const transfer=h('form',{className:'bc-form',onSubmit:e=>{e.preventDefault();void act('transfer',{targetClientId:target});}},
    h('h3',null,'Transfer thread'),h('p',{className:'bc-muted'},own?'Move the thread, its files and its runs to another computer in this thread. Sign in to its add-ons again there and choose browser access.':`Only ${owner?.name??'the computer running this thread'} can transfer it.`),
    own?h('select',{'aria-label':'Move to',value:target,required:true,onChange:e=>setTarget(e.target.value)},h('option',{value:''},transferClients.length?'Choose a computer':'No other computer has joined this thread yet'),transferClients.map(c=>h('option',{key:c.id,value:c.id},c.name))):null,
    own?h('button',{className:'bc-primary',type:'submit',disabled:busy||active||!data?.user||!transferClients.length},active?'Wait for the run to finish':thread?.frozen?'Resend offer':'Offer transfer'):null,
    own&&authority?.transfer_client_id?h('button',{type:'button',onClick:()=>act('cancelTransfer')},'Cancel pending transfer'):null);
  const verifyEmail=()=>perform(async()=>{await command('verifyEmail');setNotice('Check your email to verify your account.');});
  const account=h('section',{className:'bc-form'},h('h3',null,'Accounts'),
    (data?.accounts??[]).map(account=>h('div',{key:account.id,className:'bc-person'},h('div',null,h('strong',null,account.user.email),h('small',{className:'bc-account-server'},account.url)))),
    data?.user&&!data.user.emailVerified?h(React.Fragment,null,h('p',{className:'bc-muted'},'Your email isn’t verified yet. You need that to accept invitations or invite people to an organization.'),h('button',{disabled:busy,onClick:verifyEmail},'Send verification email')):null,
    h('button',{disabled:busy,onClick:()=>setDialog('login')},data?.user?'Add account':'Sign in'),
    data?.user?h('button',{disabled:busy,onClick:()=>perform(async()=>{await command('logout');clearAccount();const next=await refresh().catch(error=>{if(!hosted||error.status!==401)throw error;});setDialog(hosted&&!next?.user?'login':'account');})},'Sign out of this account'):null);
  const threadContent=!thread?h('p',{role:'status'},'Loading thread settings…')
    :threadSection==='transfer'?transfer:h(React.Fragment,null,manage?null:h('p',{className:'bc-muted'},'Only the person who started this thread can rename it.'),h(WorkflowSettings,{key:selected,thread,scope:'thread',section:'general',disabled:!canConfigure,busy,onSave:saveThread,onDelete:()=>deleteThread(thread),canDelete:thread.ownerClientId===data?.clientId&&!thread.runs?.some(r=>r.status==='running')}));
  const teamFiles=settingsTeam?h(ThreadFiles,{key:configAccountId+configTeamId,thread:settingsTeam,canWrite:canConfigureTeam,busy,onAttach:(files,prefix='')=>perform(async()=>{checkSize(files);for(const file of files)await settingsCommand('attach',configTeamId,{name:file.name,path:prefix+(file.webkitRelativePath||file.name),content:await encode(file)});await readSettingsTeam(configTeamId);}),onPreview:file=>setPreview({...file,url:`/bees-api/thread-file?thread=${configTeamId}&artifact=${file.id}&settingsAccountId=${encodeURIComponent(configAccountId??'')}`}),preview,onClosePreview:()=>setPreview(null)}):null;
  const legacyRows=(settingsData?.threads??[]).filter(t=>t.teamId===configTeamId&&t.legacySettings&&t.ownerClientId===settingsData?.clientId);
  const teamContent=!settingsTeam?h('p',{role:'status'},'Loading team settings…')
    :['processes','workflow'].includes(teamSection)?h(TeamProcesses,{key:configAccountId+configTeamId,team:settingsTeam,canManage:canConfigureTeam,canCreate:!!settingsTeam&&(!settingsTeam.shared||['owner','editor'].includes(settingsRole))&&!settingsTeam.frozen&&!settingsTeam.unavailable,busy,onSave:processes=>saveTeam({processes}),onSaveDefault:workflow=>saveTeam({workflow}),onStart:templateId=>perform(async()=>{await command('selectOrganization',null,{accountId:configAccountId,organizationId:configOrganizationId});clearAccount();setOrganizationId(configOrganizationId);await refresh();create(templateId,configTeamId);})})
    :teamSection==='agents'?h(TeamAgents,{key:configAccountId+configTeamId,team:settingsTeam,models:settingsData?.models, presets:settingsData?.agentPresets,canManage:canConfigureTeam,busy,onSave:agents=>saveTeam({agents})})
    :teamSection==='memory'?h(React.Fragment,null,h(TeamMemory,{key:configAccountId+configTeamId,teamId:configTeamId,canManage:canConfigureTeam,request:settingsCommand}),configuration('memory'))
    :teamSection==='schedule'?h(ScheduleSettings,{key:configAccountId+configTeamId,thread:settingsTeam,scope:'team',disabled:!canConfigureTeam,busy,onSave:saveTeam})
    :teamSection==='general'?configuration(teamSection)
    :['members','invitations'].includes(teamSection)?members
    :teamSection==='folders'?teamFiles:integrations(teamSection);
  const globalContent=settingsSection==='ai'?h(AiConnections,{ctx,preferences,modelSettings,models:data?.models??[],current:data?.defaultModel,credits:data?.credits,onModel:model=>act('model',{model})})
    :settingsSection==='credits'?h(CreditSettings,{key:data?.user?.id??'local',connection:data?.credits,user:data?.user,request:(action,values)=>command(action,null,values),onRefresh:refresh,onSignIn:()=>setDialog('login')})
    :settingsSection==='appearance'?h(AppearanceSettings,{preference,onSave:saveAppearance,disabled:busy||!!preferences&&preferences.getSnapshot().status!=='ready'})
    :settingsSection==='organizations'?(settingsData?.user?h(OrganizationsPanel,{key:configAccountId,perform,busy,icon,ctx,folders:settingsData?.folders,request:settingsCommand,onSaveFolder:values=>perform(async()=>{await settingsCommand('setRootFolder',null,values);await refreshSettings();await refresh();return true;}),organizationId:configOrganizationId,onSelectOrganization:selectSettingsOrganization,onChanged:async()=>{await refreshSettings();await refresh();},onNotice:setNotice}):h('button',{onClick:()=>setDialog('login')},'Sign in to manage organizations'))
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
    :page==='settings'?h('section',{className:'bc-conversation','aria-label':'Thread settings'},
      h('div',{className:'bc-settings-layout'},h(SettingsNav,{items:THREAD_SETTINGS,selected:threadSection,onSelect:section=>{setThreadSection(section);setNotice('');},label:'Thread settings sections'}),h('div',{className:'bc-settings-content'},threadContent)))
    :h('section',{className:'bc-conversation'+(page==='files'?' bc-files-tab':'')},
      page==='kanban'?h(ThreadKanban,{key:selected,thread:effectiveThread,onConversation:()=>navigate('conversation'),onWorkflow:()=>openTeamSettings('processes'),icon})
      :page==='files'?files:page==='addons'?integrations('addons'):page==='schedule'?h(ScheduleSettings,{key:selected,thread,disabled:!canConfigure,busy,onSave:saveThread}):page==='memory'?configuration(page,true)
      :h(ThreadDetails,{thread:effectiveThread,page,peerNames,userId:data?.user?.id,onSettings:openSettings,onFiles:()=>navigate('files')}));
  const renderThread=t=>h('div',{key:t.id,className:'bc-thread-row '+(selected===t.id?'active':'')},
    h('button',{className:'bc-thread',title:t.title,'aria-current':selected===t.id?'page':undefined,onClick:()=>select(t.id)},
      h('span',{className:'bc-thread-copy'},h('strong',null,t.title),h('small',null,t.preview?.replace(/^\s*(?:#+|>|[-*+])\s|\*\*?|`/gm,'')??'Open shared work')),t.runs?.some(r=>r.status==='running')?h('span',{className:'bc-dot',title:'Running'}):null));
  const acceptInvitation=invitation=>perform(async()=>{
    await command('acceptInvitation',null,{invitationId:invitation.id});
    const next=await refresh(),joined=next.directory.threads.find(t=>t.id===invitation.thread_id);
    const parent=joined?.kind==='team'?joined:next.directory.threads.find(t=>t.id===joined?.team_id);
    const scope=organizations.some(o=>o.id===parent?.organization_id)?parent.organization_id:null;
    setOrganizationId(scope);await command('preferences',null,{values:{selectedOrganizationId:scope}});
    if(joined?.kind==='team'){select(null);setTeamId(joined.id);setCollapsed(values=>({...values,[joined.id]:false}));}else select(invitation.thread_id);
  });
  const teamThreads=id=>threads.filter(t=>threadTeamId(t)===id);
  const settingsOpen=dialog==='settings'||dialog==='team'||dialog==='account', modalOpen=dialog==='login';
  const currentTeam=teams.find(t=>t.id===currentTeamId);
  const settingsAccounts=data?.accounts??[];
  const settingsOrganizations=settingsAccounts.length?settingsAccounts.flatMap(account=>(account.organizations??[]).map(org=>({id:account.id+':'+org.id,title:`${org.name} (${account.user.email})`,organization:org,accountId:account.id}))):(settingsData?.organizations??organizations).map(org=>({id:':'+org.id,title:org.name,organization:org,accountId:null}));
  const canCreateIn=team=>!team.frozen&&!team.unavailable&&(!team.shared||roster.participants.some(p=>p.thread_id===team.id&&p.user_id===data?.user?.id&&['owner','editor'].includes(p.role)));
  const settingsGroups=[
    {title:'Global',scope:'global',items:GLOBAL_SETTINGS},
    {title:'Organization',scope:'global',selector:h(SettingsScopePicker,{label:'Organizations to configure',icon,busy,rows:[...!hosted?[{id:'local',title:'Local Org'}]:[],...settingsOrganizations],selected:configOrganizationId?(configAccountId??'')+':'+configOrganizationId:'local',onSelect:key=>{if(key==='local'){selectSettingsOrganization(null,null);return;}const row=settingsOrganizations.find(row=>row.id===key);selectSettingsOrganization(row.organization.id,row.accountId);}}),items:[['organizations','General & members']]},
    {title:'Team',scope:'team',selector:h('div',null,
      h(TeamManagement,{icon,busy:busy||!data,onCreateTeam:createTeam,hiddenTeams:teams.filter(team=>hiddenTeamIds.includes(team.id)),onSelectTeam:showTeam}),
      h(SettingsScopePicker,{label:'Teams to configure',icon,busy,rows:settingsTeams.map(row=>({id:row.id,title:row.title})),selected:configTeamId,onSelect:id=>{setSettingsTeamId(id);setDialog('team');}})),items:settingsTeams.length?TEAM_SETTINGS:[]}
  ];
  if(data?.onboarding===null)return h('div',{className:'bc-app bc-onboarding-app','data-bees-theme':theme.id,style:themeStyle(theme)},
    h(FirstStart,{user:data.user,organizations,busy,error,onSignIn:()=>setDialog('login'),
      onVerify:verifyEmail,
      onCloud:values=>void perform(async()=>{await command('completeOnboarding',null,{mode:'cloud',...values});clearAccount();await refresh();}),
      onLocal:()=>void perform(async()=>{await command('completeOnboarding',null,{mode:'local'});clearAccount();await refresh();openGlobal('ai');})}),
    notice?h('p',{role:'status'},notice):null,
    dialog==='login'?h(Dialog,{title:'Sign in',onClose:closeDialog},h(Login,{server:data.serverUrl,request:(action,values)=>command(action,null,values),onComplete:async()=>{await refresh();closeDialog();}})):null);
  return h('div',{className:'bc-app '+(selected||composing||settingsOpen?'has-thread':''),'data-bees-theme':theme.id,style:themeStyle(theme)},
    h(BeesNavigation,{brandMark,icon,organizations,accounts:data?.accounts??[],user:data?.user,localActive:data?.localActive,organizationId:selectedOrganizationId,theme,busy:busy||!data,
      onOrganization:chooseOrganization,onGlobal:openGlobal,
      onTheme:()=>{const next=nextThemePreset(preference);void saveAppearance({themePreset:next.id,colorMode:next.dark?'dark':'light'});},onAccount:openAccount}),
    h('aside',{className:'bc-sidebar','aria-label':'Threads'},
      h('div',{className:'bc-sidebar-tools'},
      h('div',{className:'bc-search'},icon('search'),h('input',{'aria-label':'Search threads',placeholder:'Find a thread…',value:query,autoCorrect:'off',autoCapitalize:'off',spellCheck:false,onChange:e=>setQuery(e.target.value),onKeyDown:e=>{if(e.key==='Escape'){setQuery('');e.currentTarget.blur();}}}),query?h('button',{type:'button',className:'bc-search-clear','aria-label':'Clear search',title:'Clear search',onClick:()=>setQuery('')},icon('close')):null)),
      h('div',{className:'bc-thread-list'},visibleTeams.map(row=>h(TeamSection,{key:row.id,team:row,expanded:!!query||!collapsed[row.id],
        onToggle:()=>setCollapsed(values=>({...values,[row.id]:!values[row.id]})),onOpen:()=>create('goals',row.id),
        menu:h(TeamMenu,{team:row,icon,busy,canCreate:canCreateIn(row),onCreate:create,onSettings:openTeamSettings,onHide:hideTeam})},
        teamThreads(row.id).map(renderThread),!teamThreads(row.id).length?h('p',{className:'bc-muted bc-empty-list'},query?'No matching threads.':'No threads yet.'):null)),
        !visibleTeams.length?h('p',{className:'bc-muted bc-empty-list'},teams.length?'Show a hidden team in Settings → Team → Manage teams.':'Create a team in Settings → Team → Manage teams.'):null),
      roster.invitations?.length?h('section',{className:'bc-invitations'},h('strong',null,'Invitations'),
        roster.invitations.map(i=>h('div',{key:i.id,className:'bc-person'},h('span',null,`${i.invited_by_name??'Someone'} invited you`,h('small',null,i.role==='viewer'?'Can view':'Can contribute and run work')),
          data.user?.emailVerified?h('button',{disabled:busy,onClick:()=>acceptInvitation(i)},'Accept'):null)),
        data.user?.emailVerified?null:h(React.Fragment,null,h('p',{className:'bc-muted'},'Verify your email to accept.'),h('button',{disabled:busy,onClick:verifyEmail},'Send verification email'))):null,
      h('footer',null,h('span',{className:'bc-dot '+(data?.connectionError?'offline':'')}),h('span',null,data?.connectionError?"Can't reach Bees right now":data?.user?'Connected to Bees':'Private on this machine',(data?.connectionError||data?.user)&&data?.serverUrl?h('small',{className:'bc-server-url'},data.serverUrl):null))),
    h('main',{className:'bc-main'},h(UpdateBar),settingsOpen?h(React.Fragment,null,
      error?h('p',{className:'bc-error',role:'alert'},error):null,notice?h('p',{className:'bc-notice',role:'status'},notice):null,
      h(SettingsPage,{
        title:dialog==='account'?'Accounts':'Settings',
        groups:dialog==='account'?null:settingsGroups,
        selected:dialog==='account'?'account':dialog==='team'?teamSection:settingsSection,
        onSelect:(section,scope)=>{
          setNotice('');
          if(scope==='team'){
            setDialog('team');
            setTeamSection(section);
          }else{
            setDialog('settings');
            setSettingsSection(section);
          }
        },
        onClose:closeDialog
      },
        dialog==='account'?account:dialog==='team'?h(React.Fragment,null,settingsTeam&&!canConfigureTeam&&!['addons','browser','schedule'].includes(teamSection)?h('p',{className:'bc-muted'},'Only the team owner can change shared settings.'):null,teamContent,
          settingsTeam&&legacyRows.length&&['general','memory','schedule','addons','browser'].includes(teamSection)?h(LegacyOverrides,{key:configAccountId+configTeamId+teamSection,rows:legacyRows,section:teamSection,request:settingsCommand,perform,busy,signedIn:settingsData?.signedIn??!!settingsData?.user,onSignIn:signInForApps}):null):globalContent))
      :null,h('section',{className:'bc-thread-surface',hidden:settingsOpen},
      h('header',{className:'bc-thread-header'},
        h('button',{className:'bc-icon bc-back-to-threads','aria-label':'Show threads',onClick:()=>select(null)},'‹'),
        h('div',null,
          renamingTitle?h('form',{className:'bc-thread-title-form',onSubmit:e=>{e.preventDefault();saveTitle();}},
            h('input',{className:'bc-thread-title-input',value:titleDraft,autoFocus:true,'aria-label':'Thread title',maxLength:180,onChange:e=>setTitleDraft(e.target.value),onKeyDown:e=>{if(e.key==='Escape'){e.stopPropagation();setRenamingTitle(false);}},onBlur:saveTitle}))
          :h('div',{className:'bc-thread-title-row'},
            h('h2',{onDoubleClick:canWrite&&selected&&thread?()=>{setTitleDraft(thread?.title||'');setRenamingTitle(true);}:undefined,title:canWrite&&selected&&thread?'Double-click to rename':undefined},thread?.title??(selected?'Loading thread…':'A little help. A lot done.')),
            canWrite&&selected&&thread?h('button',{type:'button',className:'bc-icon bc-rename-button','aria-label':'Rename thread',title:'Rename thread',onClick:()=>{setTitleDraft(thread?.title||'');setRenamingTitle(true);}},icon('edit')):null),
          h('p',null,selected?(owner?.name??(own?'This machine':'Shared work')):'Your people, AI, and work in one conversation.')),
        selected?h('div',{className:'bc-actions'},
          h('button',{title:'Invite to team',onClick:()=>openTeamSettings('members')},icon('share'),'Invite'),
          h('span',{className:'bc-layout-toolbar',ref:setLayoutToolbar})):null),
      error&&!modalOpen?h('div',{className:'bc-error',role:'alert'},error,h('button',{className:'bc-icon','aria-label':'Dismiss error',onClick:()=>setError('')},icon('close'))):null,
      notice&&!modalOpen?h('div',{className:'bc-notice',role:'status'},notice):null,
      data&&!data.models?.length&&!data.credits?.available?h('div',{className:'bc-notice'},hosted?'Bees needs Bees Credits to reply on the web. ':'Connect an AI model so Bees can reply. ',h('button',{className:'bc-primary',onClick:()=>{setSettingsSection(hosted?'credits':'ai');setDialog('settings');}},hosted?'Open Credits & billing':'Open AI connections')):null,
      thread?.frozen?h('div',{className:'bc-notice'},'This thread is frozen for transfer. The recipient must accept, or you can cancel the offer.'):null,
      thread?.unavailable?h('div',{className:'bc-notice'},'Showing the copy saved here. ',thread.unavailable):null,
      authority?.transfer_client_id&&authority.transfer_client_id===data?.clientId?h('div',{className:'bc-notice'},'A thread transfer is waiting for you. ',h('button',{className:'bc-primary',onClick:()=>act('acceptTransfer')},'Accept transfer')):null,
      selected?h(ThreadWorkspace,{key:data.clientId,initialLayout:data.settings?.threadLayout,toolbar:layoutToolbar,navigation,renderWidget,
        onSave:async threadLayout=>{await command('preferences',null,{values:{threadLayout}});await refresh();}})
      :h('div',{className:'bc-welcome-view'},h('section',{className:'bc-conversation'},
        h('div',{className:'bc-welcome'},h('span',{className:'bc-welcome-mark'},'✳'),
          h('div',{className:'bc-welcome-context'},
            icon('team'),
            h('span',null,currentTeam?.title||'Default'),
            h('span',{className:'bc-welcome-mode-badge'},newTemplate==='chat'?'Chat':'Goal')),
          h('h2',null,newTemplate==='chat'?'What would you like to discuss?':'What would you like to get done?'),
          h('p',null,`Start a ${newTemplate==='chat'?'chat':'goal'} in ${currentTeam?.title||'Default'}. Add files and people as you go.`),
          h('div',{className:'bc-suggestions'},(newTemplate==='chat'?['Brainstorm ideas','Explain a concept','Draft a message']:['Research a topic','Make sense of my files','Prepare a weekly update']).map(s=>h('button',{key:s,disabled:!canCreateInTeam,onClick:()=>setSuggestion({text:s})},s))))),conversation(false)))),
    modalOpen?h(Dialog,{title:'Welcome to Bees',onClose:closeDialog},
      error?h('p',{className:'bc-error',role:'alert'},error):null,notice?h('p',{className:'bc-notice',role:'status'},notice):null,
      h(Login,{server:data?.serverUrl,request:(action,values)=>command(action,null,values),onComplete:async()=>{
        const returnTo=loginReturn.current;loginReturn.current=null;clearAccount();const next=await refresh();setError('');setNotice('');
        if(returnTo){const target=next.teams.find(team=>team.id===returnTo)??next.teams.find(team=>team.id===next.defaultTeamId);setTeamId(target?.id);setOrganizationId(target?.organizationId??null);setTeamSection('addons');setDialog('team');}
        else setDialog(null);
      }})):null);

}

export function ThreadConversation({thread,discussion,peerNames,userId,userName,canWrite,viewOnly,manage,run,active,busy,act,onSend,onAttach,onFiles,onOpenFile,suggestion,templateId='goals',onTemplateChange,templates=WORKFLOW_TEMPLATES}){
  const [draft,setDraft]=useState(''),[pending,setPending]=useState([]),end=useRef(),picker=useRef(),pinned=useRef(true);
  const recovering=useRef(false);
  const needsReview=(thread?.runs??(run?[run]:[])).some(r=>r.status==='uncertain'&&r.reviews?.some(review=>review.state==='open'));
  const recovery=!active&&!needsReview&&['failed','uncertain','cancelled'].includes(run?.status)?run.status==='failed'?'Retry':'Continue':null;
  const recover=async()=>{
    if(!recovery||busy||!canWrite||recovering.current)return;
    recovering.current=true;
    try{await onSend(recovery==='Retry'?'Retry the previous request, checking existing work before repeating any actions.':'Continue the previous request using saved work and review decisions. Recheck external state and request fresh approval before external actions.',false);}
    finally{recovering.current=false;}
  };
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  const sendShortcut = isMac ? '⌘ Enter to send' : 'Ctrl+Enter to send';
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
      !discussion&&run?.error?h('div',{className:'bc-error',role:'alert'},needsReview?'Bees closed while waiting for your review. Resolve the saved review below to continue.':run.status==='uncertain'&&run.reviews?.some(review=>review.resumeRequired)?'Your review decision is saved. Choose Continue or send a message below.':run.error):null,
      !discussion&&recovery?h('div',{className:'bc-actions'},h('button',{type:'button',className:'bc-primary',disabled:busy||!canWrite,onClick:recover},recovery)):null,
      !discussion&&run?.pending&&(active||run.status==='uncertain'&&run.pending.kind==='review')?(run.pending.kind==='review'
        ?h(ReviewScreen,{key:run.pending.reviewId,review:run.reviews.find(review=>review.id===run.pending.reviewId),runId:run.id,act,readOnly:!canWrite||!manage,interrupted:run.status==='uncertain'})
        :h('fieldset',{disabled:!canWrite||run.pending.kind==='approval'&&!manage,className:'bc-fieldset'},h(Question,{key:run.pending.id,run,threadId:thread.id,act}))):null,h('div',{ref:end})):null,
    h('form',{className:'bc-composer',onSubmit:e=>{e.preventDefault();const sent=draft;void onSend(sent,discussion,()=>{setDraft(current=>current===sent?'':current);setPending([]);},pending);}},
      h('textarea',{placeholder:viewOnly?'You can view this but not send messages. Ask the owner for edit access.':discussion?'Message the people in this thread…':active?'You can send once Bees finishes.':chatting?'Chat with Bees…':'Ask Bees to get something done…','aria-label':discussion?'Discussion message':'Message',disabled:!canWrite,value:draft,onChange:e=>setDraft(e.target.value),onPaste:e=>{const files=busy?[]:pastedFiles(e);if(files.length){e.preventDefault();take(files);}},onKeyDown:e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();e.currentTarget.form.requestSubmit();}}}),
      pending.length?h('div',{className:'bc-pending-files'},pending.map(file=>h('span',{key:file.name},file.name,
        h('button',{type:'button',className:'bc-icon','aria-label':'Remove '+file.name,disabled:busy,onClick:()=>setPending(current=>current.filter(f=>f!==file))},icon('close'))))):null,
      h('div',{className:'bc-composer-footer'},h('button',{type:'button',className:'bc-icon','aria-label':'Attach files',title:'Attach files',disabled:busy||!canWrite,onClick:()=>picker.current?.click()},icon('plus')),
        h('input',{type:'file',multiple:true,hidden:true,ref:picker,onChange:e=>{const picked=[...e.target.files];e.target.value='';take(picked);}}),
        h('span',{className:'bc-spacer'}),
        h('div',{className:'bc-composer-status'},
          !discussion&&!messages.length&&!thread?.runs?.length?h('label',{className:'bc-template'},h('span',null,'Process'),h('select',{'aria-label':'Thread template',className:'bc-composer-process-select',value:templateId,disabled:busy||!canWrite||!!thread&&!manage,onChange:e=>onTemplateChange(e.target.value)},
            templateId==='custom'?h('option',{value:'custom'},'Custom process'):null,
            templates.map(t=>h('option',{key:t.id,value:t.id},t.name+(t.id==='goals'?' (default)':'')))))
          :h('span',{className:'bc-composer-mode'},discussion?'Discussion':chatting?'Chat with AI':'Ask Bees'),
          h('small',null,active?(chatting?'Bees is replying…':'Working on this machine'):chatting?`Your turn · ${sendShortcut}`:sendShortcut)),
        h('button',{className:'bc-send',type:'submit','aria-label':discussion?'Send discussion message':'Send message',title:active?'Waiting for Bees to finish…':`${discussion?'Send discussion message':'Send message'} (${isMac?'⌘ Enter':'Ctrl+Enter'})`,disabled:busy||!canWrite||!draft.trim()||active&&!discussion},icon('send')))));
}

function WorkflowSettings({thread,onSave,onDelete,canDelete,agents=[],section='general',scope='thread',disabled=false,busy=false}){
  const [title,setTitle]=useState(thread.title),[instructions,setInstructions]=useState(thread.instructions??''),[memory,setMemory]=useState((thread.memory??[]).join('\n'));
  const [stages,setStages]=useState(thread.workflow??DEFAULT_WORKFLOW);
  if(section==='schedule')return h(ScheduleSettings,{thread,scope,disabled,busy,onSave});
  return h('form',{className:'bc-form',onSubmit:e=>{e.preventDefault();if(disabled||busy)return;onSave(section==='general'?{title,...(scope!=='thread'?{instructions}:{})}:section==='memory'?{memory:memory.split('\n').map(s=>s.trim()).filter(Boolean)}:{workflow:stages});}},
    h('h3',null,({general:'General',memory:scope==='team'?'Team memory':'Thread memory',workflow:'Default process'})[section]),
    h('fieldset',{disabled:disabled||busy,className:'bc-form bc-fieldset'},
    section==='general'?h(React.Fragment,null,
    h(Field,{label:scope==='team'?'Team name':'Thread name',value:title,required:true,pattern:'.*\\S.*',title:'Enter a name, not just spaces.',maxLength:180,onChange:e=>setTitle(e.target.value)}),
    scope!=='thread'?h('label',{className:'bc-field'},h('span',null,scope==='team'?'Instructions for every thread':'Existing thread instructions'),h('textarea',{value:instructions,rows:3,maxLength:20000,onChange:e=>setInstructions(e.target.value),placeholder:'How should Bees approach work in this team?'})):null,
    ):null,
    section==='memory'?h('label',{className:'bc-field'},h('span',null,scope==='team'?'Remember across this team · one note per line':'Remember in this thread · one note per line'),h('textarea',{value:memory,rows:3,onChange:e=>setMemory(e.target.value)})):null,
    section==='workflow'?h(React.Fragment,null,h('p',null,`${processName(stages)} · ${isChatWorkflow(stages)?'You → Chat → You ↻':stages.map(stage=>stage.name).concat('Done').join(' → ')}`),h('strong',null,'Process stages'),h(WorkflowStages,{stages,agents,onChange:setStages,disabled:disabled||busy})):null,
    disabled?null:h('button',{className:'bc-primary',type:'submit'},busy?'Saving…':scope==='team'?'Save team settings':'Save thread settings')),
    scope==='thread'&&section==='general'&&onDelete?h('div',{className:'bc-form-section bc-form-danger'},
      h('h4',null,'Delete thread'),
      h('p',{className:'bc-muted'},'Permanently delete this thread, its runs, files, and conversation history.'),
      h('button',{type:'button',className:'danger',disabled:busy||!canDelete,title:!canDelete?'Stop running work before deleting':undefined,onClick:onDelete},'Delete thread')):null);
}

function LegacyOverrides({rows,section,perform,busy,signedIn,onSignIn,request=command}){
  const [id,setId]=useState(rows[0]?.id),[doc,setDoc]=useState(null);
  useEffect(()=>{let current=true;setDoc(null);if(id)void perform(async()=>{const value=await request('read',id);if(current)setDoc(value);});return()=>{current=false;};},[id]);
  return h('details',{className:'bc-legacy-settings'},h('summary',null,'Existing thread settings'),
    h('p',{className:'bc-muted'},'Settings saved before teams are preserved for these threads. Team instructions and memory are added to them; a saved team workflow takes priority.'),
    h('select',{'aria-label':'Existing thread settings',value:id,onChange:e=>setId(e.target.value)},rows.map(row=>h('option',{key:row.id,value:row.id},row.title))),
    doc?['addons','browser'].includes(section)?h(IntegrationSettings,{key:id+section,threadId:id,scope:'thread',canManage:!doc.frozen&&!doc.unavailable,signedIn,onSignIn,request,perform,page:section})
      :h(WorkflowSettings,{key:id+section,thread:doc,scope:'legacy',section,busy,disabled:doc.frozen||!!doc.unavailable,onSave:values=>perform(async()=>{setDoc(await request('configure',id,values));})}):null);
}

function OrganizationsPanel({perform,busy,icon,ctx,folders,onSaveFolder,organizationId,onSelectOrganization,onChanged,onNotice,request=command}){
  const id=organizationId??'';
  const [data,setData]=useState({organizations:[],invitations:[]}),[members,setMembers]=useState({members:[],clients:[]}),[name,setName]=useState(''),[email,setEmail]=useState('');
  const load=async()=>{const next=await request('organizations');setData(next);return next;};useEffect(()=>{void perform(async()=>{const next=await load();if(!id&&next.organizations.length===1)onSelectOrganization?.(next.organizations[0].id);});},[]);
  // heartbeats land every 5s, so re-read the clients to keep Online honest
  useEffect(()=>{let current=true;setMembers({members:[],clients:[]});const get=async()=>{const next=await request('organizationMembers',null,{organizationId:id});if(current)setMembers({...next,at:Date.now()});};if(id)void perform(get);const timer=id?setInterval(()=>void get().catch(()=>{}),15000):null;return()=>{current=false;clearInterval(timer);};},[id]);
  const chooseOrganization=id=>onSelectOrganization?.(id);
  const organization=data.organizations.find(org=>org.id===id);
  const admin=['owner','admin'].includes(organization?.role);
  return h('section',{className:'bc-form'},h('h3',null,'Organizations'),h('p',{className:'bc-muted'},'See your colleagues and their computers. Thread invitations decide who can open each thread.'),
    data.invitations.map(i=>h('div',{key:i.id,className:'bc-person'},h('span',null,(i.invited_by_name?i.invited_by_name+' invited you to ':'You’re invited to ')+(i.organization_name??'an organization')),h('button',{disabled:busy,onClick:()=>perform(async()=>{await request('acceptOrganization',null,{invitationId:i.id});await load();chooseOrganization(i.organization_id);await onChanged?.();onNotice?.(`You joined ${i.organization_name??'the organization'}.`);})},'Join'))),
    h('form',{className:'bc-actions',onSubmit:e=>{e.preventDefault();if(!busy&&name.trim())void perform(async()=>{const org=await request('createOrganization',null,{name:name.trim()});setName('');await load();chooseOrganization(org.id);await onChanged?.();});}},h('input',{'aria-label':'Organization name',placeholder:'Organization name',maxLength:120,value:name,onChange:e=>setName(e.target.value)}),h('button',{type:'submit',disabled:busy||!name.trim()},'Create')),
    organization?h(OrganizationAppearance,{key:organization.id,organization,icon,busy,onSave:appearance=>perform(async()=>{await request('organizationAppearance',null,{organizationId:id,appearance});await load();await onChanged?.();return true;})}):null,
    organization?h(RootFolderSettings,{key:organization.id,ctx,folders,organization,busy,onSave:onSaveFolder}):null,
    id?members.members.map(m=>h('div',{key:m.user_id,className:'bc-person'},h('span',null,m.name??m.email),h('small',null,{owner:'Owner',admin:'Admin',member:'Member'}[m.role]??m.role),admin&&m.role!=='owner'?h('button',{disabled:busy,onClick:()=>perform(async()=>{if(!await confirmAction(`Remove ${m.name??m.email} from this organization?`,'Remove'))return;await request('removeOrganizationMember',null,{organizationId:id,userId:m.user_id});setMembers(await request('organizationMembers',null,{organizationId:id}));})},'Remove'):null)):null,
    id?members.clients.map(c=>h('small',{key:c.id},c.name+' · '+(members.at-Date.parse(c.last_seen_at)<30000?'Online':'Offline'))):null,
    id&&admin?h('form',{className:'bc-actions',onSubmit:e=>{e.preventDefault();const to=email.trim();if(!busy&&to)void perform(async()=>{await request('inviteOrganization',null,{organizationId:id,email:to});setEmail('');onNotice?.(`Invited ${to}. They can join from Organization settings in Bees.`);});}},h('input',{'aria-label':'Invite colleague by email',type:'email',required:true,placeholder:'Colleague’s email',value:email,onChange:e=>setEmail(e.target.value)}),h('button',{type:'submit',disabled:busy||!email.trim()},'Invite')):null);
}
