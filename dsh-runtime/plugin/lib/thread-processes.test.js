import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {configureRuntime} from '../client/runtime.js';
import {WorkflowStages} from '../client/thread-processes.js';
import {CHAT_WORKFLOW, isValidWorkflow} from './thread-workflow.js';

configureRuntime(name=>({react:React,'react-dom':{},'@deepseek-ai/dsh-client-ui-primitives':{}})[name],{hosted:true});
const elements=tree=>!tree||typeof tree!=='object'?[]:[tree,...React.Children.toArray(tree.props?.children).flatMap(elements)];
const agentId='11111111-1111-4111-8111-111111111111';
const stages=[{name:'Write',kind:'work',agentId,model:'provider/model',instructions:'Keep the sources.'},{name:'Approve',kind:'approval'}];

test('process creation is an editable stage board with human approval and a fixed finish',()=>{
  const markup=renderToStaticMarkup(React.createElement(WorkflowStages,{stages,onChange:()=>{}}));
  for(const label of ['Process creation board','Stage 1: Write','Stage 2: Approve','Stage name','Stage type','Stage agent','Stage instructions','Work waits for your approval','Work completes here.'])assert(markup.includes(label),label);
  assert.equal((markup.match(/aria-label="Stage agent"/g)??[]).length,1);
  assert.equal((markup.match(/class="bc-kanban-column/g)??[]).length,3);
  assert.match(markup,/role="region" aria-label="Process creation board" tabindex="0"/);
  assert.match(markup,/Removed agent — choose another/);
});

test('moving and editing stage cards preserves agent, model and instructions',()=>{
  let saved;
  const nodes=elements(WorkflowStages({stages,onChange:value=>{saved=value;}}));
  nodes.find(node=>node.props['aria-label']==='Move stage 1 right').props.onClick();
  assert.deepEqual(saved,[stages[1],stages[0]]);
  assert(isValidWorkflow(saved));
  nodes.find(node=>node.props['aria-label']==='Stage name').props.onChange({target:{value:'Draft'}});
  assert.deepEqual(saved,[{...stages[0],name:'Draft'},stages[1]]);
  nodes.find(node=>node.type==='textarea').props.onChange({target:{value:'Cite every source.'}});
  assert.deepEqual(saved,[{...stages[0],instructions:'Cite every source.'},stages[1]]);
  nodes.find(node=>node.props['aria-label']==='Stage agent').props.onChange({target:{value:''}});
  assert.equal(saved[0].agentId,undefined);
  assert.equal(saved[0].model,stages[0].model);
  nodes.find(node=>node.props['aria-label']==='Remove stage 1').props.onClick();
  assert.deepEqual(saved,[stages[1]]);
  nodes.find(node=>node.type==='button'&&node.props.children==='Add stage').props.onClick();
  assert.deepEqual(saved,[...stages,{name:'Next step',kind:'work'}]);
  assert.deepEqual(stages[0],{name:'Write',kind:'work',agentId,model:'provider/model',instructions:'Keep the sources.'});
});

test('stage board keeps chat, stage limits and disabled agents intact',()=>{
  const chat=elements(WorkflowStages({stages:CHAT_WORKFLOW,onChange:()=>{},disabled:true}));
  assert.equal(chat[0].props.disabled,true);
  for(const label of ['Move stage 1 left','Move stage 1 right','Remove stage 1'])assert.equal(chat.find(node=>node.props['aria-label']===label).props.disabled,true);
  assert.equal(chat.find(node=>node.type==='button'&&node.props.children==='Add stage').props.disabled,true);
  assert(chat.some(node=>node.props['aria-label']==='Your turn'));
  const full=elements(WorkflowStages({stages:Array.from({length:12},()=>stages[0]),agents:[{id:agentId,name:'Writer',enabled:false}],onChange:()=>{}}));
  assert.equal(full.find(node=>node.type==='button'&&node.props.children==='Add stage').props.disabled,true);
  assert(full.filter(node=>node.type==='option'&&node.props.value==='chat').every(node=>node.props.disabled));
  assert(full.filter(node=>node.type==='option'&&node.props.value===agentId).every(node=>node.props.disabled));
});
