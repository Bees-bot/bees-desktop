import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ThreadStore, checkpointDigest } from './thread-store.js';

test('thread operations deduplicate and replicas cannot mutate owner state',()=>{
  const root=mkdtempSync(join(tmpdir(),'bees-threads-'));const a=new ThreadStore(join(root,'a'));const b=new ThreadStore(join(root,'b'));
  try{
    const doc=a.create('Invoices','alice');const op=randomUUID();a.message(doc.id,op,'Hello','alice');a.message(doc.id,op,'Hello','alice');
    assert.equal(a.get(doc.id).messages.length,1);
    const snapshot={...a.document(doc.id),shared:true};const authority={owner_client_id:a.clientId,owner_user_id:'alice',epoch:1};
    b.import(snapshot,authority);assert.throws(()=>b.message(doc.id,randomUUID(),'Forged','bob'),/owning client/);
    assert.throws(()=>b.import({...snapshot,ownerClientId:b.clientId},authority),/stale owner/);
    assert.throws(()=>b.import({...snapshot,title:'Conflicting revision'},authority),/Conflicting/);
  }finally{a.close();b.close();rmSync(root,{recursive:true,force:true});}
});
test('transfer requires intact files and an accepted ownership change',()=>{
  const root=mkdtempSync(join(tmpdir(),'bees-transfer-'));const a=new ThreadStore(join(root,'a'));const b=new ThreadStore(join(root,'b'));
  try{
    const doc=a.create('Report','alice');a.attach(doc.id,randomUUID(),'report.txt',Buffer.from('Private report'),'alice');
    assert.throws(()=>a.attach(doc.id,randomUUID(),'../escape',Buffer.from('x'),'alice'),/attachment/);
    const messageId=randomUUID();a.message(doc.id,messageId,'Before transfer','alice');
    a.mutate(doc.id,randomUUID(),d=>{d.shared=true;});const {document,digest}=a.prepareTransfer(doc.id);assert.equal(checkpointDigest(document),digest);
    assert.throws(()=>a.message(doc.id,randomUUID(),'Later','alice'),/transferred/);
    const prior={owner_client_id:a.clientId,owner_user_id:'alice',epoch:1};b.import(document,prior,{staged:true});
    const accepted={owner_client_id:b.clientId,owner_user_id:'bob',epoch:2};
    assert.throws(()=>b.activateTransfer(doc.id,accepted,digest),/not arrived/);
    const object=a.object(document,document.artifacts[0].id);b.putObject(object.bytes,object.artifact.digest);
    assert.throws(()=>b.activateTransfer(doc.id,prior,digest),/not been accepted/);
    b.activateTransfer(doc.id,accepted,digest);b.message(doc.id,messageId,'Before transfer','alice');assert.equal(b.get(doc.id).messages.length,1);
    b.message(doc.id,randomUUID(),'Received','bob');assert.equal(b.get(doc.id).ownerClientId,b.clientId);
  }finally{a.close();b.close();rmSync(root,{recursive:true,force:true});}
});
