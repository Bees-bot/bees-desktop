import { CronExpressionParser } from 'cron-parser';
import { threadError, text } from './thread-store.js';

export function schedule(input,after=new Date()){
  if(input===null)return null;
  const prompt=text(input.prompt),timezone=text(input.timezone??Intl.DateTimeFormat().resolvedOptions().timeZone,100);
  try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{throw threadError('Unknown timezone. Use a name like Asia/Kathmandu.');}
  let expression,fields={};
  const frequency=input.frequency??'daily';
  if(frequency==='hourly'){
    const minutes=Number(input.everyMinutes??60);if(!Number.isInteger(minutes)||minutes<1||minutes>525600)throw threadError('Invalid interval');
    return {prompt,frequency,everyMinutes:minutes,timezone,nextAt:new Date(after.getTime()+minutes*60000).toISOString(),enabled:true};
  }
  if(frequency==='advanced'){expression=text(input.cronExpression,200);if(expression.split(/\s+/).length!==5||/[H?]/i.test(expression))throw threadError('Use a five-field Unix cron expression');}
  else{
    const hour=Number(input.hour),minute=Number(input.minute??0);if(!Number.isInteger(hour)||hour<0||hour>23||!Number.isInteger(minute)||minute<0||minute>59)throw threadError('Invalid schedule time');
    if(!['daily','weekly','monthly'].includes(frequency))throw threadError('Invalid schedule frequency');
    const day=frequency==='monthly'?Number(input.dayOfMonth):'*';const weekday=frequency==='weekly'?Number(input.dayOfWeek):'*';
    if(frequency==='monthly'&&(!Number.isInteger(day)||day<1||day>31)||frequency==='weekly'&&(!Number.isInteger(weekday)||weekday<0||weekday>6))throw threadError('Invalid schedule day');
    expression=`${minute} ${hour} ${day} * ${weekday}`;
    // keep what the user picked so the settings form can show and resave it
    fields={hour,minute,...frequency==='weekly'&&{dayOfWeek:weekday},...frequency==='monthly'&&{dayOfMonth:day}};
  }
  const result={prompt,frequency,expression,timezone,enabled:true,...fields};return {...result,nextAt:nextOccurrence(result,after).toISOString()};
}
export function nextOccurrence(s,after){
  if(s.frequency==='hourly')return new Date(after.getTime()+s.everyMinutes*60000);
  try{return CronExpressionParser.parse(s.expression,{currentDate:after,tz:s.timezone}).next().toDate();}catch{throw threadError('The schedule has no valid next occurrence');}
}
