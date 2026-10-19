import { h } from './runtime.js';

export function TeamMenu({team,icon,busy,canCreate,onCreate,onSettings}){
  const choose=fn=>event=>{event.currentTarget.closest('details').open=false;fn();};
  return h('details',{className:'bc-team-menu bc-thread-menu',onKeyDown:event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary').focus();}}},
    h('summary',{'aria-label':`${team.title} menu`,title:`${team.title} menu`},icon('more')),
    h('nav',{'aria-label':`${team.title} actions`},
      h('button',{disabled:busy||!canCreate,onClick:choose(()=>onCreate('goals',team.id))},'New Goal'),
      h('button',{disabled:busy||!canCreate,onClick:choose(()=>onCreate('chat',team.id))},'New Chat'),
      h('button',{onClick:choose(()=>onSettings('processes',team.id))},'Processes'),
      h('button',{onClick:choose(()=>onSettings('general',team.id))},'Settings')));
}

export function BeesNavigation({brandMark,icon,organizations=[],organizationId,teamName,user,theme,busy,canCreate,hasTeam,onOrganization,onCreateOrganization,onCreateTeam,onCreate,onGlobal,onTeam,onTheme,onAccount}){
  const choose=fn=>event=>{event.currentTarget.closest('details').open=false;fn();};
  return h('nav',{className:'bc-rail','aria-label':'Main navigation'},
    h('details',{className:'bc-brand-menu',onKeyDown:event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary').focus();}}},
      h('summary',{className:'bc-brand',title:'Bees menu','aria-label':'Bees menu'},brandMark?h('img',{src:brandMark,alt:'Bees'}):'✳'),
      h('nav',{'aria-label':'Bees menu'},h('strong',null,'Organizations'),
        h('button',{'aria-pressed':!organizationId,onClick:choose(()=>onOrganization(null))},'Personal'),
        organizations.map(org=>h('button',{key:org.id,'aria-pressed':org.id===organizationId,onClick:choose(()=>onOrganization(org.id))},org.name)),
        h('hr'),h('button',{disabled:busy,onClick:choose(onCreateOrganization)},'Create organization'),
        h('button',{disabled:busy,onClick:choose(onCreateTeam)},'Create team'))),
    h('span',{className:'bc-selected-team',title:teamName,'aria-label':'Selected team'},teamName??'Select a team'),
    h('button',{className:'bc-rail-action',title:'New Goal','aria-label':'New Goal',disabled:busy||!canCreate,onClick:()=>onCreate('goals')},icon('goal'),h('span',null,'New Goal')),
    h('button',{className:'bc-rail-action',title:'New Chat','aria-label':'New Chat',disabled:busy||!canCreate,onClick:()=>onCreate('chat')},icon('chat'),h('span',null,'New Chat')),
    h('button',{className:'bc-icon','aria-label':'Team settings',title:'Team settings',disabled:!hasTeam,onClick:onTeam},h('span',{'aria-hidden':true,className:'bc-gear'},'⚙')),
    h('div',{className:'bc-spacer'}),
    h('button',{className:'bc-icon','aria-label':'Organization settings',title:'Organization settings',onClick:()=>onGlobal('organizations')},icon('share')),
    h('button',{className:'bc-icon','aria-label':`Switch to ${theme.dark?'light':'dark'} theme`,title:'Switch theme',onClick:onTheme},theme.dark?'☀':'☾'),
    h('button',{className:'bc-icon','aria-label':'Global settings',title:'Global settings',onClick:()=>onGlobal('ai')},icon('settings')),
    h('button',{className:'bc-avatar',title:user?.email??'Sign in','aria-label':'Your account',onClick:onAccount},(user?.email??'You').slice(0,1).toUpperCase()));
}
