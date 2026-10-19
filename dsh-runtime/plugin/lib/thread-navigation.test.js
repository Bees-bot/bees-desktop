import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {configureRuntime} from '../client/runtime.js';
import {BeesNavigation,TeamMenu} from '../client/thread-navigation.js';
import {SettingsPage} from '../client/thread-panels.js';

configureRuntime(name=>({react:React,'react-dom':{},'@deepseek-ai/dsh-client-ui-primitives':{}})[name],{hosted:true});

test('Bees navigation groups organizations and creation in the logo menu and exposes both thread processes',()=>{
  const markup=renderToStaticMarkup(React.createElement(BeesNavigation,{brandMark:'/brand.png',icon:()=>null,theme:{dark:false},canCreate:true,hasTeam:true,teamName:'Research team',organizationId:'work',organizations:[{id:'work',name:'Work organization'}]}));
  assert.match(markup,/aria-label="Bees menu"/);assert.match(markup,/alt="Bees"/);
  for(const label of ['Personal','Work organization','Create organization','Create team','New Goal','New Chat','Team settings','Organization settings','Global settings'])assert(markup.includes(label),label);
  assert.match(markup,/aria-pressed="true"[^>]*>Work organization/);
  assert.match(markup,/aria-label="Selected team"[^>]*>Research team/);
  assert(markup.indexOf('aria-label="New Chat"')<markup.indexOf('aria-label="Team settings"'));
  assert(markup.indexOf('aria-label="Team settings"')<markup.indexOf('bc-spacer'));
  assert.doesNotMatch(markup,/aria-label="Threads"|icon\('more'\)/);
  const disabled=renderToStaticMarkup(React.createElement(BeesNavigation,{icon:()=>null,theme:{},canCreate:false}));
  assert.match(disabled,/aria-label="New Goal" disabled/);assert.match(disabled,/aria-label="New Chat" disabled/);
});

test('each team menu exposes creation and administration while settings render inline',()=>{
  const menu=renderToStaticMarkup(React.createElement(TeamMenu,{team:{id:'team',title:'Research'},icon:()=>null,canCreate:true}));
  for(const label of ['Research menu','New Goal','New Chat','Processes','Settings'])assert(menu.includes(label));
  const page=renderToStaticMarkup(React.createElement(SettingsPage,{title:'Team settings',items:[['processes','Processes']],selected:'processes'},'Process editor'));
  assert.match(page,/<section[^>]*class="bc-settings-page"/);assert(page.includes('Process editor'));assert.doesNotMatch(page,/<dialog|aria-modal/);
});
