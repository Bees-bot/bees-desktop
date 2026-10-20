import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {configureRuntime} from '../client/runtime.js';
import {BeesNavigation,TeamMenu,TeamSection,HoverMenu,TeamManagement} from '../client/thread-navigation.js';
import {SettingsPage} from '../client/thread-panels.js';
import {OrganizationAppearance,OrganizationIcon,readOrganizationImage} from '../client/thread-organization-appearance.js';
import {ThreadApp} from '../client/thread-app.js';

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
    assert.equal((markup.match(/class="bc-rail-action bc-create-org"/g)??[]).length,1);
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
  assert.equal((markup.match(/class="bc-rail-action bc-create-org"/g)??[]).length,2);
  assert.doesNotMatch(markup,/Personal threads|Threads outside your organizations|bc-account-switcher|bc-account-orgs/);
  assert.match(markup,/background:#7c3aed;color:#ffffff/);assert.match(markup,/data-icon="star"/);
  assert.doesNotMatch(markup,/Team settings|bc-team-switcher|Hidden teams|New Goal|New Chat|Personal \(/);
  const calls=[],orgs=BeesNavigation({...props,onOrganization:(...args)=>calls.push(args)}).props.children[1].props.children[1];
  orgs[2].props.onSelect();assert.deepEqual(calls,[['work','bob']],'Duplicate org names still select the right account');
});

test('hosted org labels use the signed-in email when there is no desktop account list',()=>{
  const markup=renderToStaticMarkup(React.createElement(BeesNavigation,{icon:()=>null,theme:{},user:{email:'alice@example.com'},organizations:[{id:'org',name:'Studio'}],organizationId:'org'}));
  assert(markup.includes('Studio (alice@example.com)'));assert(!markup.includes('Local Org'));
  assert.match(markup,/aria-label="Studio \(alice@example.com\)"[^>]*aria-current="page"/);
});

test('each team menu exposes creation and administration while settings render inline',()=>{
  const menu=renderToStaticMarkup(React.createElement(TeamMenu,{team:{id:'team',title:'Research'},icon:()=>null,canCreate:true}));
  for(const label of ['Research menu','New Goal','New Chat','Processes','Settings','Hide'])assert(menu.includes(label));
  const page=renderToStaticMarkup(React.createElement(SettingsPage,{title:'Team settings',items:[['processes','Processes']],selected:'processes'},'Process editor'));
  assert.match(page,/<section[^>]*class="bc-settings-page"/);assert(page.includes('Process editor'));assert.doesNotMatch(page,/<dialog|aria-modal/);
});


test('logo is inert, menu actions have icons, and bottom controls use the requested order',()=>{
  const icons=[];
  const icon=(name,props)=>{icons.push(name);return React.createElement('svg',{'data-icon':name,'aria-hidden':true,...props});};
  const markup=renderToStaticMarkup(React.createElement(BeesNavigation,{brandMark:'/brand.png',icon,accounts:[{id:'alice',active:true,user:{email:'alice@example.com'},organizations:[]},{id:'bob',user:{email:'bob@example.com'},organizations:[]}],theme:{dark:true},teams:[{id:'only',title:'Default'}]}));
  assert.match(markup,/<div class="bc-brand" title="Bees"><img src="\/brand.png" alt="Bees"\/><\/div>/);
  assert(markup.indexOf('class="bc-brand"')<markup.indexOf('bc-create-org'));
  assert.match(markup,/class="bc-account-count">2<\/small>/);
  assert.doesNotMatch(markup,/bc-avatar|Hidden teams/);
  const bottom=markup.slice(markup.indexOf('class="bc-rail-bottom"'));
  const labels=['Switch to light theme','Org settings','Global settings','Account settings'];
  for(let i=1;i<labels.length;i++)assert(bottom.indexOf(labels[i-1])<bottom.indexOf(labels[i]),labels[i]);
  assert.match(markup,/data-icon="plus"/);
  for(const name of ['accounts','gear','sun'])assert(icons.includes(name),name);
});

