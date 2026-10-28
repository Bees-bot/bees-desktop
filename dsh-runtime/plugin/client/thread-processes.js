import { h, useState, useRef, useEffect } from './runtime.js';
import { DEFAULT_WORKFLOW, WORKFLOW_TEMPLATES, isChatWorkflow, isValidWorkflow } from '../lib/thread-workflow.js';
import { ask, confirmAction } from './common.js';

export function WorkflowStages({stages,onChange,disabled=false,agents=[]}){
  return h('fieldset',{className:'bc-form bc-fieldset',disabled},
    stages.map((stage,index)=>h('div',{key:index,className:'bc-actions'},
      h('input',{'aria-label':'Stage name',value:stage.name,required:true,pattern:'.*\\S.*',title:'Give each stage a name.',maxLength:80,onChange:e=>onChange(stages.map((s,i)=>i===index?{...s,name:e.target.value}:s))}),
      h('select',{'aria-label':'Stage type',value:stage.kind,onChange:e=>onChange(stages.map((s,i)=>i===index?{...s,kind:e.target.value}:s))},
        h('option',{value:'work'},'Work'),h('option',{value:'review'},'Independent review'),h('option',{value:'approval'},'Your approval'),h('option',{value:'chat',disabled:stages.length!==1},'AI chat')),
      stage.kind!=='approval'?h('label',{className:'bc-field'},h('span',null,'Agent'),h('select',{'aria-label':'Stage agent',value:stage.agentId??'',onChange:e=>onChange(stages.map((s,i)=>{if(i!==index)return s;const next={...s};if(e.target.value)next.agentId=e.target.value;else delete next.agentId;return next;}))},
        h('option',{value:''},'Default Bees agent'),stage.agentId&&!agents.some(agent=>agent.id===stage.agentId)?h('option',{value:stage.agentId},'Removed agent — choose another'):null,
        agents.map(agent=>h('option',{key:agent.id,value:agent.id,disabled:!agent.enabled},agent.name+(agent.enabled?'':' (disabled)'))))):null,
      h('button',{type:'button','aria-label':'Remove stage',disabled:stages.length===1,onClick:()=>onChange(stages.filter((_,i)=>i!==index))},'×'))),
    h('button',{type:'button',disabled:stages.length>=12||isChatWorkflow(stages),onClick:()=>onChange([...stages,{name:'Next step',kind:'work'}])},'Add stage'));
}

// agents and models only exist inside one team, so a shared process keeps just the stage text
const portable=workflow=>workflow.map(s=>({name:typeof s?.name==='string'?s.name.trim():s?.name,kind:s?.kind,...(s?.instructions?{instructions:s.instructions}:{})}));
function exportProcess(process){
  const link=document.createElement('a');
  link.href=URL.createObjectURL(new Blob([JSON.stringify({name:process.name,...(process.description?{description:process.description}:{}),workflow:portable(process.workflow)},null,2)+'\n'],{type:'application/json'}));
  link.download=(process.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'process')+'.json';
  link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}
// returns the line to show when the import is refused, or '' when it saved or was cancelled
async function importProcess(team,onSave){
  const processes=team.processes??[];
  if(processes.length>=40)return 'This team already has 40 processes. Delete one before importing another.';
  const input=await ask('Paste a process file, or an https link to the raw file','','textarea');
  if(input===null)return '';
  if(!input)return 'Paste a process file or a link first.';
  let text=input;
  if(/^[a-z]+:\/\/\S+$/i.test(input)){
    if(!/^https:\/\//i.test(input))return 'Use an https link.';
    try{
      const response=await fetch(input,{signal:AbortSignal.timeout(15000)});
      if(!response.ok)return `That link answered ${response.status}. Check it points at the raw file.`;
      text=await response.text();
    }catch{return 'Bees could not open that link. Open it in your browser and paste the file text here instead.';}
  }
  if(text.length>100000)return 'That file is too big for a process.';
  let doc;try{doc=JSON.parse(text);}catch{return 'That is not a process file. Paste the raw JSON, or use the raw file link.';}
  const name=typeof doc?.name==='string'?doc.name.trim():'';
  if(!name||name.length>120)return 'The process needs a name of 1 to 120 characters.';
  if(!Array.isArray(doc.workflow)||!doc.workflow.length||doc.workflow.length>12)return 'A process needs 1 to 12 stages.';
  const workflow=portable(doc.workflow);
  if(!isValidWorkflow(workflow))return 'Each stage needs a name and a kind of work, review, approval or chat, with instructions under 4000 characters. A chat stage must be the only stage.';
  const taken=n=>[...WORKFLOW_TEMPLATES,...processes].some(p=>p.name.toLowerCase()===n.toLowerCase());
  let unique=name;for(let i=2;taken(unique);i++)unique=`${name.slice(0,110)} (${i})`;
  await onSave([...processes,{id:crypto.randomUUID(),name:unique,workflow}]);
  return '';
}

export function TeamProcesses({team,canManage,canCreate,busy,onSave,onStart}){
  const [editing,setEditing]=useState(null),[name,setName]=useState(''),[stages,setStages]=useState(DEFAULT_WORKFLOW);
  const [importError,setImportError]=useState(''),[importing,setImporting]=useState(false);
  const editor=useRef();
  useEffect(()=>{if(editing&&editor.current){editor.current.scrollIntoView({block:'start'});editor.current.querySelector('input')?.focus({preventScroll:true});}},[editing]);
  const edit=process=>{setEditing(process?.id??'new');setName(process?.name??'');setStages(process?.workflow??DEFAULT_WORKFLOW);};
  const describe=workflow=>isChatWorkflow(workflow)?'You → Chat → You ↻':workflow.map(s=>s.name).concat('Done').join(' → ');
  return h('section',{className:'bc-form'},h('h3',null,'Processes'),
    h('p',{className:'bc-muted'},'Create reusable processes for this team. Each new thread keeps the stages it started with.'),
    h('div',{className:'bc-process-list'},[...WORKFLOW_TEMPLATES,...(team.processes??[])].map(process=>h('article',{key:process.id,className:'bc-card bc-form'},
      h('strong',null,process.name),h('small',null,describe(process.workflow)),
      h('div',{className:'bc-actions'},h('button',{disabled:busy||!canCreate,onClick:()=>onStart(process.id)},process.id==='chat'?'New Chat':process.id==='goals'?'New Goal':'Start thread'),
        h('button',{onClick:()=>exportProcess(process)},'Export'),
        canManage&&!WORKFLOW_TEMPLATES.some(t=>t.id===process.id)?h('button',{disabled:busy,onClick:()=>edit(process)},'Edit'):null,
        canManage&&!WORKFLOW_TEMPLATES.some(t=>t.id===process.id)?h('button',{disabled:busy,onClick:async()=>{if(await confirmAction(`Delete the ${process.name} process? Threads already using it keep their stages.`,'Delete')&&await onSave((team.processes??[]).filter(p=>p.id!==process.id)))setEditing(null);}},'Delete'):null)))),
    canManage?h('div',{className:'bc-actions'},h('button',{className:'bc-primary',disabled:busy,onClick:()=>edit(null)},'Create process'),
      h('button',{disabled:busy||importing,onClick:async()=>{setImporting(true);try{setImportError(await importProcess(team,onSave));}finally{setImporting(false);}}},'Import process')):null,
    importError?h('p',{className:'bc-error',role:'alert',ref:el=>el?.scrollIntoView({block:'nearest'})},importError):null,
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
