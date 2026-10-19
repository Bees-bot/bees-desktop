import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,symlinkSync,mkdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardThreadTool, resolveThreadModel } from './thread-runner.js';

test('saved Latest Codex selections resolve to the newest available family model',async()=>{
  const llm={listModels:async provider=>{assert.equal(provider,'openai-codex');return ['gpt-6-luna','gpt-5.6-luna','gpt-6.9-luna','gpt-6.10-luna','gpt-99-luna-preview','gpt-6-sol','gpt-5.6-terra'].map(id=>({id}));}};
  for(const [family,expected] of [['luna','gpt-6.10-luna'],['sol','gpt-6-sol'],['terra','gpt-5.6-terra']]){
    assert.deepEqual(await resolveThreadModel({provider:'openai-codex',model:`__bees_latest_${family}__`},llm),{provider:'openai-codex',model:expected});
  }
  const explicit={provider:'openai-codex',model:'gpt-5.6-luna'};
  assert.equal(await resolveThreadModel(explicit,{}),explicit);
  assert.equal(await resolveThreadModel(null,{}),null);
  await assert.rejects(resolveThreadModel({provider:'openai-codex',model:'__bees_latest_luna__'},{listModels:async()=>[]}),/Choose a connected AI model/);
});

test('tool paths use actual DSH arguments and cannot escape through traversal or symlink parents',()=>{
  const root=mkdtempSync(join(tmpdir(),'bees-tool-fence-')),cwd=join(root,'run');mkdirSync(cwd);symlinkSync(root,join(cwd,'escape'),'dir');
  try{
    assert.equal(guardThreadTool({name:'read',arguments:{file_path:'inputs/invoice.txt'}},cwd),undefined);
    assert.match(guardThreadTool({name:'read',arguments:{file_path:'../secret'}},cwd),/Attach/);
    assert.match(guardThreadTool({name:'write',arguments:{file_path:'escape/new/secret'}},cwd),/Attach/);
    assert.match(guardThreadTool({name:'bash',arguments:{sandbox_permissions:'danger-full-access'}},cwd),/widen/);
    assert.equal(guardThreadTool({name:'mcp__mail__get',arguments:{path:'/api/messages'}},cwd),undefined);
  }finally{rmSync(root,{recursive:true,force:true});}
});
