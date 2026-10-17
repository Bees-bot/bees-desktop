import {test} from 'node:test';
import assert from 'node:assert/strict';
import {schedule,nextOccurrence} from './thread-schedule.js';
test('thread schedules validate and keep timezone-aware occurrence times',()=>{
  const daily=schedule({prompt:'Daily report',frequency:'daily',hour:9,timezone:'America/Los_Angeles'},new Date('2026-10-17T00:00:00Z'));
  assert.equal(daily.nextAt,'2026-10-17T16:00:00.000Z');
  assert.equal(nextOccurrence(daily,new Date(daily.nextAt)).toISOString(),'2026-10-18T16:00:00.000Z');
  assert.throws(()=>schedule({prompt:'x',frequency:'daily',hour:24,timezone:'UTC'}),/schedule time/);
  assert.throws(()=>schedule({prompt:'x',frequency:'advanced',cronExpression:'* * * * * *',timezone:'UTC'}),/five-field/);
});
