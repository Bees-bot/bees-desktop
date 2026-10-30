import { h, hosted } from './runtime.js';
import { OrganizationIcon } from './thread-organization-appearance.js';

export const initials=name=>(name||'You').split(/\s|@/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();

export function TeamMenu({team,icon,busy,onCreateTeam,onSettings,onHide}){
  const choose=fn=>event=>{event.currentTarget.closest('details').open=false;fn();};
  return h('details',{className:'bc-team-menu bc-thread-menu',onKeyDown:event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary').focus();}}},
    h('summary',{'aria-label':`${team.title} menu`,title:`${team.title} menu`},icon('more')),
    h('nav',{'aria-label':`${team.title} actions`},
      h('button',{onClick:choose(()=>onSettings('processes',team.id))},icon('process'),'Processes'),
      h('button',{onClick:choose(()=>onSettings('agents',team.id))},icon('team'),'Agents'),
      h('button',{onClick:choose(()=>onSettings('schedule',team.id))},icon('schedule'),'Schedules'),
      h('button',{onClick:choose(()=>onSettings('folders',team.id))},icon('file'),'Files & folders'),
      h('button',{onClick:choose(()=>onSettings('addons',team.id))},icon('plus'),'Add-ons'),
      h('button',{disabled:busy,onClick:choose(()=>onHide(team.id))},icon('hide'),'Hide'),
      h('hr'),
      h('button',{onClick:choose(()=>onSettings('general',team.id))},icon('gear'),'Settings'),
      h('button',{disabled:busy,onClick:choose(onCreateTeam)},icon('plus'),'Create team')));
}

export function TeamSection({team,expanded,onToggle,onOpen,menu,children}){
  const toggleLabel=`${expanded?'Collapse':'Expand'} ${team.title}`;
  return h('section',{className:'bc-team-section'},
    h('div',{className:'bc-team-heading'},
      h('button',{className:'bc-team-toggle','aria-label':toggleLabel,title:toggleLabel,'aria-expanded':expanded,onClick:onToggle},
        h('svg',{className:'bc-team-chevron',width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:'m9 6 6 6-6 6'}))),
      h('button',{className:'bc-team-name',title:`New thread in ${team.title}`,onClick:onOpen},team.title),
      menu),
    expanded?h('div',{className:'bc-team-threads'},children):null);
}

export function BeesNavigation({brandMark,icon,organizations=[],localOrganizations=[],accounts=[],user,localActive=!accounts.some(account=>account.active),organizationId,theme,busy,onOrganization,onGlobal,onTheme,onAccount}){
  const accountRows=hosted&&!accounts.length?[{id:null,active:true,user,organizations}]:accounts;
  const localSelected=localActive&&!organizationId;
  const label=text=>h('span',{className:'bc-rail-label'},text);
  const orgRows=[...!hosted?localOrganizations.map(org=>({account:{id:null,active:localActive},org,title:`${org.name} (Local)`})):[],...accountRows.flatMap(account=>(account.organizations??[]).map(org=>({account,org,title:`${org.name} (${account.user?.email??'Account'})` })))]
    .sort((a,b)=>a.org.name.localeCompare(b.org.name,undefined,{sensitivity:'base'})||a.title.localeCompare(b.title));
  return h('nav',{className:'bc-rail','aria-label':'Main navigation'},
    h('div',{className:'bc-brand',title:'Bees'},brandMark?h('img',{src:brandMark,alt:'Bees'}):h('span',{'aria-label':'Bees'},'✳')),
    h('div',{className:'bc-rail-organizations'},
      !hosted?h('button',{className:'bc-rail-action bc-local-switcher',title:'Local Org','aria-label':'Local Org','aria-current':localSelected?'page':undefined,disabled:busy,onClick:()=>onOrganization(null,null)},icon('personal'),label('Local Org')):null,
      orgRows.map(({account,org,title})=>{
        const selected=account.active&&org.id===(organizationId??null);
        return h('div',{key:`${account.id}:${org.id}`,className:'bc-org-switcher'},
          h('button',{className:'bc-rail-action',title,'aria-label':title,'aria-current':selected?'page':undefined,disabled:busy,
            onClick:()=>{if(!selected)onOrganization(org.id,account.id);}},h(OrganizationIcon,{organization:org,icon}),label(title)));
      }),
      h('button',{className:'bc-rail-action bc-create-org',disabled:busy,'aria-label':'Add organization',title:'Add organization',onClick:()=>onGlobal('organizations')},icon('plus'),label('Add organization')),
      accountRows.filter(account=>account.organizationError).map(account=>h('p',{key:account.id,className:'bc-rail-label bc-org-error',role:'status',title:account.organizationError},`Org list unavailable (${account.user?.email??'Account'}). Showing saved orgs.`))),
    h('div',{className:'bc-spacer'}),
    h('div',{className:'bc-rail-bottom'},
      h('button',{className:'bc-rail-action','aria-label':`Switch to ${theme.dark?'light':'dark'} theme`,title:`Switch to ${theme.dark?'light':'dark'} theme`,onClick:onTheme},icon(theme.dark?'sun':'moon'),label(theme.dark?'Light mode':'Dark mode')),
      h('button',{className:'bc-rail-action','aria-label':'Settings',title:'Settings',onClick:()=>onGlobal('ai')},icon('settings'),label('Settings')),
      h('button',{className:'bc-rail-action','aria-label':'Account settings','aria-description':accounts.length>1?`${accounts.length} signed-in accounts`:undefined,title:'Account settings',onClick:onAccount},h('span',{className:'bc-account-icon'},icon('accounts'),accounts.length>1?h('small',{className:'bc-account-count'},accounts.length):null),label('Accounts'))));
}

export function SettingsScopePicker({label,rows,selected,onSelect,busy,icon}){
  return h('div',{className:'bc-settings-scope-picker','aria-label':label},rows.map(row=>h('button',{
    key:row.id,type:'button',title:row.title,'aria-label':row.title,'aria-pressed':row.id===selected,disabled:busy,onClick:()=>onSelect(row.id)
  },row.organization?h(OrganizationIcon,{organization:row.organization,icon}):h('span',{className:'bc-team-initial','aria-hidden':true},row.title.trim().slice(0,1).toUpperCase()))));
}
