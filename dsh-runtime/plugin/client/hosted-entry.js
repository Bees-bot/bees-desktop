import React from 'react';
import {createRoot} from 'react-dom/client';
import {configureRuntime,h} from './runtime.js';
import {ThreadApp} from './thread-app.js';
configureRuntime(name=>{
  if(name==='react')return React;
  if(name==='@deepseek-ai/dsh-client-ui-primitives')return {MarkdownText:({text})=>h('div',null,text)};
  throw Error('Unavailable browser module: '+name);
},{hosted:true});
createRoot(document.getElementById('bees-root')).render(h(ThreadApp));
