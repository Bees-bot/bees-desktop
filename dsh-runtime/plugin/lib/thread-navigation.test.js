import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {configureRuntime} from '../client/runtime.js';
import {BeesNavigation,TeamMenu,TeamSection,SettingsScopePicker} from '../client/thread-navigation.js';
import {SettingsPage,SettingsNav,ThreadDetails} from '../client/thread-panels.js';
import {TeamProcesses} from '../client/thread-processes.js';
import {OrganizationAppearance,OrganizationIcon,readOrganizationImage} from '../client/thread-organization-appearance.js';
import {ThreadApp} from '../client/thread-app.js';
import {ThreadWorkspace} from '../client/thread-layout.js';
import {ScheduleSettings} from '../client/thread-schedule-form.js';
import {RootFolderSettings} from '../client/thread-folders.js';

const configure=hosted=>configureRuntime(name=>({react:React,'react-dom':{},'@deepseek-ai/dsh-client-ui-primitives':{},'@bees/dsh-custom-ai':{},'@bees/dsh-subscriptions':{}})[name],{hosted});
configure(true);

test('desktop keeps local work visible and selectable beside signed-in organizations',()=>{
  configure(false);
  try{
    const calls=[],props={icon:()=>null,theme:{},localActive:true,organizationId:'work',onOrganization:(...args)=>calls.push(args),accounts:[{id:'alice',active:true,user:{email:'alice@example.com'},organizations:[{id:'work',name:'Studio'}]}]};
    const tree=BeesNavigation(props),local=tree.props.children[1].props.children[0];
    assert.equal(local.props.title,'Local Org');assert.equal(local.props['aria-current'],undefined);
    local.props.onClick();assert.deepEqual(calls,[[null,null]]);
    const markup=renderToStaticMarkup(tree);
    assert(markup.indexOf('Local Org')<markup.indexOf('alice@example.com'));assert(markup.includes('Studio'));assert(!markup.includes('Local threads'));
    assert.match(markup,/aria-label="Add organization"/);
    const signedInLocal=renderToStaticMarkup(React.createElement(BeesNavigation,{...props,organizationId:null}));
    assert.match(signedInLocal,/title="Local Org"[^>]*aria-current="page"/);assert.equal((signedInLocal.match(/aria-current="page"/g)??[]).length,1);
    const active=renderToStaticMarkup(React.createElement(BeesNavigation,{...props,organizationId:null,accounts:props.accounts.map(account=>({...account,active:false}))}));
    assert.match(active,/title="Local Org"[^>]*aria-current="page"/);assert(active.includes('Studio'));
    const selectedLocal=BeesNavigation({...props,organizationId:null}).props.children[1].props.children[0];
    selectedLocal.props.onClick();assert.deepEqual(calls,[[null,null],[null,null]],'Local Org remains clickable when returning from settings');
    assert.equal(BeesNavigation({...props,busy:true}).props.children[1].props.children[0].props.disabled,true);
    configure(true);
    assert(!renderToStaticMarkup(React.createElement(BeesNavigation,props)).includes('Local Org'));
  }finally{configure(true);}
});

