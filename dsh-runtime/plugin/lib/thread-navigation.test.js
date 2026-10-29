import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {configureRuntime} from '../client/runtime.js';
import {BeesNavigation,TeamMenu,TeamSection,SettingsScopePicker,TeamManagement} from '../client/thread-navigation.js';
import {SettingsPage,SettingsNav,ThreadDetails} from '../client/thread-panels.js';
import {TeamProcesses} from '../client/thread-processes.js';
import {OrganizationAppearance,OrganizationIcon,readOrganizationImage} from '../client/thread-organization-appearance.js';
import {ThreadApp} from '../client/thread-app.js';
import {ThreadWorkspace} from '../client/thread-layout.js';
import {ScheduleSettings} from '../client/thread-schedule-form.js';

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
function appHarness({snapshot,selected=null,thread=null},run){
  const previousWindow=globalThis.window,previousFrame=globalThis.requestAnimationFrame;
  globalThis.window={};globalThis.requestAnimationFrame=()=>{};
  const states=[snapshot,selected,thread];let index=0;
  configureRuntime(name=>({react:{...React,useState:initial=>{
    const key=index++;if(!(key in states))states[key]=typeof initial==='function'?initial():initial;
    return [states[key],value=>{states[key]=typeof value==='function'?value(states[key]):value;}];
  },useRef:value=>({current:value}),useEffect:()=>{}},'react-dom':{},'@deepseek-ai/dsh-client-ui-primitives':{}})[name],{hosted:true});
  const render=()=>{index=0;return nodes(ThreadApp({}));};
  try{run(render);}finally{
    configure(true);
    if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;
    if(previousFrame===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=previousFrame;
  }
}

test('thread rows omit decorative icons and team management is reachable in Settings',()=>{
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
    const team=page.props.groups.find(group=>group.title==='Team');
    const management=nodes(team.selector).find(node=>node.type===TeamManagement);
    assert(management);assert.deepEqual(management.props.hiddenTeams.map(team=>team.id),['hidden']);
    assert.equal(typeof management.props.onCreateTeam,'function');assert.equal(typeof management.props.onSelectTeam,'function');
  });
});

test('clicking a team name leaves settings for its welcome screen and organization settings omit the account dropdown',()=>{
  const snapshot={teams:[{id:'research',title:'Research'},{id:'design',title:'Design'}],threads:[],defaultTeamId:'research',organizations:[],accounts:[{id:'account',active:true,user:{email:'me@example.com'},organizations:[]}]};
  appHarness({snapshot},render=>{
    render().find(node=>node.type===BeesNavigation).props.onGlobal('ai');
    const settings=render(),page=settings.find(node=>node.type===SettingsPage);
    assert(page);
    const organization=page.props.groups.find(group=>group.title==='Organization');
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
    const thread={id:'thread',teamId:'research',title:'Weekly status',ownerClientId:'local',messages:[],runs:[],...state};
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
  assert(aside.includes('Settings → Team → Manage teams'));
});


test('team management keeps creation and hidden teams without an implicit team target',()=>{
  const markup=renderToStaticMarkup(React.createElement(TeamManagement,{icon:()=>null,hiddenTeams:[{id:'b',title:'Zulu hidden'},{id:'a',title:'Alpha hidden'}]}));
  for(const label of ['Manage teams','Create team','Hidden teams','Alpha hidden','Zulu hidden'])assert(markup.includes(label),label);
  assert.doesNotMatch(markup,/Team settings|Current team|Active/);
  assert(markup.indexOf('Alpha hidden')<markup.indexOf('Zulu hidden'));
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
