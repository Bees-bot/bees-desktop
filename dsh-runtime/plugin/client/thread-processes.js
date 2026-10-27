import { h, useState, useRef, useEffect } from './runtime.js';
import { DEFAULT_WORKFLOW, WORKFLOW_TEMPLATES, isChatWorkflow } from '../lib/thread-workflow.js';
import { confirmAction } from './common.js';

export function WorkflowStages({stages,onChange,disabled=false,agents=[]}){
  return h('fieldset',{className:'bc-form bc-fieldset',disabled},
    stages.map((stage,index)=>h('div',{key:index,className:'bc-actions'},
      h('input',{'aria-label':'Stage name',value:stage.name,required:true,pattern:'.*\\S.*',title:'Give each stage a name.',maxLength:80,onChange:e=>onChange(stages.map((s,i)=>i===index?{...s,name:e.target.value}:s))}),
      h('select',{'aria-label':'Stage type',value:stage.kind,onChange:e=>onChange(stages.map((s,i)=>i===index?{...s,kind:e.target.value}:s))},
        h('option',{value:'work'},'Work'),h('option',{value:'review'},'Independent review'),h('option',{value:'approval'},'Your approval'),h('option',{value:'chat',disabled:stages.length!==1},'AI chat')),
      stage.kind!=='approval'?h('label',{className:'bc-field'},h('span',null,'Agent'),h('select',{'aria-label':'Stage agent',value:stage.agentId??'',onChange:e=>onChange(stages.map((s,i)=>{if(i!==index)return s;const next={...s};if(e.target.value)next.agentId=e.target.value;else delete next.agentId;return next;}))},
        h('option',{value:''},'Default Bees agent'),stage.agentId&&!agents.some(agent=>agent.id===stage.agentId)?h('option',{value:stage.agentId},'Removed agent — choose another'):null,
        agents.map(agent=>h('option',{key:agent.id,value:agent.id,disabled:!agent.enabled},agent.name+(agent.enabled?'':' (disabled)'))))):null,
      h('button',{type:'button',className:'bc-icon danger','aria-label':'Remove stage',disabled:stages.length===1,onClick:()=>onChange(stages.filter((_,i)=>i!==index))},'×'))),
    h('button',{type:'button',disabled:stages.length>=12||isChatWorkflow(stages),onClick:()=>onChange([...stages,{name:'Next step',kind:'work'}])},'Add stage'));
}

export function TeamProcesses({team,canManage,canCreate,busy,onSave,onSaveDefault,onStart}){
  const [editing,setEditing]=useState(null),[name,setName]=useState(''),[stages,setStages]=useState(DEFAULT_WORKFLOW);
  const [editingDefault,setEditingDefault]=useState(false),[defaultStages,setDefaultStages]=useState(team?.workflow??DEFAULT_WORKFLOW);
  const editor=useRef();
  useEffect(()=>{setDefaultStages(team?.workflow??DEFAULT_WORKFLOW);},[team?.workflow]);
  useEffect(()=>{if(editing&&editor.current){editor.current.scrollIntoView({block:'start'});editor.current.querySelector('input')?.focus({preventScroll:true});}},[editing]);
  const edit=process=>{setEditing(process?.id??'new');setName(process?.name??'');setStages(process?.workflow??DEFAULT_WORKFLOW);};
  const describe=workflow=>isChatWorkflow(workflow)?'You → Chat → You ↻':workflow.map(s=>s.name).concat('Done').join(' → ');
  return h('section',{className:'bc-form'},
    h('h3',null,'Processes'),
    h('p',{className:'bc-muted'},'Configure the default process and custom process templates for this team.'),
    h('div',{className:'bc-default-process-card bc-card bc-form'},
      h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'8px'}},
        h('div',null,
          h('strong',null,'Default Process'),
          h('p',{className:'bc-muted',style:{margin:'2px 0 0'}},describe(team?.workflow??DEFAULT_WORKFLOW))),
        canManage?h('button',{type:'button',disabled:busy,onClick:()=>setEditingDefault(v=>!v)},editingDefault?'Close editor':'Customize default'):null),
      editingDefault?h('form',{className:'bc-form bc-process-editor',style:{marginTop:'14px',paddingTop:'14px'},onSubmit:async event=>{
        event.preventDefault();if(busy||!canManage)return;
        if(await onSaveDefault?.(defaultStages.map(s=>({...s,name:s.name.trim()}))))setEditingDefault(false);
      }},
        h('h4',{style:{margin:'0 0 8px'}},'Default process stages'),
        h(WorkflowStages,{stages:defaultStages,agents:team?.agents??[],onChange:setDefaultStages,disabled:busy}),
        h('div',{className:'bc-actions'},
          h('button',{className:'bc-primary',disabled:busy,type:'submit'},'Save default process'),
          h('button',{type:'button',onClick:()=>{setDefaultStages(team?.workflow??DEFAULT_WORKFLOW);setEditingDefault(false);}},'Cancel'))):null),
    h('h3',null,'Process Library'),
    h('p',{className:'bc-muted'},'Reusable processes for this team. Each new thread keeps the stages it started with.'),
    h('div',{className:'bc-process-list'},[...WORKFLOW_TEMPLATES,...(team?.processes??[])].map(process=>h('article',{key:process.id,className:'bc-card bc-form'},
      h('strong',null,process.name),h('small',null,describe(process.workflow)),
      h('div',{className:'bc-actions'},h('button',{disabled:busy||!canCreate,onClick:()=>onStart(process.id)},process.id==='chat'?'New Chat':process.id==='goals'?'New Goal':'Start thread'),
        canManage&&!WORKFLOW_TEMPLATES.some(t=>t.id===process.id)?h('button',{disabled:busy,onClick:()=>edit(process)},'Edit'):null,
        canManage&&!WORKFLOW_TEMPLATES.some(t=>t.id===process.id)?h('button',{disabled:busy,onClick:async()=>{if(await confirmAction(`Delete the ${process.name} process? Threads already using it keep their stages.`,'Delete')&&await onSave((team.processes??[]).filter(p=>p.id!==process.id)))setEditing(null);}},'Delete'):null)))),
    canManage?h('button',{className:'bc-primary',disabled:busy,onClick:()=>edit(null)},'Create process'):null,
    editing?h('form',{key:editing,ref:editor,className:'bc-form bc-process-editor',onSubmit:async event=>{
      event.preventDefault();if(busy||!canManage)return;
      const process={id:editing==='new'?crypto.randomUUID():editing,name:name.trim(),workflow:stages.map(s=>({...s,name:s.name.trim()}))};
      const processes=editing==='new'?[...(team.processes??[]),process]:(team.processes??[]).map(p=>p.id===editing?process:p);
      if(await onSave(processes))setEditing(null);
    }},h('h3',null,editing==='new'?'Create process':'Edit process'),
      h('label',{className:'bc-field'},h('span',null,'Process name'),h('input',{value:name,required:true,pattern:'.*\\S.*',title:'Give the process a name.',maxLength:120,onChange:e=>{setName(e.target.value);e.target.setCustomValidity([...WORKFLOW_TEMPLATES,...(team.processes??[])].some(p=>p.id!==editing&&p.name.toLowerCase()===e.target.value.trim().toLowerCase())?'A process with this name already exists.':'');}})),
      h(WorkflowStages,{stages,agents:team.agents??[],onChange:setStages,disabled:busy}),
      h('div',{className:'bc-actions'},h('button',{className:'bc-primary',disabled:busy,type:'submit'},'Save process'),h('button',{type:'button',onClick:()=>setEditing(null)},'Cancel'))):null);
}