test('orgs form one alphabetical list with email labels and no personal account menu',()=>{
  const icon=name=>React.createElement('svg',{'data-icon':name});
  const accounts=[
    {id:'alice',user:{email:'alice@example.com'},active:true,organizations:[{id:'work',name:'Studio',appearance:{icon:'star',color:'#7c3aed'}},{id:'zulu',name:'Zulu'}]},
    {id:'bob',user:{email:'bob@example.com'},organizations:[{id:'work',name:'Studio'},{id:'alpha',name:'alpha'}]},
  ];
  const props={icon,theme:{},organizationId:'work',accounts};
  const markup=renderToStaticMarkup(React.createElement(BeesNavigation,props));
  const titles=[...markup.matchAll(/class="bc-rail-action" title="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(titles,['alpha (bob@example.com)','Studio (alice@example.com)','Studio (bob@example.com)','Zulu (alice@example.com)']);
  for(const title of titles)assert(markup.includes(`class="bc-rail-label">${title}</span>`));
  assert.match(markup,/aria-label="Studio \(alice@example.com\)"[^>]*aria-current="page"/);
  assert.doesNotMatch(markup,/aria-label="Studio \(bob@example.com\)" aria-current/);
  assert.match(markup,/aria-label="Add organization"/);
  assert.doesNotMatch(markup,/Personal threads|Threads outside your organizations|bc-account-switcher|bc-account-orgs/);
  assert.match(markup,/background:#7c3aed;color:#ffffff/);assert.match(markup,/data-icon="star"/);
  assert.doesNotMatch(markup,/Team settings|bc-team-switcher|Hidden teams|New Goal|New Chat|Personal \(/);
  const calls=[],orgs=BeesNavigation({...props,onOrganization:(...args)=>calls.push(args)}).props.children[1].props.children[1];
  orgs[2].props.children.props.onClick();assert.deepEqual(calls,[['work','bob']],'Duplicate org names still select the right account');
});

test('additional local orgs use the org picker without becoming accounts or hiding the built-in org',()=>{
  configure(false);
  try{
    const calls=[],localOrganizations=[{id:'studio',name:'Studio',local:true,appearance:{icon:'star',color:'#7c3aed'}},{id:'research',name:'Research',local:true}];
    const props={icon:name=>React.createElement('svg',{'data-icon':name}),theme:{},localActive:true,organizationId:'studio',localOrganizations,onOrganization:(...args)=>calls.push(args),accounts:[{id:'alice',user:{email:'alice@example.com'},organizations:[{id:'work',name:'Work'}]}]};
    const markup=renderToStaticMarkup(React.createElement(BeesNavigation,props));
    assert.match(markup,/title="Studio \(Local\)"[^>]*aria-current="page"/);assert.equal((markup.match(/aria-current="page"/g)??[]).length,1);
    for(const label of ['Local Org','Research (Local)','Work (alice@example.com)'])assert(markup.includes(label));
    assert.match(markup,/background:#7c3aed;color:#ffffff/);
    const rows=BeesNavigation(props).props.children[1].props.children[1];
    rows[0].props.children.props.onClick();assert.deepEqual(calls,[['research',null]]);
    const signedIn=renderToStaticMarkup(React.createElement(BeesNavigation,{...props,localActive:false}));assert.doesNotMatch(signedIn,/aria-current="page"/);
    configure(true);assert(!renderToStaticMarkup(React.createElement(BeesNavigation,props)).includes('(Local)'));
  }finally{configure(true);}
});

test('hosted org labels use the signed-in email when there is no desktop account list',()=>{
  const markup=renderToStaticMarkup(React.createElement(BeesNavigation,{icon:()=>null,theme:{},user:{email:'alice@example.com'},organizations:[{id:'org',name:'Studio'}],organizationId:'org'}));
  assert(markup.includes('Studio (alice@example.com)'));assert(!markup.includes('Local Org'));
  assert.match(markup,/aria-label="Studio \(alice@example.com\)"[^>]*aria-current="page"/);
});

test('each team menu keeps administration and secondary chat creation',()=>{
  const menu=renderToStaticMarkup(React.createElement(TeamMenu,{team:{id:'team',title:'Research'},icon:()=>null}));
  for(const label of ['Research menu','Processes','Agents','Schedules','Files &amp; folders','Add-ons','Settings','Hide','New chat'])assert(menu.includes(label),label);
  assert.doesNotMatch(menu,/New Goal|New thread/);
  const calls=[],tree=TeamMenu({team:{id:'research',title:'Research'},icon:()=>null,onSettings:(...args)=>calls.push(args)});
  for(const button of tree.props.children[1].props.children.slice(0,5))button.props.onClick({currentTarget:{closest:()=>({open:true})}});
  assert.deepEqual(calls,[['processes','research'],['agents','research'],['schedule','research'],['folders','research'],['addons','research']]);
  const page=renderToStaticMarkup(React.createElement(SettingsPage,{title:'Team settings',items:[['processes','Processes']],selected:'processes'},'Process editor'));
  assert.match(page,/<section[^>]*class="bc-settings-page"/);assert(page.includes('Process editor'));assert.doesNotMatch(page,/<dialog|aria-modal/);
});


test('logo is inert, menu actions have icons, and bottom controls use the requested order',()=>{
  const icons=[];
  const icon=(name,props)=>{icons.push(name);return React.createElement('svg',{'data-icon':name,'aria-hidden':true,...props});};
  const markup=renderToStaticMarkup(React.createElement(BeesNavigation,{brandMark:'/brand.png',icon,accounts:[{id:'alice',active:true,user:{email:'alice@example.com'},organizations:[]},{id:'bob',user:{email:'bob@example.com'},organizations:[]}],theme:{dark:true},teams:[{id:'only',title:'Default'}]}));
  assert.match(markup,/<div class="bc-brand" title="Bees"><img src="\/brand.png" alt="Bees"\/><\/div>/);
  assert(markup.indexOf('class="bc-brand"')<markup.indexOf('class="bc-rail-organizations"'));
  assert.match(markup,/class="bc-account-count">2<\/small>/);
  assert.doesNotMatch(markup,/bc-avatar|Hidden teams/);
  const bottom=markup.slice(markup.indexOf('class="bc-rail-bottom"'));
  const labels=['Switch to light theme','Settings','Account settings'];
  for(let i=1;i<labels.length;i++)assert(bottom.indexOf(labels[i-1])<bottom.indexOf(labels[i]),labels[i]);
  assert.match(markup,/data-icon="plus"/);
  for(const name of ['accounts','settings','sun'])assert(icons.includes(name),name);
});

test('every team has a collapsible heading and one clear creation action',()=>{
  const render=expanded=>renderToStaticMarkup(React.createElement(TeamSection,{team:{id:'default',title:'Default'},expanded,menu:React.createElement('button',null,'Team menu')},'A thread'));
  const expanded=render(true);
  for(const label of ['Collapse Default','New thread in Default','Team menu','A thread'])assert(expanded.includes(label),label);
  assert.match(expanded,/aria-expanded="true"/);
  assert.match(expanded,/class="bc-team-name" title="New thread in Default">Default<\/button>/);
  assert.equal((expanded.match(/<button/g)??[]).length,3,'Only expand, team name and team menu remain');
  assert.doesNotMatch(expanded,/Active|active|<small|New Goal|>New thread|>New chat/);
  const collapsed=render(false);
  assert.match(collapsed,/aria-label="Expand Default"[^>]*aria-expanded="false"/);assert(!collapsed.includes('A thread'));
  assert(collapsed.includes('New thread in Default'));
});

test('team controls toggle independently and open the team welcome screen',()=>{
  const calls=[],props={team:{id:'research',title:'Research'},expanded:true,onToggle:()=>calls.push('toggle'),onOpen:()=>calls.push('open')};
  const buttons=TeamSection(props).props.children[0].props.children;
  buttons[0].props.onClick();assert.deepEqual(calls,['toggle']);
  buttons[1].props.onClick();
  assert.deepEqual(calls,['toggle','open']);
});

test('secondary chat creation keeps its team target and creation permissions',()=>{
  const calls=[],props={team:{id:'research',title:'Research'},icon:()=>null,canCreate:true,onCreate:(...args)=>calls.push(args)};
  const chat=TeamMenu(props).props.children[1].props.children.find(node=>node?.props?.children?.includes('New chat'));
  const menu={open:true};chat.props.onClick({currentTarget:{closest:()=>menu}});
  assert.deepEqual(calls,[['chat','research']]);assert.equal(menu.open,false);
  for(const state of [{canCreate:false},{busy:true}]){
    const disabled=TeamMenu({...props,...state}).props.children[1].props.children.find(node=>node?.props?.children?.includes('New chat'));
    assert.equal(disabled.props.disabled,true);
  }
});

const nodes=node=>!React.isValidElement(node)?[]:[node,...React.Children.toArray(node.props.children).flatMap(nodes)];
function appHarness({snapshot,selected=null,thread=null,settingsSnapshot=snapshot,settingsTeam=null,settingsAccountId,hosted=true},run){
  const previousWindow=globalThis.window,previousFrame=globalThis.requestAnimationFrame;
  globalThis.window={};globalThis.requestAnimationFrame=()=>{};
  const states=[snapshot,selected,thread];let index=0;
  states[10]=settingsAccountId;states[13]=settingsSnapshot;states[14]=settingsTeam;
  configureRuntime(name=>({react:{...React,useState:initial=>{
    const key=index++;if(!(key in states))states[key]=typeof initial==='function'?initial():initial;
    return [states[key],value=>{states[key]=typeof value==='function'?value(states[key]):value;}];
  },useRef:value=>({current:value}),useEffect:()=>{}},'react-dom':{},'@deepseek-ai/dsh-client-ui-primitives':{},'@bees/dsh-custom-ai':{},'@bees/dsh-subscriptions':{}})[name],{hosted});
  const render=()=>{index=0;return nodes(ThreadApp({}));};
  const renderPanel=(element,data)=>{index=100;if(data)states[100]=data;return nodes(element.type(element.props));};
  try{run(render,renderPanel);}finally{
    configure(true);
    if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;
    if(previousFrame===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=previousFrame;
  }
}

test('local org settings create without sign-in and keep the built-in teams separate',()=>{
  const org={id:'studio',name:'Studio',role:'owner',local:true};
  const snapshot={teams:[{id:'default',title:'Default'},{id:'studio-team',title:'Studio team',organizationId:org.id}],threads:[],organizations:[org],localOrganizations:[org],settings:{selectedOrganizationId:org.id},localActive:true};
  appHarness({snapshot,hosted:false},(render,renderPanel)=>{
    let tree=render();assert.deepEqual(tree.filter(node=>node.type===TeamSection).map(node=>node.props.team.id),['studio-team']);
    tree.find(node=>node.type===BeesNavigation).props.onGlobal('organizations');
    tree=render();let page=tree.find(node=>node.type===SettingsPage),group=page.props.groups.find(group=>group.title==='Organizations');
    assert.deepEqual(group.selector.props.rows.map(row=>row.title),['Local Org','Studio (Local)']);
    let panel=tree.find(node=>node.type.name==='OrganizationsPanel');assert.equal(panel.props.local,true);assert.equal(panel.props.organizationId,'studio');
    const created=[];
    panel={...panel,props:{...panel.props,onCreateLocal:async name=>{created.push(name);}}};
    let content=renderPanel(panel);assert(content.some(node=>node.type==='button'&&node.props.children==='Create local organization'));
    assert(!content.some(node=>node.props['aria-label']==='Invite colleague by email'));
    content.find(node=>node.props['aria-label']==='Organization name').props.onChange({target:{value:' Personal '}});
    content=renderPanel(panel);content.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});assert.deepEqual(created,['Personal']);
    group.selector.props.onSelect('local');
    tree=render();panel=tree.find(node=>node.type.name==='OrganizationsPanel');assert.equal(panel.props.organizationId,null);
    page=tree.find(node=>node.type===SettingsPage);assert.deepEqual(page.props.groups.find(group=>group.title==='Teams').selector.props.rows.map(row=>row.id),['default']);
  });
});

test('switching from team General between built-in and named local orgs keeps widget keys distinct',()=>{
  const org={id:'localorg2',name:'localorg2',role:'owner',local:true},team={id:'default',title:'Default',ownerClientId:'local'};
  const snapshot={clientId:'local',teams:[team],threads:[],organizations:[org],localOrganizations:[org],localActive:true,settings:{}};
  appHarness({snapshot,settingsTeam:team,hosted:false},(render,renderPanel)=>{
    render().find(node=>node.type===BeesNavigation).props.onGlobal('ai');
    let page=render().find(node=>node.type===SettingsPage);
    page.props.groups.find(group=>group.title==='Teams').selector.props.onSelect(team.id);
    page=render().find(node=>node.type===SettingsPage);page.props.onSelect('general','team');
    for(let i=0;i<20;i++)for(const id of [':localorg2','local']){
      render().find(node=>node.type===SettingsPage).props.groups.find(group=>group.title==='Organizations').selector.props.onSelect(id);
      const panel=render().find(node=>node.type.name==='OrganizationsPanel'),content=renderPanel(panel,{organizations:[org],invitations:[]});
      const widgets=content.filter(node=>[OrganizationAppearance,RootFolderSettings].includes(node.type));
      assert.equal(widgets.length,id==='local'?0:2);
      assert.equal(new Set(widgets.map(node=>node.key)).size,widgets.length,'Sibling widgets must have distinct keys so React removes the previous organization correctly');
      assert.equal(panel.props.organizationId,id==='local'?null:org.id);
      assert(widgets.every(node=>node.props.organization.id===org.id));
    }
  });
});

test('creating a local org from signed-in settings selects it in the main view',async t=>{
  const previousFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=previousFetch;});
  const org={id:'local-studio',name:'Private studio',local:true,role:'owner'},requests=[];
  const snapshot={teams:[],threads:[],organizations:[],accounts:[{id:'alice',active:true,user:{email:'alice@example.com'}}]};
  globalThis.fetch=async(_url,options)=>{
    const input=options?.body?JSON.parse(options.body):null;requests.push(input);
    return {ok:true,json:async()=>input?.action==='createLocalOrganization'?org:input?{}:{...snapshot,localActive:true,localOrganizations:[org],organizations:[org],accounts:[]}};
  };
  let pending;
  appHarness({snapshot,settingsAccountId:'alice',hosted:false},(render,renderPanel)=>{
    render().find(node=>node.type===BeesNavigation).props.onGlobal('organizations');
    const panel=render().find(node=>node.type.name==='OrganizationsPanel');assert.equal(panel.props.local,false);
    assert(renderPanel(panel).some(node=>node.type==='input'&&node.props.type==='checkbox'&&node.props.checked===false));
    pending=panel.props.onCreateLocal('Private studio');
  });
  await pending;
  assert.equal(requests[0].action,'createLocalOrganization');assert.equal(requests[0].name,'Private studio');assert.equal(requests[0].settingsAccountId,undefined);
  assert.equal(requests[1].action,'selectOrganization');assert.equal(requests[1].accountId,null);assert.equal(requests[1].organizationId,org.id);assert.equal(requests[2],null);
});

test('Add team uses the local org chosen in Settings while a different account is active',async t=>{
  const previousFetch=globalThis.fetch,previousDocument=globalThis.document,previousDialog=globalThis.HTMLDialogElement;
  t.after(()=>{globalThis.fetch=previousFetch;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;if(previousDialog===undefined)delete globalThis.HTMLDialogElement;else globalThis.HTMLDialogElement=previousDialog;});
  const requests=[],elements=[];
  globalThis.HTMLDialogElement={prototype:{closedBy:true}};
  globalThis.document={querySelector:()=>null,createElement:tag=>{
    const element={tag,listeners:{},append(){},setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn;},remove(){}};elements.push(element);return element;
  },body:{append:dialog=>queueMicrotask(()=>{elements.find(element=>element.tag==='input').value='Research';dialog.returnValue='ok';dialog.listeners.close();})}};
  const org={id:'studio',name:'Studio',local:true},localSnapshot={teams:[],threads:[],organizations:[org]};
  const snapshot={...localSnapshot,localOrganizations:[org],accounts:[{id:'alice',active:true,user:{email:'alice@example.com'},organizations:[]}]};
  globalThis.fetch=async(_url,options)=>{const input=options?.body?JSON.parse(options.body):null;requests.push(input);return {ok:true,json:async()=>input?.action==='createTeam'?{id:'new-team'}:input?{}:snapshot};};
  let pending;
  appHarness({snapshot,settingsSnapshot:localSnapshot,settingsAccountId:null,hosted:false},render=>{
    render().find(node=>node.type===BeesNavigation).props.onGlobal('ai');
    let groups=render().find(node=>node.type===SettingsPage).props.groups;
    groups.find(group=>group.title==='Organizations').selector.props.onSelect(':studio');
    groups=render().find(node=>node.type===SettingsPage).props.groups;
    pending=groups.find(group=>group.title==='Teams').extra.props.onClick();
  });
  await pending;
  assert.equal(requests[0].action,'createTeam');assert.equal(requests[0].settingsAccountId,null);assert.equal(requests[0].organizationId,'studio');assert.equal(requests[0].name,'Research');
  assert.equal(requests[1].action,'selectOrganization');assert.equal(requests[1].accountId,null);assert.equal(requests[1].organizationId,'studio');assert.equal(requests[2],null);
});

test('thread rows omit decorative icons and Settings lists all teams without a hidden teams menu',()=>{
  const thread={id:'thread',teamId:'research',title:'Weekly status',preview:'Current progress',ownerClientId:'local',runs:[{status:'running'}]};
  const snapshot={clientId:'local',teams:[{id:'research',title:'Research'},{id:'frozen',title:'Frozen',frozen:true},{id:'hidden',title:'Hidden'}],threads:[thread],organizations:[],settings:{hiddenTeamIds:['hidden']}};
  appHarness({snapshot,selected:thread.id},render=>{
    const tree=render(),row=tree.find(node=>node.props.className==='bc-thread-row active');
    assert(row);assert(!nodes(row).some(node=>node.props.className==='bc-thread-symbol'));
    assert(nodes(row).some(node=>node.props.className==='bc-thread-copy'));
    assert(nodes(row).some(node=>node.props.title==='Running'));
    assert(!nodes(row).some(node=>node.type==='details'||node.type==='summary'));
    for(const section of tree.filter(node=>node.type===TeamSection)){
      assert.equal(section.props.menu.props.canCreate,section.props.team.id!=='frozen');
    }
    tree.find(node=>node.type===BeesNavigation).props.onGlobal('ai');
    const page=render().find(node=>node.type===SettingsPage);
    const team=page.props.groups.find(group=>group.title==='Teams');
    assert.equal(team.selector.type,SettingsScopePicker);
    assert.deepEqual(team.selector.props.rows.map(team=>team.id),['research','frozen','hidden']);
    assert.doesNotMatch(renderToStaticMarkup(team.selector),/Hidden teams|<details/);
    assert.equal(team.extra.props['aria-label'],'Add team');assert.equal(team.extra.props.title,'Add team');
    assert.equal(team.extra.props.disabled,false);assert.equal(typeof team.extra.props.onClick,'function');
    const nav=SettingsNav({groups:page.props.groups});
    for(const label of ['Add team','Add organization'])assert(nodes(nav).some(node=>node.props.className==='bc-settings-group-header'&&nodes(node).some(child=>child.props['aria-label']===label)));
    const organization=page.props.groups.find(group=>group.title==='Organizations');
    assert.equal(organization.extra.props.title,'Add organization');assert.equal(organization.extra.props.disabled,false);
    organization.extra.props.onClick();
    assert.equal(render().find(node=>node.type===SettingsPage).props.selected,'organizations');
    assert(render().some(node=>node.type==='button'&&node.props.children==='Sign in to manage shared organizations'));
  });
});

test('General hides and unhides teams for the configured account, including read-only teams',async t=>{
  const previousFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=previousFetch;});
  for(const hidden of [false,true]){
    const snapshot={teams:[],threads:[],organizations:[],accounts:[{id:'active',active:true,user:{email:'active@example.com'}}],settings:{hiddenTeamIds:['active-hidden']}};
    const team={id:'research',title:'Research',ownerClientId:'someone-else',frozen:true};
    const settingsSnapshot={clientId:'viewer',teams:[team],threads:[],organizations:[],settings:{hiddenTeamIds:['other-hidden',...hidden?['research']:[]]}};
    const requests=[];
    globalThis.fetch=async(_url,options)=>{
      const input=options?.body?JSON.parse(options.body):null;requests.push(input);
      return {ok:true,json:async()=>input?.action==='settingsSnapshot'?settingsSnapshot:input?{}:snapshot};
    };
    let pending;
    appHarness({snapshot,settingsSnapshot,settingsTeam:team,settingsAccountId:'configured'},render=>{
      render().find(node=>node.type===BeesNavigation).props.onGlobal('ai');
      const group=render().find(node=>node.type===SettingsPage).props.groups.find(group=>group.title==='Teams');
      group.selector.props.onSelect('research');
      const tree=render(),toggle=tree.find(node=>node.props.role==='switch');
      assert(toggle,'Team General offers a personal visibility toggle even for a read-only team');
      assert.equal(toggle.props['aria-label'],'Hide team from sidebar');
      assert.equal(toggle.props['aria-checked'],hidden);assert.equal(toggle.props.children,hidden?'Unhide':'Hide');
      assert.equal(toggle.props.disabled,false);
      pending=toggle.props.onClick();
      assert.equal(render().find(node=>node.props.role==='switch').props.disabled,true);
    });
    await pending;
    assert.deepEqual(requests[0],{action:'preferences',threadId:null,operationId:requests[0].operationId,settingsAccountId:'configured',values:{hiddenTeamIds:hidden?['other-hidden']:['other-hidden','research']}});
    assert.equal(requests[1].action,'settingsSnapshot');assert.equal(requests[1].settingsAccountId,'configured');
    assert.equal(requests[2],null,'The sidebar refreshes after saving');
  }
});