test('single-team thread lists stay visible without a team heading, including previously collapsed teams',()=>{
  const render=(grouped,expanded)=>renderToStaticMarkup(React.createElement(TeamSection,{team:{id:'default',title:'Default'},grouped,expanded,count:1,menu:React.createElement('button',null,'Team menu')},'A thread'));
  const single=render(false,false);
  assert(single.includes('A thread'));assert.doesNotMatch(single,/bc-team-heading|aria-expanded|Default|Team menu/);
  const grouped=render(true,true);
  assert.match(grouped,/aria-expanded="true"/);assert(grouped.includes('Default'));assert(grouped.includes('A thread'));assert(grouped.includes('Team menu'));
  const collapsed=render(true,false);
  assert.match(collapsed,/aria-expanded="false"/);assert(!collapsed.includes('A thread'));
});


test('hover menus open on pointer entry, keep keyboard access, and prevent click toggling',()=>{
  const prior=globalThis.window;globalThis.window={innerHeight:300,innerWidth:1000};
  try{
    let selected=0,focused=0,hovered=false;
    const panel={offsetHeight:100,offsetWidth:280,style:{}},summary={getBoundingClientRect:()=>({top:250,right:276}),focus:()=>focused++,setAttribute:()=>{}};
    const menu={open:false,setAttribute:()=>{menu.open=true;},removeAttribute:()=>{menu.open=false;},querySelector:selector=>selector==='nav'?panel:summary,contains:value=>value===panel,matches:()=>hovered};
    const rendered=HoverMenu({className:'bc-org-switcher',title:'Studio (alice@example.com)',label:'Studio',onSelect:()=>selected++});
    rendered.props.onPointerEnter({currentTarget:menu,pointerType:'mouse'});
    assert.equal(menu.open,true);assert.equal(panel.style.top,'192px');assert.equal(panel.style.left,'276px','Popup touches its trigger so there is no pointer gap');
    rendered.props.onPointerLeave({currentTarget:menu,relatedTarget:panel});assert.equal(menu.open,true);
    rendered.props.onBlur({currentTarget:menu,relatedTarget:panel});assert.equal(menu.open,true);
    hovered=true;rendered.props.onBlur({currentTarget:menu,relatedTarget:null});assert.equal(menu.open,true,'Clicking popup padding must not dismiss it');
    hovered=false;rendered.props.onBlur({currentTarget:menu,relatedTarget:null});assert.equal(menu.open,false);
    rendered.props.onFocus({currentTarget:menu});
    rendered.props.onKeyDown({currentTarget:menu,key:'Escape'});assert.equal(menu.open,false);assert.equal(focused,1);
    rendered.props.onFocus({currentTarget:menu});assert.equal(menu.open,true);
    rendered.props.onPointerLeave({currentTarget:menu});assert.equal(menu.open,false);
    rendered.props.onPointerEnter({currentTarget:menu,pointerType:'touch'});assert.equal(menu.open,false);
    let prevented=false;rendered.props.children[0].props.onClick({preventDefault:()=>prevented=true});
    assert(prevented);assert.equal(selected,1);assert.equal(menu.open,false);
  }finally{if(prior===undefined)delete globalThis.window;else globalThis.window=prior;}
});


test('thread creation stays in the threads pane rather than the account and org rail',t=>{
  const prior=globalThis.window;globalThis.window={};
  t.after(()=>{if(prior===undefined)delete globalThis.window;else globalThis.window=prior;});
  const markup=renderToStaticMarkup(React.createElement(ThreadApp,{}));
  const aside=markup.slice(markup.indexOf('<aside'),markup.indexOf('</aside>'));
  for(const label of ['New Goal','New Chat'])assert(aside.includes(`aria-label="${label}"`),label);
  assert(aside.indexOf('bc-thread-create')<aside.indexOf('Search threads'));
  const rail=markup.slice(markup.indexOf('aria-label="Main navigation"'),markup.indexOf('<aside'));
  assert.doesNotMatch(rail,/New Goal|New Chat|Team settings|Manage teams/);
  assert(aside.includes('Manage teams'));
});


test('thread-pane team management keeps creation, settings and hidden teams reachable',()=>{
  const markup=renderToStaticMarkup(React.createElement(TeamManagement,{icon:()=>null,hasTeam:true,hiddenTeams:[{id:'b',title:'Zulu hidden'},{id:'a',title:'Alpha hidden'}]}));
  for(const label of ['Manage teams','Create team','Team settings','Hidden teams','Alpha hidden','Zulu hidden'])assert(markup.includes(label),label);
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
