import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,symlinkSync,mkdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardThreadTool } from './thread-runner.js';

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
