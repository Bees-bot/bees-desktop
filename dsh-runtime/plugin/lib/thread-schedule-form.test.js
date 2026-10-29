import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {configureRuntime} from '../client/runtime.js';
import {scheduleDraft,scheduleSummary,ScheduleSettings} from '../client/thread-schedule-form.js';
import {schedule} from './thread-schedule.js';

const configure=react=>configureRuntime(name=>({react,'react-dom':{},'@deepseek-ai/dsh-client-ui-primitives':{}})[name],{hosted:true});
configure(React);
const nodes=node=>!React.isValidElement(node)?[]:[node,...React.Children.toArray(node.props.children).flatMap(nodes)];

test('schedule editor restores saved timing, timezone, and custom expressions',()=>{
  for(const input of [
    {frequency:'daily',hour:0,minute:15},
    {frequency:'weekly',hour:17,minute:30,dayOfWeek:0},
    {frequency:'monthly',hour:9,minute:0,dayOfMonth:31},
    {frequency:'hourly',everyMinutes:75},
    {frequency:'advanced',cronExpression:'0 9 * * 1-5'},
  ]){
    const saved=schedule({prompt:'Prepare a status report',timezone:'Asia/Kathmandu',...input});
    const draft=scheduleDraft(saved),restored=schedule(draft);
    for(const key of ['frequency','hour','minute','dayOfWeek','dayOfMonth','everyMinutes','expression','timezone','prompt'])assert.equal(restored[key],saved[key],`${input.frequency}: ${key}`);
    const markup=renderToStaticMarkup(React.createElement(ScheduleSettings,{thread:{title:'Status report',schedule:saved}}));
    assert(markup.includes('Save schedule'));assert(markup.includes('Next saved run:'));
    assert.match(markup,new RegExp(`aria-pressed="true">${({daily:'Daily',weekly:'Weekly',monthly:'Monthly',hourly:'Interval',advanced:'Custom'})[input.frequency]}<`));
  }
  assert.equal(scheduleSummary(scheduleDraft({frequency:'weekly',hour:0,minute:5,dayOfWeek:0,timezone:'UTC'})),'Every Sunday at 00:05 · UTC');
  assert.equal(scheduleSummary(scheduleDraft({frequency:'hourly',everyMinutes:75})),'Every 75 minutes');
});

test('saving, pausing, and resuming keep the schedule prompt and timing',()=>{
  const saved=schedule({prompt:'Weekly report',frequency:'weekly',dayOfWeek:2,hour:9,minute:45,timezone:'America/Los_Angeles'});
  const states=[];let index=0;const calls=[];
  configure({...React,useState:initial=>{
    const key=index++;if(!(key in states))states[key]=typeof initial==='function'?initial():initial;
    return [states[key],value=>{states[key]=typeof value==='function'?value(states[key]):value;}];
  },useId:()=> 'timezone-test'});
  const render=()=>{index=0;return ScheduleSettings({thread:{title:'Report',schedule:saved},onSave:value=>calls.push(value)});};
  try{
    nodes(render()).find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:false}});
    render().props.onSubmit({preventDefault(){}});
    assert.equal(calls[0].schedule.enabled,false);
    for(const key of ['prompt','frequency','dayOfWeek','hour','minute','timezone'])assert.equal(calls[0].schedule[key],saved[key]);
    nodes(render()).find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:true}});
    render().props.onSubmit({preventDefault(){}});
    assert.equal(calls[1].schedule.enabled,true);
    assert.equal(calls[1].schedule.prompt,'Weekly report');
    nodes(render()).find(node=>node.type==='button'&&node.props.children==='Interval').props.onClick();
    nodes(render()).find(node=>node.type==='input'&&node.props.type==='number').props.onChange({target:{value:'90'}});
    render().props.onSubmit({preventDefault(){}});
    assert.equal(schedule(calls[2].schedule).everyMinutes,90);
  }finally{configure(React);}
});

test('new schedules show controls immediately and read-only schedules cannot be saved',()=>{
  const markup=renderToStaticMarkup(React.createElement(ScheduleSettings,{thread:{title:'New work'}}));
  for(const label of ['What should Bees do each time?','Local time','Timezone','Create schedule'])assert(markup.includes(label),label);
  const readOnly=renderToStaticMarkup(React.createElement(ScheduleSettings,{thread:{title:'Shared work'},disabled:true}));
  assert.match(readOnly,/<fieldset[^>]*disabled/);assert.doesNotMatch(readOnly,/type="submit"/);
});
