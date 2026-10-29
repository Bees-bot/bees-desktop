import React from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives';
import {configureRuntime,h} from './runtime.js';
import {ThreadApp} from './thread-app.js';
import brandMark from '../../../src/brand-mark.png';
import {css} from './common.js';
import {installScrollbars} from './scrollbars.js';
// the desktop plugin adds these, so pop-ups and scrollbars went unstyled on the web; pop-ups sit on body, outside the app font
document.head.append(Object.assign(document.createElement('style'),{textContent:css+"body{font:14px/1.6 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}"}));installScrollbars(document);
configureRuntime(name=>{
  if(name==='react')return React;
  if(name==='react-dom')return {createPortal};
  if(name==='@deepseek-ai/dsh-client-ui-primitives')return primitives;
  throw Error('Unavailable browser module: '+name);
},{hosted:true});
createRoot(document.getElementById('bees-root')).render(h(ThreadApp,{brandMark}));
