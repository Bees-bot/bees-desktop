import { h, React, useEffect, useState, useRef, hosted, CustomAiSettings, OpenAiServersSettings, SubscriptionSettings, MarkdownText } from './runtime.js';
import { ask, confirmAction, openExternal, Button } from './common.js';
import { threadCss } from './thread-style.js';
import { THEME_PRESETS, nextThemePreset } from '../lib/themes.js';
import { AppearanceSettings, themeStyle, useAppearance } from './thread-appearance.js';
import { GLOBAL_SETTINGS, THREAD_SETTINGS, SettingsNav, ThreadDetails } from './thread-panels.js';
import { scheduleDraft } from './thread-schedule-form.js';
import { ThreadFiles } from './thread-files.js';
import { ThreadKanban } from './thread-kanban.js';
import { DEFAULT_WORKFLOW, processName } from '../lib/thread-workflow.js';
import { IntegrationSettings } from './thread-integrations.js';
import { Login } from './thread-login.js';
import { ThreadWorkspace } from './thread-layout.js';

async function api(input){const response=await fetch('/bees-api/threads',{...(input?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}:{}),credentials:'same-origin'});const value=await response.json();if(!response.ok)throw Error(typeof value.error==='string'?value.error:value.error?.message??'Could not complete this request');return value;}
const command=(action,threadId,values={})=>api({action,threadId,operationId:crypto.randomUUID(),...values});
const initials=name=>(name??'You').split(/\s|@/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
const icon=(name,props={})=>h('svg',{width:20,height:20,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,...props},
  ...( {plus:[h('path',{key:1,d:'M12 5v14M5 12h14'})],chat:[h('path',{key:1,d:'M21 11a8 8 0 0 1-8 8H6l-4 3 1-7A8 8 0 1 1 21 11Z'})],search:[h('circle',{key:1,cx:10,cy:10,r:6}),h('path',{key:2,d:'m15 15 5 5'})],file:[h('path',{key:1,d:'M14 2H5v20h14V7Z M14 2v6h5 M8 13h8 M8 17h6'})],send:[h('path',{key:1,d:'m3 3 18 9-18 9 4-9Z M7 12h14'})],share:[h('path',{key:1,d:'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M16 4a4 4 0 0 1 0 8 M20 15v6 M17 18h6'}),h('circle',{key:2,cx:8.5,cy:7,r:4})],settings:[h('path',{key:1,d:'M4 7h16 M4 17h16'}),h('circle',{key:2,cx:8,cy:7,r:3,fill:'currentColor'}),h('circle',{key:3,cx:16,cy:17,r:3,fill:'currentColor'})],transfer:[h('path',{key:1,d:'M4 7h15l-4-4 M20 17H5l4 4 M19 7l-4 4 M5 17l4-4'})],more:[h('circle',{key:1,cx:5,cy:12,r:1}),h('circle',{key:2,cx:12,cy:12,r:1}),h('circle',{key:3,cx:19,cy:12,r:1})],close:[h('path',{key:1,d:'m6 6 12 12 M18 6 6 18'})]}[name]??[]));
function Field({label,...props}){return h('label',{className:'bc-field'},h('span',null,label),h('input',props));}
function Dialog({title,onClose,children,wide=false}){const ref=useRef();useEffect(()=>{ref.current.showModal();},[]);return h('dialog',{ref,className:'bc-dialog'+(wide?' bc-dialog-wide':''),onCancel:onClose},h('header',null,h('h2',null,title),h('button',{className:'bc-icon',onClick:onClose,'aria-label':'Close'},icon('close'))),children);}
function Question({run,threadId,act}){const [answers,setAnswers]=useState({});const p=run.pending;if(!p)return null;return h('section',{className:'bc-question'},h('strong',null,p.kind==='approval'?'Your approval is needed':'Bees has a question'),p.text?h('p',{className:'bc-preserve'},p.text):null,(p.questions??[]).map(q=>h('label',{key:q.id,className:'bc-field'},h('span',null,q.question),q.detail?h('small',null,q.detail):null,h('input',{value:answers[q.id]??'',onChange:e=>setAnswers({...answers,[q.id]:e.target.value})}),q.options?.length?h('small',null,q.options.map(o=>o.label).join(' · ')):null)),p.kind==='approval'?h('div',{className:'bc-actions'},h('button',{className:'bc-primary',onClick:()=>act('answer',{questionId:p.id,approved:true})},'Approve'),h('button',{onClick:()=>act('answer',{questionId:p.id,approved:false})},'Reject')):h('button',{className:'bc-primary',onClick:()=>act('answer',{questionId:p.id,answers:Object.fromEntries(Object.entries(answers).map(([k,v])=>[k,{answers:[v]}]))})},'Send answer'));}
function AiConnections({ctx,preferences,modelSettings,models,onModel,current}){
  const [systemDefault,setDefault]=useState(null);useEffect(()=>{if(!hosted)fetch('/bees-api/system-default-model').then(r=>r.json()).then(v=>setDefault(v.systemDefaultModel));},[]);
  return h('div',{className:'bc-form'},h('label',{className:'bc-field'},h('span',null,'Default AI'),h('select',{value:current??'',onChange:e=>onModel(e.target.value)},h('option',{value:''},'Use connected system default'),models.map(m=>h('option',{key:m.id,value:m.id},m.name)))),!hosted&&ctx&&preferences&&modelSettings?h(React.Fragment,null,
    h(SubscriptionSettings,{ctx,preferences,modelSettings,systemDefault,ask,openExternal,Button,pickFile:window.__TAURI__?.core?.invoke?options=>window.__TAURI__.core.invoke('plugin:dialog|open',{options}):undefined,onChange:()=>{}}),
    h(CustomAiSettings,{ctx,preferences,modelSettings,systemDefault,ask,confirmAction,openExternal,Button}),
    h(OpenAiServersSettings,{ctx,preferences,modelSettings,systemDefault,ask,Button})
  ):h('p',{className:'bc-muted'},'AI connections are supplied by this hosted Bees Client.'));
}

export function ThreadApp({ctx,preferences,modelSettings}) {
  const [data,setData]=useState(null), [selected,setSelected]=useState(null), [thread,setThread]=useState(null);
  const [query,setQuery]=useState(''), [tab,setTab]=useState('all'), [navigation,setNavigation]=useState(null), [suggestion,setSuggestion]=useState(null);
  const [layoutToolbar,setLayoutToolbar]=useState(null);
  const [dialog,setDialog]=useState(null), [settingsSection,setSettingsSection]=useState('ai'), [threadSection,setThreadSection]=useState('general');
  const [error,setError]=useState(''), [notice,setNotice]=useState(''), [busy,setBusy]=useState(false), [preview,setPreview]=useState(null);
  const [email,setEmail]=useState(''), [role,setRole]=useState('viewer'), [target,setTarget]=useState(''), [inviteLink,setInviteLink]=useState('');
  const selectedRef=useRef(selected), profileEpoch=useRef(0); selectedRef.current=selected;
  const preference=useAppearance(preferences,data?.settings);
  const theme=THEME_PRESETS.find(t=>t.id===preference.themePreset)??THEME_PRESETS.find(t=>t.id==='corporate');
  const refresh=async()=>{const epoch=profileEpoch.current;const next=await api();if(epoch===profileEpoch.current)setData(next);return next;};
  const read=async id=>{const epoch=profileEpoch.current;const value=await command('read',id);if(epoch===profileEpoch.current&&selectedRef.current===id)setThread(value);return value;};
  const perform=async fn=>{setBusy(true);setError('');try{return await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const act=(action,values={})=>perform(async()=>{const id=selected;const result=await command(action,id,values);await refresh();if(id)await read(id);return result;});
  const select=id=>{if(id!==selected)setThread(null);selectedRef.current=id;setSelected(id);setSuggestion(null);setNavigation({id:'conversation'});setDialog(null);setInviteLink('');setNotice('');};
  const navigate=next=>{setNavigation({id:next});setDialog(null);};
  const openSettings=(section,id=selected)=>{if(id!==selected)select(id);setThreadSection(section);setInviteLink('');setDialog('thread');};
  const openGlobal=section=>{setSettingsSection(section);setDialog('settings');setNotice('');};
  useEffect(()=>{
    const previousTitle=document.title;document.title='Bees Client';
    const style=document.createElement('style');style.textContent=threadCss;document.head.append(style);
    const dismissMenus=event=>{for(const menu of document.querySelectorAll('.bc-thread-menu[open]'))if(!menu.contains(event.target))menu.open=false;};
    document.addEventListener('pointerdown',dismissMenus,true);
    let alive=true;const tick=()=>{if(alive)void refresh().catch(e=>{setError(e.message);if(hosted)setDialog('login');});};
    tick();const timer=setInterval(tick,5000);
    return()=>{alive=false;clearInterval(timer);document.removeEventListener('pointerdown',dismissMenus,true);style.remove();document.title=previousTitle;};
  },[]);
  useEffect(()=>{setPreview(null);setThread(null);if(selected)void read(selected).catch(e=>setError(e.message));},[selected]);
  useEffect(()=>{if(selected&&thread)void read(selected).catch(()=>{});},[data]);
  useEffect(()=>{if(preferences?.getSnapshot().status==='ready')(ctx?.get?.('theme')??ctx?.theme)?.setTheme(theme.dark?'dark':'light');},[ctx,theme.id]);
  const saveAppearance=values=>perform(async()=>{
    if(preferences){if(preferences.getSnapshot().status!=='ready')throw Error('Settings are still loading');for(const [key,value] of Object.entries(values))await preferences.set(key,value);}
    else {await command('preferences',null,{values});await refresh();}
  });
  const clearAccount=()=>{profileEpoch.current++;select(null);setThread(null);setPreview(null);setSuggestion(null);setData(null);};
  const create=()=>perform(async()=>{const next=await command('create',null,{title:'New thread'});await refresh();select(next.id);});
  const send=(text,discussion=false,onAccepted)=>perform(async()=>{
    if(!text.trim()||busy||!canWrite||active&&!discussion)return false;
    let id=selected;if(!id){const created=await command('create');id=created.id;select(id);}
    await command(discussion?'discussion':'message',id,{text});onAccepted?.();
    if(!discussion)await command('run',id,{text});await refresh();await read(id);return true;
  });
  const attach=(files,prefix='')=>perform(async()=>{
    const id=selected;if(!id)throw Error('Start a thread before attaching files');
    if(files.some(file=>file.size>10_000_000))throw Error('Files must be 10 MB or smaller');
    for(const file of files){
      const content=await new Promise((ok,bad)=>{const reader=new FileReader();reader.onload=()=>ok(reader.result.split(',')[1]);reader.onerror=()=>bad(Error('Could not read '+file.name));reader.readAsDataURL(file);});
      await command('attach',id,{name:file.name,path:prefix+(file.webkitRelativePath||file.name),content});
    }
    await read(id);setNotice(`Added ${files.length} file${files.length===1?'':'s'}.`);return true;
  });
  const roster=data?.directory??{threads:[],participants:[],clients:[],invitations:[]};
  const known=new Set(data?.threads?.map(t=>t.id));
  const threads=[...(data?.threads??[]),...roster.threads.filter(t=>!known.has(t.id)).map(t=>({id:t.id,title:'Shared thread',shared:true,ownerClientId:t.owner_client_id}))]
    .filter(t=>(tab!=='shared'||t.shared)&&(tab!=='mine'||t.ownerClientId===data?.clientId)&&(t.title+' '+t.id).toLowerCase().includes(query.toLowerCase()));
  const authority=roster.threads.find(t=>t.id===selected), participants=roster.participants.filter(p=>p.thread_id===selected);
  const owner=roster.clients.find(c=>c.id===(authority?.owner_client_id??thread?.ownerClientId));
  const own=!!thread&&thread.ownerClientId===data?.clientId, manage=!!thread&&(own||thread.ownerUserId===data?.user?.id);
  const run=thread?.runs?.at(-1), active=run?.status==='running';
  const canEdit=!selected||!!thread&&(own||participants.some(p=>p.user_id===data?.user?.id&&p.role!=='viewer'));
  const canWrite=canEdit&&!thread?.frozen&&!thread?.unavailable;
  const canConfigure=manage&&canWrite;
  const peerNames=new Map(roster.participants.map(p=>[p.user_id,p.name??p.email]));
  const transferClients=roster.clients.filter(c=>c.id!==data?.clientId&&(c.user_id===data?.user?.id||participants.some(p=>p.user_id===c.user_id&&p.role!=='viewer')));
  const previewFile=file=>setPreview({...file,url:`/bees-api/thread-file?thread=${selected}&artifact=${file.id}`});
  const saveThread=values=>perform(async()=>{await command('configure',selected,values);await refresh();await read(selected);setNotice('Thread settings saved.');});
  const files=thread?h(ThreadFiles,{key:selected,thread,canWrite,busy,onAttach:attach,onPreview:previewFile,preview,onClosePreview:()=>setPreview(null)}):null;
  const integrations=section=>h(IntegrationSettings,{key:selected+section,threadId:selected,canManage:own&&canConfigure,request:command,perform,page:section});
  const configuration=section=>h(WorkflowSettings,{key:selected+section,thread,section,disabled:!canConfigure,busy,onSave:saveThread});
  const members=h('section',{className:'bc-form'},h('h3',null,'Members'),
    !participants.length?h('p',null,'Only you have access to this private thread.'):null,
    participants.map(p=>h('div',{key:p.user_id,className:'bc-person'},h('span',null,p.name??p.email),h('small',null,p.role),
      canConfigure&&p.role!=='owner'?h('button',{disabled:busy,onClick:()=>act('remove',{userId:p.user_id})},'Remove'):null)),
    h('button',{onClick:()=>setThreadSection('invitations')},'Invite someone'));
  const invitations=h('form',{className:'bc-form',onSubmit:event=>{event.preventDefault();void perform(async()=>{
    if(!data?.user){setDialog('login');return;}const invite=await command('share',selected,{email,role});setInviteLink(invite.url);await refresh();
  });}},h('h3',null,'Invitations'),h('p',{className:'bc-muted'},'Invite someone to this thread, including people outside your organization.'),
    h(Field,{label:'Email',type:'email',required:true,value:email,onChange:e=>setEmail(e.target.value)}),
    h('label',{className:'bc-field'},h('span',null,'Access'),h('select',{value:role,onChange:e=>setRole(e.target.value)},
      h('option',{value:'viewer'},'Can view'),h('option',{value:'editor'},'Can contribute and run work'))),
    h('button',{type:'submit',className:'bc-primary',disabled:busy||!canConfigure},data?.user?'Create invitation':'Sign in to invite'),
    inviteLink?h('label',{className:'bc-field'},h('span',null,'Invitation link'),h('input',{readOnly:true,value:inviteLink,onFocus:e=>e.target.select()})):null);
  const transfer=h('form',{className:'bc-form',onSubmit:e=>{e.preventDefault();void act('transfer',{targetClientId:target});}},
    h('h3',null,'Transfer thread'),h('p',{className:'bc-muted'},'Move the thread, files and execution to another participating client. Reconnect MCP credentials and choose browser access there.'),
    h('select',{'aria-label':'Destination client',value:target,required:true,onChange:e=>setTarget(e.target.value)},h('option',{value:''},'Choose a participating client'),transferClients.map(c=>h('option',{key:c.id,value:c.id},c.name))),
    h('button',{className:'bc-primary',type:'submit',disabled:busy||active||!own||!data?.user},'Offer transfer'),
    authority?.transfer_client_id?h('button',{type:'button',onClick:()=>act('cancelTransfer')},'Cancel pending transfer'):null);
  const account=data?.user?h('section',{className:'bc-form'},h('p',null,data.user.email),
    !data.user.emailVerified?h('button',{onClick:()=>perform(async()=>{await command('verifyEmail');setNotice('Check your email to verify your account.');})},'Send verification email'):null,
    h('button',{onClick:()=>perform(async()=>{await command('logout');clearAccount();await refresh();setDialog(hosted?'login':null);})},'Sign out'))
    :h('button',{onClick:()=>setDialog('login')},'Sign in');
  const threadContent=!thread?h('p',{role:'status'},'Loading thread settings…')
    :['general','workflow','memory','schedule'].includes(threadSection)?configuration(threadSection)
    :threadSection==='members'?members:threadSection==='invitations'?invitations:threadSection==='transfer'?transfer
    :threadSection==='folders'?files:integrations(threadSection);
  const globalContent=settingsSection==='ai'?h(AiConnections,{ctx,preferences,modelSettings,models:data?.models??[],current:data?.defaultModel,onModel:model=>act('model',{model})})
    :settingsSection==='appearance'?h(AppearanceSettings,{preference,onSave:saveAppearance,disabled:busy||!!preferences&&preferences.getSnapshot().status!=='ready'})
    :settingsSection==='organizations'?(data?.user?h(OrganizationsPanel,{key:data.user.id,perform}):h('button',{onClick:()=>setDialog('login')},'Sign in to manage organizations'))
    :settingsSection==='account'?account
    :settingsSection==='instructions'?h('form',{className:'bc-form',key:data?.clientId,onSubmit:event=>{event.preventDefault();const systemInstructions=new FormData(event.currentTarget).get('instructions');void perform(async()=>{await command('preferences',null,{values:{systemInstructions}});await refresh();setNotice('System instructions saved.');});}},
      h('h3',null,'System instructions'),h('p',{className:'bc-muted'},'Applied to new runs in every thread on this client.'),h('textarea',{'aria-label':'System instructions',name:'instructions',rows:10,maxLength:20000,defaultValue:data?.settings?.systemInstructions??''}),h('button',{className:'bc-primary',disabled:busy||!data},'Save instructions'))
    :h('section',{className:'bc-form'},h('h3',null,'Data & files'),h('p',null,'Threads keep their own files and folders. Add files or whole folders from a thread’s Files tab.'),h('p',{className:'bc-muted'},'Files and results travel with a shared or transferred thread. AI connections, browser access and integration credentials stay on the client where you configured them.'));
  const conversation=discussion=>h(ThreadConversation,{key:selected??'welcome',thread,discussion,peerNames,userId:data?.user?.id,canWrite,manage,run,active,busy,act,onSend:send,onFiles:()=>navigate('files'),suggestion:selected?null:suggestion});
  const renderWidget=page=>!thread?h('p',{className:'bc-muted',role:'status'},'Connecting to this thread…')
    :['conversation','discussion'].includes(page)?conversation(page==='discussion')
    :h('section',{className:'bc-conversation'+(page==='files'?' bc-files-tab':'')},
      page==='kanban'?h(ThreadKanban,{key:selected,thread,onConversation:()=>navigate('conversation'),onWorkflow:()=>openSettings('workflow')})
      :page==='files'?files:page==='addons'?integrations('addons'):['schedule','memory'].includes(page)?configuration(page)
      :h(ThreadDetails,{thread,page,onSettings:openSettings,onFiles:()=>navigate('files')}));
  return h('div',{className:'bc-app '+(selected?'has-thread':''),'data-bees-theme':theme.id,style:themeStyle(theme)},
    h('nav',{className:'bc-rail','aria-label':'Main navigation'},
      h('button',{className:'bc-brand',title:'Bees Client',onClick:()=>select(null)},'✳'),
      h('button',{className:'bc-icon selected','aria-label':'Threads',onClick:()=>select(null)},icon('chat')),
      h('div',{className:'bc-spacer'}),
      h('button',{className:'bc-icon','aria-label':'Organization settings',title:'Organization settings',onClick:()=>openGlobal('organizations')},icon('share')),
      h('button',{className:'bc-icon','aria-label':`Switch to ${theme.dark?'light':'dark'} theme`,title:'Switch theme',onClick:()=>{const next=nextThemePreset(preference);void saveAppearance({themePreset:next.id,colorMode:next.dark?'dark':'light'});}},theme.dark?'☀':'☾'),
      h('button',{className:'bc-icon','aria-label':'Global settings',title:'Global settings',onClick:()=>openGlobal('ai')},icon('settings')),
      h('button',{className:'bc-avatar',title:data?.user?.email??'Sign in','aria-label':'Your account',onClick:()=>data?.user?openGlobal('account'):setDialog('login')},initials(data?.user?.email))),
    h('aside',{className:'bc-sidebar'},h('header',null,h('h1',null,'Threads'),h('button',{className:'bc-icon','aria-label':'New thread',onClick:create,disabled:busy},icon('plus'))),
      h('div',{className:'bc-search'},icon('search'),h('input',{'aria-label':'Search threads',placeholder:'Find a thread…',value:query,onChange:e=>setQuery(e.target.value)})),
      h('div',{className:'bc-tabs'},['all','mine','shared'].map(t=>h('button',{key:t,'aria-pressed':tab===t,onClick:()=>setTab(t)},t[0].toUpperCase()+t.slice(1)))),
      h('div',{className:'bc-thread-list'},threads.map(t=>h('div',{key:t.id,className:'bc-thread-row '+(selected===t.id?'active':'')},
        h('button',{className:'bc-thread','aria-current':selected===t.id?'page':undefined,onClick:()=>select(t.id)},h('span',{className:'bc-thread-symbol'},icon('chat')),
          h('span',null,h('strong',null,t.title),h('small',null,t.preview??'Open shared work')),t.runs?.some(r=>r.status==='running')?h('span',{className:'bc-dot',title:'Running'}):null),
        h('div',{className:'bc-thread-meta'},h('code',{title:t.id},t.id.slice(0,8)),
          h('details',{className:'bc-thread-menu',onKeyDown:event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary').focus();}}},
            h('summary',{'aria-label':`Settings for ${t.title}`,title:'Thread settings'},icon('more')),
            h('nav',{'aria-label':`${t.title} settings`},THREAD_SETTINGS.map(([id,label])=>h('button',{key:id,onClick:event=>{event.currentTarget.closest('details').open=false;openSettings(id,t.id);}},label))))))),
        !threads.length?h('p',{className:'bc-muted bc-empty-list'},'Your work starts with a thread.'):null),
      roster.invitations?.length?h('section',{className:'bc-invitations'},h('strong',null,'Invitations'),roster.invitations.map(i=>h('button',{key:i.id,onClick:()=>perform(async()=>{await command('acceptInvitation',null,{invitationId:i.id});await refresh();select(i.thread_id);})},'Join shared thread'))):null,
      h('footer',null,h('span',{className:'bc-dot '+(data?.connectionError?'offline':'')}),data?.user?'Connected to Bees':'Private on this machine')),
    h('main',{className:'bc-main'},
      h('header',{className:'bc-thread-header'},h('div',null,h('h2',null,thread?.title??(selected?'Loading thread…':'A little help. A lot done.')),
        h('p',null,selected?(owner?.name??(own?'This machine':'Shared work')):'Your people, AI, and work in one conversation.')),
        selected?h('div',{className:'bc-actions'},
          h('button',{'aria-label':'Thread settings',onClick:()=>openSettings('general')},icon('more')),h('button',{title:'Share thread',onClick:()=>openSettings('invitations')},icon('share'),'Share'),h('span',{className:'bc-layout-toolbar',ref:setLayoutToolbar})):null),
      error?h('div',{className:'bc-error',role:'alert'},error,h('button',{className:'bc-icon','aria-label':'Dismiss error',onClick:()=>setError('')},icon('close'))):null,
      notice?h('div',{className:'bc-notice',role:'status'},notice):null,
      thread?.frozen?h('div',{className:'bc-notice'},'This thread is frozen for transfer. The recipient must accept, or you can cancel the offer.'):null,
      thread?.unavailable?h('div',{className:'bc-notice'},'Showing the copy saved here. ',thread.unavailable):null,
      authority?.transfer_client_id&&authority.transfer_client_id===data?.clientId?h('div',{className:'bc-notice'},'A thread transfer is waiting for you. ',h('button',{className:'bc-primary',onClick:()=>act('acceptTransfer')},'Accept transfer')):null,
      selected?h(ThreadWorkspace,{key:data.clientId,initialLayout:data.settings?.threadLayout,toolbar:layoutToolbar,navigation,renderWidget,
        onSave:async threadLayout=>{await command('preferences',null,{values:{threadLayout}});await refresh();}})
      :h('div',{className:'bc-welcome-view'},h('section',{className:'bc-conversation'},
        h('div',{className:'bc-welcome'},h('span',{className:'bc-welcome-mark'},'✳'),h('h2',null,'What would you like to get done?'),h('p',null,'Start with an idea. Add files and people as you go.'),
          h('div',{className:'bc-suggestions'},['Research a topic','Make sense of my files','Prepare a weekly update'].map(s=>h('button',{key:s,onClick:()=>setSuggestion({text:s})},s))))),conversation(false))),
    dialog?h(Dialog,{wide:dialog!=='login',title:dialog==='settings'?'Global & organization settings':dialog==='thread'?`Thread settings${thread?' · '+thread.title:''}`:'Welcome to Bees',onClose:()=>setDialog(null)},
      error?h('p',{className:'bc-error',role:'alert'},error):null,notice?h('p',{role:'status'},notice):null,
      dialog==='settings'?h('div',{className:'bc-settings-layout'},h(SettingsNav,{items:GLOBAL_SETTINGS,selected:settingsSection,onSelect:section=>{setSettingsSection(section);setNotice('');},label:'Global settings sections'}),h('div',{className:'bc-settings-content'},globalContent))
      :dialog==='thread'?h('div',{className:'bc-settings-layout'},h(SettingsNav,{items:THREAD_SETTINGS,selected:threadSection,onSelect:section=>{setThreadSection(section);setNotice('');},label:'Thread settings sections'}),h('div',{className:'bc-settings-content'},
        thread&&!canConfigure?h('p',{className:'bc-muted'},'Read-only settings. Only the owner can change this thread’s configuration.'):null,threadContent))
      :h(Login,{server:data?.serverUrl,request:(action,values)=>command(action,null,values),onComplete:async()=>{clearAccount();await refresh();setError('');setNotice('');setDialog(null);}})):null);
}

export function ThreadConversation({thread,discussion,peerNames,userId,canWrite,manage,run,active,busy,act,onSend,onFiles,suggestion}){
  const [draft,setDraft]=useState(''),end=useRef();
  const messages=(thread?.messages??[]).filter(m=>discussion?m.kind==='discussion':m.kind!=='discussion');
  useEffect(()=>{if(suggestion&&!discussion)setDraft(suggestion.text);},[suggestion]);
  useEffect(()=>{if(end.current?.getClientRects().length)end.current.scrollIntoView({block:'nearest'});},[messages.length]);
  return h('div',{className:'bc-chat-widget'+(!discussion&&!messages.length?' bc-empty-chat':'')},
    thread?h('section',{className:'bc-conversation','aria-label':discussion?'Discussion messages':'Conversation messages'},
      discussion&&!messages.length?h('p',{className:'bc-muted'},'Discuss this work with the people in your thread. Messages here do not start an AI run.'):null,
      messages.map(m=>h('article',{key:m.id,className:'bc-message '+m.kind},
        h('span',{className:'bc-avatar '+(m.kind==='assistant'?'bees':'')},m.kind==='assistant'?'✳':initials(peerNames.get(m.authorId)??m.authorId)),h('div',null,
          h('div',{className:'bc-message-author'},m.kind==='assistant'?'Bees':peerNames.get(m.authorId)??(m.authorId===userId||m.authorId==='local'?'You':m.authorId),h('small',null,new Date(m.createdAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))),
          h('div',{className:'bc-bubble'},h(MarkdownText,{text:m.text,content:m.text}))))),
      !discussion&&active?h('div',{className:'bc-working',role:'status'},h('span',{className:'bc-dot'}),run.stage??'Bees is working…',h('button',{disabled:!canWrite,onClick:()=>act('stop')},'Stop')):null,
      !discussion&&run?.error?h('div',{className:'bc-notice'},run.error):null,
      !discussion&&run?.pending?h('fieldset',{disabled:!canWrite||run.pending.kind==='approval'&&!manage,className:'bc-fieldset'},h(Question,{key:run.pending.id,run,threadId:thread.id,act})):null,h('div',{ref:end})):null,
    h('form',{className:'bc-composer',onSubmit:e=>{e.preventDefault();const sent=draft;void onSend(sent,discussion,()=>setDraft(current=>current===sent?'':current));}},
      h('textarea',{placeholder:discussion?'Message the people in this thread…':'Ask Bees to get something done…','aria-label':discussion?'Discussion message':'Message',disabled:!canWrite,value:draft,onChange:e=>setDraft(e.target.value),onKeyDown:e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();e.currentTarget.form.requestSubmit();}}}),
      h('div',{className:'bc-composer-footer'},h('button',{type:'button',className:'bc-icon','aria-label':'Add files and folders',disabled:!thread,onClick:onFiles},icon('plus')),
        h('span',null,discussion?'Discussion':'Ask Bees'),h('span',{className:'bc-spacer'}),h('small',null,active?'Working on this machine':'⌘ Enter to send'),
        h('button',{className:'bc-send',type:'submit','aria-label':discussion?'Send discussion message':'Send message',disabled:busy||!canWrite||!draft.trim()||active&&!discussion},icon('send')))));
}

function WorkflowSettings({thread,onSave,section='general',disabled=false,busy=false}){
  const [title,setTitle]=useState(thread.title),[instructions,setInstructions]=useState(thread.instructions??''),[memory,setMemory]=useState((thread.memory??[]).join('\n'));
  const [stages,setStages]=useState(thread.workflow??DEFAULT_WORKFLOW);
  const [scheduled,setScheduled]=useState(!!thread.schedule?.enabled),[recurrence,setRecurrence]=useState(scheduleDraft(thread.schedule));
  const update=(key,value)=>setRecurrence({...recurrence,[key]:value});
  return h('form',{className:'bc-form',onSubmit:e=>{e.preventDefault();if(disabled||busy)return;onSave(section==='general'?{title,instructions}:section==='memory'?{memory:memory.split('\n').map(s=>s.trim()).filter(Boolean)}:section==='workflow'?{workflow:stages}:{schedule:scheduled?recurrence:null});}},
    h('h3',null,({general:'General',memory:'Thread memory',workflow:'Workflow',schedule:'Schedules'})[section]),
    h('fieldset',{disabled:disabled||busy,className:'bc-form bc-fieldset'},
    section==='general'?h(React.Fragment,null,
    h(Field,{label:'Thread name',value:title,required:true,maxLength:180,onChange:e=>setTitle(e.target.value)}),
    h('label',{className:'bc-field'},h('span',null,'Instructions for Bees'),h('textarea',{value:instructions,rows:3,onChange:e=>setInstructions(e.target.value),placeholder:'How should Bees approach this work?'})),
    ):null,
    section==='memory'?h('label',{className:'bc-field'},h('span',null,'Remember in this thread · one note per line'),h('textarea',{value:memory,rows:3,onChange:e=>setMemory(e.target.value)})):null,
    section==='workflow'?h(React.Fragment,null,h('p',null,`${processName(stages)} · ${stages.map(stage=>stage.name).concat('Done').join(' → ')}`),h('strong',null,'Stages'),stages.map((stage,index)=>h('div',{key:index,className:'bc-actions'},h('input',{'aria-label':'Stage name',value:stage.name,required:true,onChange:e=>setStages(stages.map((s,i)=>i===index?{...s,name:e.target.value}:s))}),h('select',{'aria-label':'Stage type',value:stage.kind,onChange:e=>setStages(stages.map((s,i)=>i===index?{...s,kind:e.target.value}:s))},h('option',{value:'work'},'Work'),h('option',{value:'review'},'Independent review'),h('option',{value:'approval'},'Your approval')),h('button',{type:'button','aria-label':'Remove stage',disabled:stages.length===1,onClick:()=>setStages(stages.filter((_,i)=>i!==index))},icon('close')))),
    h('button',{type:'button',disabled:stages.length>=12,onClick:()=>setStages([...stages,{name:'Next step',kind:'work'}])},'Add stage')):null,
    section==='schedule'?h(React.Fragment,null,thread.schedule?.nextAt?h('p',{className:'bc-muted'},'Next run: '+new Date(thread.schedule.nextAt).toLocaleString()):null,thread.schedule?.error?h('p',{role:'status'},thread.schedule.error):null,
    h('label',{className:'bc-check'},h('input',{type:'checkbox',checked:scheduled,onChange:e=>setScheduled(e.target.checked)}),'Run on a schedule'),
    scheduled?h(React.Fragment,null,h(Field,{label:'What should Bees do each time?',value:recurrence.prompt,required:true,onChange:e=>update('prompt',e.target.value)}),h('select',{'aria-label':'Frequency',value:recurrence.frequency,onChange:e=>update('frequency',e.target.value)},['daily','weekly','monthly','hourly','advanced'].map(f=>h('option',{key:f,value:f},({hourly:'Interval',advanced:'Custom cron'})[f]??f))),
      recurrence.frequency==='hourly'?h(Field,{label:'Every (minutes)',type:'number',min:1,max:525600,value:recurrence.everyMinutes,onChange:e=>update('everyMinutes',Number(e.target.value))}):recurrence.frequency==='advanced'?h(Field,{label:'Five-field cron expression',value:recurrence.cronExpression,onChange:e=>update('cronExpression',e.target.value)}):h(Field,{label:'Time',type:'time',value:String(recurrence.hour??9).padStart(2,'0')+':'+String(recurrence.minute??0).padStart(2,'0'),onChange:e=>{const [hour,minute]=e.target.value.split(':').map(Number);setRecurrence({...recurrence,hour,minute});}}),
      recurrence.frequency==='weekly'?h('select',{'aria-label':'Day',value:recurrence.dayOfWeek,onChange:e=>update('dayOfWeek',Number(e.target.value))},['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d,i)=>h('option',{key:i,value:i},d))):null,
      recurrence.frequency==='monthly'?h(Field,{label:'Day of month',type:'number',min:1,max:31,value:recurrence.dayOfMonth,onChange:e=>update('dayOfMonth',Number(e.target.value))}):null,
      h(Field,{label:'Timezone',value:recurrence.timezone,onChange:e=>update('timezone',e.target.value)}),h('small',null,'Schedules run on the client that owns this thread, while it is running.')):null):null,
    h('button',{className:'bc-primary',type:'submit'},busy?'Saving…':'Save thread settings')));
}

function OrganizationsPanel({perform}){
  const [data,setData]=useState({organizations:[],invitations:[]}),[id,setId]=useState(''),[members,setMembers]=useState({members:[],clients:[]}),[name,setName]=useState(''),[email,setEmail]=useState('');
  const load=async()=>setData(await command('organizations'));useEffect(()=>{void perform(load);},[]);
  useEffect(()=>{let current=true;setMembers({members:[],clients:[]});if(id)void perform(async()=>{const next=await command('organizationMembers',null,{organizationId:id});if(current)setMembers(next);});return()=>{current=false;};},[id]);
  const admin=['owner','admin'].includes(data.organizations.find(o=>o.id===id)?.role);
  return h('section',{className:'bc-form'},h('h3',null,'Organizations'),h('p',{className:'bc-muted'},'Find colleagues and their clients. Thread invitations control access to work.'),
    data.invitations.map(i=>h('button',{key:i.id,onClick:()=>perform(async()=>{await command('acceptOrganization',null,{invitationId:i.id});await load();})},'Join invited organization')),
    h('div',{className:'bc-actions'},h('input',{'aria-label':'Organization name',placeholder:'Organization name',value:name,onChange:e=>setName(e.target.value)}),h('button',{disabled:!name.trim(),onClick:()=>perform(async()=>{const org=await command('createOrganization',null,{name});setName('');await load();setId(org.id);})},'Create')),
    data.organizations.length?h('select',{'aria-label':'Organization',value:id,onChange:e=>setId(e.target.value)},h('option',{value:''},'Choose an organization'),data.organizations.map(o=>h('option',{key:o.id,value:o.id},o.name))):null,
    id?members.members.map(m=>h('div',{key:m.user_id,className:'bc-person'},h('span',null,m.name??m.email),h('small',null,m.role),admin&&m.role!=='owner'?h('button',{onClick:()=>perform(async()=>{await command('removeOrganizationMember',null,{organizationId:id,userId:m.user_id});setMembers(await command('organizationMembers',null,{organizationId:id}));})},'Remove'):null)):null,
    id?members.clients.map(c=>h('small',{key:c.id},c.name+' · '+(Date.now()-Date.parse(c.last_seen_at)<30000?'Online':'Offline'))):null,
    id&&admin?h('div',{className:'bc-actions'},h('input',{'aria-label':'Invite colleague by email',type:'email',placeholder:'Colleague’s email',value:email,onChange:e=>setEmail(e.target.value)}),h('button',{disabled:!email,onClick:()=>perform(async()=>{await command('inviteOrganization',null,{organizationId:id,email});setEmail('');})},'Invite')):null);
}