test('clicking a team name leaves settings for its welcome screen and organization settings omit the account dropdown',()=>{
  const snapshot={teams:[{id:'research',title:'Research'},{id:'design',title:'Design'}],threads:[],defaultTeamId:'research',organizations:[],accounts:[{id:'account',active:true,user:{email:'me@example.com'},organizations:[]}]};
  appHarness({snapshot},render=>{
    render().find(node=>node.type===BeesNavigation).props.onGlobal('ai');
    const settings=render(),page=settings.find(node=>node.type===SettingsPage);
    assert(page);
    const organization=page.props.groups.find(group=>group.title==='Organizations');
    assert.equal(organization.selector.type,SettingsScopePicker);
    assert(!nodes(organization.selector).some(node=>node.type==='select'));
    settings.find(node=>node.type===TeamSection&&node.props.team.id==='design').props.onOpen();
    const welcome=render();assert(!welcome.some(node=>node.type===SettingsPage));
    assert(welcome.some(node=>node.type==='h2'&&node.props.children==='What would you like to get done?'));
    assert(welcome.some(node=>node.type==='p'&&node.props.children==='Start a goal in Design. Add files and people as you go.'));
  });
});

test('a thread schedule uses its own document without waiting for team settings',()=>{
  const thread={id:'thread',teamId:'research',title:'Weekly status',ownerClientId:'local',messages:[],runs:[]};
  appHarness({snapshot:{clientId:'local',teams:[{id:'research',title:'Research'}],threads:[thread],organizations:[]},selected:thread.id,thread},render=>{
    const workspace=render().find(node=>node.type===ThreadWorkspace);
    const schedule=nodes(workspace.props.renderWidget('schedule')).find(node=>node.type===ScheduleSettings);
    assert.equal(schedule.props.thread,thread);assert.equal(schedule.props.disabled,false);assert.equal(typeof schedule.props.onSave,'function');
  });
});

