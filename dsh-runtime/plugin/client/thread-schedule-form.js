import { h, React, useState } from './runtime.js';
import { when } from './common.js';

export function scheduleDraft(schedule) {
  const [minute, hour, dayOfMonth, , dayOfWeek] = (schedule?.expression ?? '0 9 * * *').split(/\s+/);
  return { frequency: 'daily', hour: Number(hour) || 0, minute: Number(minute) || 0,
    dayOfWeek: /^\d$/.test(dayOfWeek) ? Number(dayOfWeek) : 1,
    dayOfMonth: /^\d+$/.test(dayOfMonth) ? Number(dayOfMonth) : 1,
    everyMinutes: 60, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, prompt: '',
    ...schedule, cronExpression: schedule?.expression ?? '0 9 * * *' };
}
const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const frequencies=[['hourly','Interval'],['daily','Daily'],['weekly','Weekly'],['monthly','Monthly'],['advanced','Custom']];

export function scheduleSummary(draft){
  const time=`${String(draft.hour).padStart(2,'0')}:${String(draft.minute).padStart(2,'0')}`;
  if(draft.frequency==='hourly')return `Every ${draft.everyMinutes} minutes`;
  const repeat=draft.frequency==='weekly'?`Every ${weekdays[draft.dayOfWeek]} at ${time}`
    :draft.frequency==='monthly'?`On day ${draft.dayOfMonth} of each month at ${time}`
    :draft.frequency==='advanced'?`Custom schedule: ${draft.cronExpression}`:`Every day at ${time}`;
  return `${repeat} · ${draft.timezone}`;
}

export function ScheduleSettings({thread,scope='thread',disabled=false,busy=false,onSave}){
  const [draft,setDraft]=useState(()=>scheduleDraft(thread.schedule));
  const [enabled,setEnabled]=useState(thread.schedule?.enabled??true);
  const timezoneList=React.useId();
  const update=(key,value)=>setDraft(current=>({...current,[key]:value}));
  const time=`${String(draft.hour).padStart(2,'0')}:${String(draft.minute).padStart(2,'0')}`;
  return h('form',{className:'bc-form bc-schedule',onSubmit:event=>{event.preventDefault();if(!disabled&&!busy)onSave({schedule:{...draft,enabled}});}},
    h('header',{className:'bc-schedule-header'},
      h('div',null,h('h3',null,scope==='team'?'Team schedule':'Schedule this thread'),h('p',{className:'bc-muted'},thread.title)),
      thread.schedule?h('span',{className:'bc-schedule-status'},thread.schedule.enabled?'Scheduled':'Paused'):null),
    h('p',{className:'bc-muted'},scope==='team'?'Repeat work in a dedicated thread for this team.':'Run this thread’s process automatically, keeping its conversation and files.'),
    thread.schedule?.error?h('p',{className:'bc-error',role:'status'},thread.schedule.error):null,
    disabled?h('p',{className:'bc-muted'},`Only the ${scope==='team'?'team':'thread'} owner can change this schedule.`):null,
    h('fieldset',{className:'bc-form bc-fieldset',disabled:disabled||busy},
      h('label',{className:'bc-field'},h('span',null,'What should Bees do each time?'),
        h('input',{value:draft.prompt,required:true,pattern:'.*\\S.*',title:'Say what Bees should do each time.',placeholder:'For example, prepare my weekly status report',onChange:event=>update('prompt',event.target.value)})),
      h('div',{className:'bc-field'},h('span',null,'Repeats'),h('div',{className:'bc-schedule-frequency',role:'group','aria-label':'Schedule frequency'},
        frequencies.map(([value,label])=>h('button',{key:value,type:'button','aria-pressed':draft.frequency===value,onClick:()=>update('frequency',value)},label)))),
      h('div',{className:'bc-schedule-fields'},
        draft.frequency==='hourly'?h('label',{className:'bc-field'},h('span',null,'Minutes between runs'),h('input',{type:'number',min:1,max:525600,required:true,value:draft.everyMinutes,onChange:event=>update('everyMinutes',Number(event.target.value))}))
        :draft.frequency==='advanced'?h('label',{className:'bc-field'},h('span',null,'Five-field cron expression'),h('input',{value:draft.cronExpression,required:true,placeholder:'0 9 * * 1-5',onChange:event=>update('cronExpression',event.target.value)}),h('small',null,'Minute · hour · day of month · month · day of week'))
        :h(React.Fragment,null,
          draft.frequency==='weekly'?h('label',{className:'bc-field'},h('span',null,'Day'),h('select',{value:draft.dayOfWeek,onChange:event=>update('dayOfWeek',Number(event.target.value))},weekdays.map((day,index)=>h('option',{key:day,value:index},day)))):null,
          draft.frequency==='monthly'?h('label',{className:'bc-field'},h('span',null,'Day of month'),h('input',{type:'number',min:1,max:31,required:true,value:draft.dayOfMonth,onChange:event=>update('dayOfMonth',Number(event.target.value))}),h('small',null,'Months without this day are skipped.')):null,
          h('label',{className:'bc-field'},h('span',null,'Local time'),h('input',{type:'time',required:true,value:time,onChange:event=>{const [hour,minute]=event.target.value.split(':').map(Number);setDraft(current=>({...current,hour,minute}));}}))),
        draft.frequency!=='hourly'?h('label',{className:'bc-field'},h('span',null,'Timezone'),h('input',{list:timezoneList,value:draft.timezone,required:true,onChange:event=>update('timezone',event.target.value)}),
          h('datalist',{id:timezoneList},(Intl.supportedValuesOf?.('timeZone')??[]).map(zone=>h('option',{key:zone,value:zone})))):null),
      h('div',{className:'bc-schedule-preview','aria-live':'polite'},h('strong',null,scheduleSummary(draft)),
        thread.schedule?.enabled&&thread.schedule.nextAt?h('p',{className:'bc-muted'},'Next saved run: '+when(thread.schedule.nextAt)):null,
        draft.frequency==='hourly'?h('small',null,'The interval starts when you save the schedule.'):null),
      h('label',{className:'bc-check'},h('input',{type:'checkbox',checked:enabled,onChange:event=>setEnabled(event.target.checked)}),'Run automatically',!enabled?h('small',null,'Paused — the prompt and timing will be kept.'):null),
      h('p',{className:'bc-muted'},`Runs on the ${scope==='team'?'team':'thread'} owner’s computer while Bees is running there.`),
      disabled?null:h('div',{className:'bc-actions'},h('button',{className:'bc-primary',type:'submit'},busy?'Saving…':thread.schedule?'Save schedule':'Create schedule'))));
}
