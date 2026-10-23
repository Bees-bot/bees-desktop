import { h, hosted } from './runtime.js';
import { OrganizationIcon } from './thread-organization-appearance.js';

export const initials=name=>(name||'You').split(/\s|@/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();

export function TeamMenu({team,icon,busy,canCreate,onCreate,onSettings,onHide}){
  const choose=fn=>event=>{event.currentTarget.closest('details').open=false;fn();};
  return h('details',{className:'bc-team-menu bc-thread-menu',onKeyDown:event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary').focus();}}},
    h('summary',{'aria-label':`${team.title} menu`,title:`${team.title} menu`},icon('more')),
    h('nav',{'aria-label':`${team.title} actions`},
      h('button',{disabled:busy||!canCreate,onClick:choose(()=>onCreate('goals',team.id))},icon('goal'),'New Goal'),
      h('button',{disabled:busy||!canCreate,onClick:choose(()=>onCreate('chat',team.id))},icon('chat'),'New Chat'),
      h('button',{onClick:choose(()=>onSettings('agents',team.id))},icon('team'),'Agents'),
      h('button',{onClick:choose(()=>onSettings('processes',team.id))},icon('process'),'Processes'),
      h('button',{onClick:choose(()=>onSettings('general',team.id))},icon('gear'),'Settings'),
      h('hr'),h('button',{disabled:busy,onClick:choose(()=>onHide(team.id))},icon('hide'),'Hide')));
}

export function TeamSection({team,grouped,expanded,active,onToggle,menu,count,children}){
  return h('section',{className:'bc-team-section'+(active?' active':'')+(!grouped?' bc-team-ungrouped':'')},
    grouped?h('div',{className:'bc-team-heading'},
      h('button',{className:'bc-team-toggle','aria-expanded':expanded,onClick:onToggle},
        h('span',{'aria-hidden':true},expanded?'⌄':'›'),h('strong',{title:team.title},team.title),h('small',null,count)),menu):null,
    !grouped||expanded?h('div',{className:'bc-team-threads'},children):null);
}

export function TeamManagement({icon,busy,hasTeam,onTeam,onCreateTeam,hiddenTeams=[],onSelectTeam}){
  const choose=fn=>event=>{event.currentTarget.closest('details').open=false;fn();};
  return h('details',{className:'bc-thread-menu bc-team-management',onKeyDown:event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary').focus();}}},
    h('summary',{'aria-label':'Manage teams',title:'Manage teams'},icon('more')),
    h('nav',{'aria-label':'Manage teams'},
      h('button',{disabled:busy,onClick:choose(onCreateTeam)},icon('plus'),'Create team'),
      h('button',{disabled:busy||!hasTeam,onClick:choose(onTeam)},icon('gear'),'Team settings'),
      hiddenTeams.length?h('hr'):null,hiddenTeams.length?h('strong',null,'Hidden teams'):null,
      [...hiddenTeams].sort((a,b)=>a.title.localeCompare(b.title)).map(team=>h('button',{key:team.id,disabled:busy,onClick:choose(()=>onSelectTeam(team.id))},icon('team'),team.title))));
}

export function closeHoverMenu(menu){
  menu.removeAttribute('data-open');menu.querySelector('.bc-rail-action').setAttribute('aria-expanded','false');
}

export function HoverMenu({className,label,title,icon,children,onSelect,selected}){
  const open=event=>{
    if(event.pointerType==='touch')return;
    const menu=event.currentTarget;menu.setAttribute('data-open','true');
    const trigger=menu.querySelector('.bc-rail-action');trigger.setAttribute('aria-expanded','true');
    const panel=menu.querySelector('nav'),anchor=trigger.getBoundingClientRect();
    panel.style.top=`${Math.max(8,Math.min(anchor.top,window.innerHeight-panel.offsetHeight-8))}px`;
    panel.style.left=`${Math.max(8,Math.min(anchor.right,window.innerWidth-panel.offsetWidth-8))}px`;
  };
  return h('div',{className:'bc-brand-menu '+className,onPointerEnter:open,onPointerLeave:event=>{if(!event.currentTarget.contains(event.relatedTarget))closeHoverMenu(event.currentTarget);},onFocus:open,
    onBlur:event=>{if(!event.currentTarget.contains(event.relatedTarget)&&!event.currentTarget.matches(':hover'))closeHoverMenu(event.currentTarget);},
    onKeyDown:event=>{if(event.key==='Escape'){event.currentTarget.querySelector('.bc-rail-action').focus();closeHoverMenu(event.currentTarget);}}},
    h('button',{className:'bc-rail-action',title,'aria-label':title,'aria-haspopup':true,'aria-expanded':false,'aria-current':selected?'page':undefined,onClick:event=>{event.preventDefault();onSelect?.();}},icon,label),children);
}

export function BeesNavigation({brandMark,icon,organizations=[],accounts=[],user,localActive=!accounts.some(account=>account.active),organizationId,theme,busy,onOrganization,onCreateOrganization,onGlobal,onTheme,onAccount}){
  const choose=fn=>event=>{closeHoverMenu(event.currentTarget.closest('.bc-brand-menu'));fn();};
  const accountRows=hosted&&!accounts.length?[{id:null,active:true,user,organizations}]:accounts;
  const localSelected=localActive&&!organizationId;
  const label=text=>h('span',{className:'bc-rail-label'},text);
  const orgRows=accountRows.flatMap(account=>(account.organizations??[]).map(org=>({account,org,title:`${org.name} (${account.user?.email??'Account'})` })))
    .sort((a,b)=>a.org.name.localeCompare(b.org.name,undefined,{sensitivity:'base'})||a.title.localeCompare(b.title));
  return h('nav',{className:'bc-rail','aria-label':'Main navigation'},
    h('div',{className:'bc-brand',title:'Bees'},brandMark?h('img',{src:brandMark,alt:'Bees'}):h('span',{'aria-label':'Bees'},'✳')),
    h('div',{className:'bc-rail-organizations'},
      !hosted?h('button',{className:'bc-rail-action bc-local-switcher',title:'Local Org','aria-label':'Local Org','aria-current':localSelected?'page':undefined,disabled:busy,onClick:()=>onOrganization(null,null)},icon('personal'),label('Local Org')):null,
      orgRows.map(({account,org,title})=>{
        const selected=account.active&&org.id===(organizationId??null);
        return h(HoverMenu,{key:`${account.id}:${org.id}`,className:'bc-org-switcher',title,selected,icon:h(OrganizationIcon,{organization:org,icon}),label:label(title),
          onSelect:()=>{if(!selected&&!busy)onOrganization(org.id,account.id);}},
          h('nav',{'aria-label':title},h('strong',null,title),
            h('button',{disabled:busy,onClick:choose(()=>onOrganization(org.id,account.id))},h('span',{className:'bc-menu-symbol'},h(OrganizationIcon,{organization:org,icon})),h('span',{className:'bc-menu-label'},'Open '+org.name)),
            h('button',{disabled:busy,onClick:choose(()=>onOrganization(org.id,account.id,true))},h('span',{className:'bc-menu-symbol'},icon('gear')),h('span',{className:'bc-menu-label'},'Org settings'))));
      }),
      accountRows.map(account=>h('button',{key:account.id??'hosted',className:'bc-rail-action bc-create-org',title:`Create org for ${account.user?.email??'account'}`,'aria-label':`Create org for ${account.user?.email??'account'}`,disabled:busy,onClick:()=>onCreateOrganization(account.id)},icon('plus'),label(`Create org (${account.user?.email??'Account'})`))),
      accountRows.filter(account=>account.organizationError).map(account=>h('p',{key:account.id,className:'bc-rail-label bc-org-error',role:'status',title:account.organizationError},`Org list unavailable (${account.user?.email??'Account'}). Showing saved orgs.`))),
    h('div',{className:'bc-spacer'}),
    h('div',{className:'bc-rail-bottom'},
      h('button',{className:'bc-rail-action','aria-label':`Switch to ${theme.dark?'light':'dark'} theme`,title:`Switch to ${theme.dark?'light':'dark'} theme`,onClick:onTheme},icon(theme.dark?'sun':'moon'),label(theme.dark?'Light mode':'Dark mode')),
      h('button',{className:'bc-rail-action','aria-label':'Org settings',title:'Org settings',onClick:()=>onGlobal('organizations')},h('span',{className:'bc-scope-icon'},icon('organization'),icon('gear')),label('Org settings')),
      h('button',{className:'bc-rail-action','aria-label':'Global settings',title:'Global settings',onClick:()=>onGlobal('ai')},icon('settings'),label('Global settings')),
      h('button',{className:'bc-rail-action','aria-label':'Account settings','aria-description':accounts.length>1?`${accounts.length} signed-in accounts`:undefined,title:'Account settings',onClick:onAccount},h('span',{className:'bc-account-icon'},icon('accounts'),accounts.length>1?h('small',{className:'bc-account-count'},accounts.length):null),label('Accounts'))));
}