test('thread Settings reuses General and Transfer in the workspace with existing permissions',()=>{
  for(const state of [{},{runs:[{status:'running'}]},{frozen:true},{ownerClientId:'other'}]){
    const thread={id:'thread',teamId:'research',title:'Weekly status',instructions:'Cite sources.',ownerClientId:'local',messages:[],runs:[],...state};
    appHarness({snapshot:{clientId:'local',teams:[{id:'research',title:'Research'}],threads:[thread],organizations:[]},selected:thread.id,thread},render=>{
      const tree=render(),workspace=tree.find(node=>node.type===ThreadWorkspace);
      assert(!tree.some(node=>node.type==='button'&&node.props['aria-label']==='Thread settings'));
      const settings=nodes(workspace.props.renderWidget('settings'));
      const general=settings.find(node=>node.props.scope==='thread'&&node.props.section==='general');
      assert(general);assert.equal(general.props.thread,thread);
      assert.equal(general.props.disabled,!!state.frozen||state.ownerClientId==='other');
      assert.equal(general.props.canDelete,thread.ownerClientId==='local'&&!thread.runs.some(run=>run.status==='running'));
      assert.equal(typeof general.props.onDelete,'function');
      const details=nodes(workspace.props.renderWidget('details')).find(node=>node.type===ThreadDetails);
      const instructions=nodes(workspace.props.renderWidget('context')).find(node=>node.type===ThreadDetails);
      assert(instructions.key.endsWith(thread.id));
      assert.equal(instructions.props.thread.instructions,thread.instructions);
      assert.equal(instructions.props.canConfigure,!general.props.disabled);
      assert.equal(instructions.props.onSave,general.props.onSave);
      details.props.onSettings('transfer');
      const next=render().find(node=>node.type===ThreadWorkspace);
      assert.equal(next.props.navigation.id,'settings');
      const transfer=nodes(next.props.renderWidget('settings'));
      assert.equal(transfer.find(node=>node.type===SettingsNav).props.selected,'transfer');
      assert(transfer.some(node=>node.type==='h3'&&node.props.children==='Transfer thread'));
    });
  }
});


test('organization buttons select directly, without submenus, and the plus opens creation',()=>{
  const calls=[],props={icon:()=>null,theme:{},onGlobal:section=>calls.push(section),accounts:[{id:'a',active:true,user:{email:'a@example.com'},organizations:[{id:'org',name:'Studio'}]}]};
  const tree=BeesNavigation(props),markup=renderToStaticMarkup(tree);
  assert.doesNotMatch(markup,/aria-haspopup|aria-expanded|Open Studio|bc-brand-menu/);
  tree.props.children[1].props.children[2].props.onClick();assert.deepEqual(calls,['organizations']);
});

test('settings scope icons show organization appearance and team initials with hover names',()=>{
  const calls=[],props={label:'Teams to configure',rows:[{id:'a',title:'Alpha'},{id:'b',title:'Beta'}],selected:'b',onSelect:id=>calls.push(id)};
  const tree=SettingsScopePicker(props),markup=renderToStaticMarkup(tree);
  assert.match(markup,/title="Alpha" aria-label="Alpha" aria-pressed="false"/);
  assert.match(markup,/title="Beta" aria-label="Beta" aria-pressed="true"/);
  assert.match(markup,/>A<\/span>/);assert.match(markup,/>B<\/span>/);
  tree.props.children[0].props.onClick();assert.deepEqual(calls,['a']);
  const org=renderToStaticMarkup(React.createElement(SettingsScopePicker,{...props,icon:()=>null,rows:[{id:'org',title:'Studio',organization:{appearance:{icon:'star',color:'#7c3aed'}}}]}));
  assert.match(org,/bc-org-symbol/);assert.match(org,/background:#7c3aed/);
});


test('thread pane starts with search without a global overflow menu',t=>{
  const prior=globalThis.window;globalThis.window={};
  t.after(()=>{if(prior===undefined)delete globalThis.window;else globalThis.window=prior;});
  const markup=renderToStaticMarkup(React.createElement(ThreadApp,{}));
  const aside=markup.slice(markup.indexOf('<aside'),markup.indexOf('</aside>'));
  assert.match(aside,/<aside[^>]*><div class="bc-sidebar-tools"><div class="bc-search">/);
  assert.doesNotMatch(aside,/bc-team-management|<details/);
  assert.doesNotMatch(aside,/bc-thread-create|bc-team-bar|New Goal|New Chat|Current team/);
  const rail=markup.slice(markup.indexOf('aria-label="Main navigation"'),markup.indexOf('<aside'));
  assert.doesNotMatch(rail,/New Goal|New Chat|Team settings|Manage teams/);
  assert(aside.includes('Create a team with the + next to Teams in Settings.'));
});


test('Org settings offer a preview, icon choices, preset colors and a custom color',()=>{
  const markup=renderToStaticMarkup(React.createElement(OrganizationAppearance,{organization:{id:'org',name:'Studio',appearance:{icon:'star',color:'#7c3aed'}},icon:name=>React.createElement('svg',{'data-icon':name})}));
  for(const label of ['Star icon','Building icon','Violet icon color','Custom icon color','Upload your own icon','Save icon'])assert(markup.includes(label),label);
  assert.match(markup,/aria-label="Star icon" aria-pressed="true"/);
  assert.match(markup,/aria-label="Violet icon color" aria-pressed="true"/);
  assert.match(markup,/type="color"/);assert.match(markup,/background:#7c3aed/);
});


test('uploaded icons render as images and can be removed',()=>{
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const organization={id:'org',name:'Studio',appearance:{icon:'star',color:'#7c3aed',image}};
  const markup=renderToStaticMarkup(React.createElement(OrganizationAppearance,{organization,icon:()=>null}));
  assert(markup.includes(`<img src="${image}" alt=""/>`));assert(markup.includes('Remove uploaded icon'));
  assert.match(markup,/type="file" accept="image\/png,image\/jpeg,image\/webp,image\/gif"/);
  assert.doesNotMatch(markup,/aria-label="Star icon" aria-pressed="true"/);
  const invalid=renderToStaticMarkup(React.createElement(OrganizationIcon,{organization:{appearance:{...organization.appearance,image:'https://example.test/icon.png'}},icon:()=>React.createElement('svg')}));
  assert.equal(invalid,'<svg></svg>');
});

test('icon uploads reject unsupported and oversized files and resize to a small PNG',async()=>{
  await assert.rejects(readOrganizationImage({type:'image/svg+xml',size:1}),/PNG, JPEG/);
  await assert.rejects(readOrganizationImage({type:'image/png',size:5_000_001}),/5 MB/);
  const previousBitmap=globalThis.createImageBitmap,previousDocument=globalThis.document;
  let closed=false,drawn;
  const bitmap={width:512,height:256,close:()=>closed=true},canvas={getContext:()=>({drawImage:(...args)=>drawn=args}),toDataURL:type=>type};
  globalThis.createImageBitmap=async()=>bitmap;globalThis.document={createElement:()=>canvas};
  try{
    assert.equal(await readOrganizationImage({type:'image/png',size:500}),'image/png');
    assert.equal(canvas.width,128);assert.equal(canvas.height,64);assert.equal(closed,true);assert.deepEqual(drawn,[bitmap,0,0,128,64]);
    globalThis.createImageBitmap=async()=>{throw Error('Invalid image');};
    await assert.rejects(readOrganizationImage({type:'image/png',size:500}),/Invalid image/);
  }finally{
    if(previousBitmap===undefined)delete globalThis.createImageBitmap;else globalThis.createImageBitmap=previousBitmap;
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
  }
});


test('grouped settings keep team navigation and process import/export beside the default editor',()=>{
  const page=renderToStaticMarkup(React.createElement(SettingsPage,{title:'Settings',groups:[{title:'Team',scope:'team',items:[['processes','Processes']]}],selected:'processes'},'Process editor'));
  assert.match(page,/bc-settings-nav-group/);
  assert.match(page,/aria-current="page"[^>]*>Processes/);
  const processes=renderToStaticMarkup(React.createElement(TeamProcesses,{team:{processes:[]},canManage:true,canCreate:true}));
  for(const label of ['Customize default','Export','Import process','Create process'])assert(processes.includes(label),label);
});


test('settings Escape closes once and leaves fields and handled events alone',()=>{
  const previousDocument=globalThis.document,previousWindow=globalThis.window;
  const listeners=new Set(),cleanup=[];let closed=0;
  const target={addEventListener:(_name,fn)=>listeners.add(fn),removeEventListener:(_name,fn)=>listeners.delete(fn)};
  globalThis.document=target;globalThis.window=target;
  configureRuntime(name=>({react:{...React,useEffect:fn=>cleanup.push(fn())},'react-dom':{},'@deepseek-ai/dsh-client-ui-primitives':{}})[name],{hosted:true});
  try{
    SettingsPage({title:'Settings',onClose:()=>closed++});
    const press=event=>{for(const listener of listeners)listener({key:'Escape',target:{closest:()=>null},...event});};
    press({target:{closest:()=>({})}});assert.equal(closed,0,'fields and open dialogs keep Escape');
    press({defaultPrevented:true});assert.equal(closed,0,'handled events stay handled');
    press({});assert.equal(closed,1);
  }finally{
    for(const dispose of cleanup)dispose?.();
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
    if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;
    configure(true);
  }
  assert.equal(listeners.size,0);
});
