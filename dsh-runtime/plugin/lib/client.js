"use strict";
(() => {
  // dsh-runtime/plugin/client/runtime.js
  var React;
  var h;
  var useEffect;
  var useMemo;
  var useRef;
  var useState;
  var MarkdownText;
  var PendingQuestion;
  var LocalAiController;
  var LocalAiSettings;
  var ExternalLocalAiSettings;
  var FreeAiController;
  var FreeAiSettings;
  var CustomAiSettings;
  var SubscriptionSettings;
  function configureRuntime(require2) {
    React = require2("react");
    h = React.createElement;
    ({ useEffect, useMemo, useRef, useState } = React);
    ({ MarkdownText } = require2("@deepseek-ai/dsh-client-ui-primitives"));
    ({ PendingQuestion } = require2("@deepseek-ai/dsh-client-ui-user-questions"));
    ({ LocalAiController, LocalAiSettings, ExternalLocalAiSettings } = require2("@bees/dsh-local-ai"));
    ({ FreeAiController, FreeAiSettings } = require2("@bees/dsh-free-ai"));
    ({ CustomAiSettings } = require2("@bees/dsh-custom-ai"));
    ({ SubscriptionSettings } = require2("@bees/dsh-subscriptions"));
  }

  // dsh-runtime/plugin/client/icons.js
  function Icon({ d, polyline, rect, circle, size = 18 }) {
    const children = [];
    if (d) {
      (Array.isArray(d) ? d : [d]).forEach((pathData, i) => {
        children.push(h("path", { d: pathData, key: `path-${i}` }));
      });
    }
    if (polyline) {
      (Array.isArray(polyline) ? polyline : [polyline]).forEach((points, i) => {
        children.push(h("polyline", { points, key: `polyline-${i}` }));
      });
    }
    if (rect) {
      (Array.isArray(rect) ? rect : [rect]).forEach((props, i) => {
        children.push(h("rect", { ...props, key: `rect-${i}` }));
      });
    }
    if (circle) {
      (Array.isArray(circle) ? circle : [circle]).forEach((props, i) => {
        children.push(h("circle", { ...props, key: `circle-${i}` }));
      });
    }
    return h("svg", {
      xmlns: "http://www.w3.org/2000/svg",
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }, ...children);
  }
  var HomeIcon = () => h(Icon, { d: ["m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"], polyline: "9 22 9 12 15 12 15 22" });
  var WorkIcon = () => h(Icon, { d: "M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16", rect: { width: "20", height: "14", x: "2", y: "7", rx: "2", ry: "2" } });
  var AgentsIcon = () => h(Icon, { d: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"], circle: { cx: "9", cy: "7", r: "4" } });
  var ProcessesIcon = () => h(Icon, { d: ["M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z", "m3.3 7 8.7 5 8.7-5", "M12 22V12"] });
  var FilesIcon = () => h(Icon, { d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" });
  var ActivityIcon = () => h(Icon, { circle: { cx: "12", cy: "12", r: "10" }, polyline: "12 6 12 12 16 14" });
  var KnowledgeIcon = () => h(Icon, { circle: { cx: "11", cy: "11", r: "8" }, d: "m21 21-4.3-4.3" });
  var SettingsIcon = () => h(Icon, { circle: { cx: "12", cy: "12", r: "3" }, d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" });
  var PinIcon = ({ active }) => h("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: active ? "currentColor" : "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, h("line", { x1: "12", y1: "17", x2: "12", y2: "22" }), h("path", { d: "M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.68V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3v4.68a2 2 0 0 1-1.11 1.87l-1.78.9A2 2 0 0 0 5 15.24Z" }));
  var BookIcon = () => h(Icon, { d: ["M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"] });

  // dsh-runtime/plugin/client/shared.js
  var NAVIGATION = [
    { id: "home", label: "Home", icon: HomeIcon, defaultChild: "home", children: [] },
    { id: "work", label: "Work", icon: WorkIcon, defaultChild: "all-work", children: [
      ["all-work", "All work"],
      ["goals", "Goals"],
      ["waiting", "Needs you"],
      ["completed", "Completed"]
    ] },
    { id: "agents", label: "Agents", icon: AgentsIcon, defaultChild: "all-agents", children: [
      ["all-agents", "All agents"],
      ["pools", "Pools"],
      ["skills", "Skills & tools"]
    ] },
    { id: "processes", label: "Processes", icon: ProcessesIcon, defaultChild: "all-processes", children: [
      ["all-processes", "All processes"],
      ["templates", "Templates"]
    ] },
    { id: "files", label: "Files & Folders", icon: FilesIcon, defaultChild: "locations", children: [
      ["locations", "Locations"],
      ["mappings", "My mappings"],
      ["references", "References"]
    ] },
    { id: "activity", label: "Activity", icon: ActivityIcon, defaultChild: "runs", children: [
      ["runs", "Runs"],
      ["evaluations", "Evaluations"],
      ["audit", "Audit"]
    ] },
    { id: "knowledge", label: "Knowledge", icon: KnowledgeIcon, defaultChild: "search", children: [
      ["search", "Search"],
      ["sources", "Sources"],
      ["artifacts", "Artifacts"]
    ] },
    { id: "settings", label: "Settings", icon: SettingsIcon, defaultChild: "personal-ai", children: [
      ["personal-ai", "AI connections"],
      ["appearance", "Appearance"],
      ["organizations", "Organizations & invitations"],
      ["organization-settings", "Organization"],
      ["team-settings", "Team"],
      ["workspace-settings", "Workspace"],
      ["connections", "Connections"],
      ["permissions", "Permissions"],
      ["dsh-settings", "DSH settings"]
    ] }
  ];
  var THEMES = [
    ["light", "Light"],
    ["dark", "Dark"],
    ["system", "System"]
  ];
  var css = `

  .bees-home-layout { display: grid; grid-template-columns: 1.6fr 1fr; gap: 40px; min-height: 100%; align-items: start; padding: 24px 0; }
  .bees-home-main { display: flex; flex-direction: column; gap: 32px; min-width: 0; }
  .bees-home-side { display: flex; flex-direction: column; gap: 16px; min-height: calc(100vh - 106px); min-width: 0; }
  .bees-home-side h3 { margin: 0; font-size: 16px; font-weight: 700; }
  
  .bees-hero { display: flex; flex-direction: column; gap: 20px; }
  .bees-hero-head { display: flex; flex-direction: column; gap: 8px; }
  .bees-hero h1 { font-size: 32px; font-weight: 800; line-height: 1.2; margin: 0; }
  .bees-hero-desc { margin: 0; font-size: 15px; color: var(--dsw-alias-label-secondary); }
  
  .bees-composer { display: flex; flex-direction: column; gap: 12px; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px; padding: 16px; box-shadow: 0 4px 12px #0000000a; transition: border-color 0.2s, box-shadow 0.2s; }
  .bees-composer:focus-within { border-color: #f2b84b; box-shadow: 0 4px 20px #00000014; }
  .bees-composer-input { border: 0; background: transparent; font-size: 16px; min-height: 120px; outline: none; resize: vertical; font-family: inherit; color: inherit; line-height: 1.5; padding: 0; }
  .bees-composer-input::placeholder { color: var(--dsw-alias-label-secondary); }
  .bees-composer-foot { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  .bees-composer-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); }
  
  .bees-home-section { display: flex; flex-direction: column; gap: 12px; }
  .bees-home-section h3 { margin: 0; font-size: 16px; font-weight: 700; }
  
  .bees-work-list { display: grid; gap: 12px; }
  .bees-work-card { display: flex; flex-direction: column; gap: 6px; padding: 16px; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; cursor: pointer; text-align: left; transition: border-color 0.2s, box-shadow 0.2s; color: inherit; font: inherit; box-shadow: 0 2px 8px #00000006; }
  .bees-work-card:hover { border-color: #f2b84b; }
  .bees-work-card-title { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bees-work-card-meta { font-size: 12px; color: var(--dsw-alias-label-secondary); text-transform: capitalize; }
  
  .bees-home-templates { display: grid; gap: 12px; }
  .bees-template-card { display: flex; flex-direction: column; gap: 6px; padding: 16px; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; cursor: pointer; text-align: left; transition: border-color 0.2s, box-shadow 0.2s; color: inherit; font: inherit; box-shadow: 0 2px 8px #00000006; }
  .bees-template-card:hover { border-color: #f2b84b; }
  .bees-template-card-title { font-weight: 600; font-size: 14px; }
  .bees-template-card-meta { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.4; }
  
  @media(max-width: 900px) {
    .bees-home-layout { grid-template-columns: 1fr; }
    .bees-home-side { min-height: auto; }
  }

  .bees-app{position:absolute;inset:0;z-index:90;display:grid;grid-template-columns:240px 1fr;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji";pointer-events:auto}
  .bees-app *{box-sizing:border-box}.bees-sidebar{min-width:0;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-sidebar-fill);overflow:visible}.bees-brand{display:flex;align-items:center;gap:8px;padding:18px 16px 10px;font-size:19px;font-weight:800}.bees-mark{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:#f2b84b;color:#21190b}.bees-context-switcher{position:relative;margin:0 12px 11px}.bees-context-switcher summary{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);cursor:pointer;list-style:none;box-shadow:0 1px 2px #0001}.bees-context-switcher summary::-webkit-details-marker{display:none}.bees-context-summary{min-width:0;flex:1}.bees-context-primary,.bees-context-secondary{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-context-primary{font-weight:750}.bees-context-secondary{color:var(--dsw-alias-label-secondary);font-size:11px}.bees-context-arrow{color:var(--dsw-alias-label-secondary)}.bees-context-panel{position:absolute;top:calc(100% + 6px);left:0;z-index:20;width:100%;max-height:430px;overflow:auto;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);box-shadow:0 14px 35px #0004}.bees-context-search{margin-bottom:7px}.bees-context-section{display:grid;gap:2px;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l1)}.bees-context-section:first-of-type{border-top:0}.bees-context-label{padding:2px 7px;color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:750;text-transform:uppercase;letter-spacing:.05em}.bees-context-option{display:flex;align-items:center;gap:7px;width:100%;padding:7px;border:0;border-radius:7px;color:inherit;background:transparent;text-align:left;font:inherit;cursor:pointer}.bees-context-option:hover,.bees-context-option.active{background:var(--dsw-alias-interactive-bg-hover)}.bees-context-check{width:14px}.bees-context-add{color:var(--dsw-alias-label-secondary)}
  .bees-nav{display:grid;gap:2px;padding:0 8px 12px;position:relative;min-width:0}.bees-nav-separator{height:1px;background:var(--dsw-alias-border-l1);margin:8px 6px}.bees-nav-group{padding:7px 6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);min-width:0}.bees-nav-group-head,.bees-nav-menu{display:flex;align-items:center;position:relative;border-radius:8px;transition:background 0.1s}.bees-nav-group-head:hover,.bees-nav-menu:hover,.bees-nav-group-head.active,.bees-nav-menu.active{background:var(--dsw-alias-interactive-bg-hover)}.bees-nav-group-head .bees-nav-link,.bees-nav-menu .bees-nav-link{min-width:0;flex:1}.bees-nav-link{min-width:0;display:flex;align-items:center;gap:9px;width:100%;border:0;border-radius:8px;padding:7px 9px;color:inherit;background:transparent;text-align:left;font:inherit;cursor:pointer}.bees-nav-link.active{font-weight:750}.bees-nav-link span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}.bees-nav-child{display:block;padding-left:31px;font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-nav-record{display:block;padding-left:31px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-nav-record:hover,.bees-nav-record.active{background:var(--dsw-alias-interactive-bg-hover)}.bees-nav-pin{display:grid;place-items:center;flex:0 0 28px;width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;opacity:0}.bees-nav-pin:focus-visible,.bees-nav-group-head:hover .bees-nav-pin,.bees-nav-group-head.active .bees-nav-pin,.bees-nav-menu:hover .bees-nav-pin,.bees-nav-menu.active .bees-nav-pin,.bees-nav-flyout-item:hover .bees-nav-pin,.bees-nav-flyout-item.active .bees-nav-pin,.bees-nav-pin.active{opacity:1}.bees-nav-pin.active{opacity:0.55}.bees-nav-pin:hover,.bees-nav-pin.active:hover,.bees-nav-pin:focus-visible{background:var(--dsw-alias-interactive-bg-hover);opacity:1}.bees-nav-standard{margin-top:6px;min-width:0}.bees-sidebar-foot{margin-top:auto;padding:10px 12px}.bees-sidebar-foot .bees-nav-link.active{background:var(--dsw-alias-interactive-bg-hover)}
  .bees-nav-flyout{position:absolute;left:calc(100% - 4px);top:0;z-index:100;min-width:180px;display:grid;gap:2px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);box-shadow:0 8px 30px #0003;pointer-events:none;opacity:0;transition:opacity 0.1s}.bees-nav-menu:hover .bees-nav-flyout,.bees-nav-menu:focus-within .bees-nav-flyout{pointer-events:auto;opacity:1}.bees-nav-flyout-item{display:flex;align-items:center;border-radius:8px}.bees-nav-flyout-item:hover,.bees-nav-flyout-item.active{background:var(--dsw-alias-interactive-bg-hover)}.bees-nav-flyout-item .bees-nav-link{padding-left:9px;font-size:13px;color:var(--dsw-alias-label-primary)}
  .bees-main{min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}.bees-top{height:58px;display:flex;align-items:center;gap:8px;padding:0 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-title{font-size:17px;font-weight:800}.bees-context{color:var(--dsw-alias-label-secondary);font-size:12px}.bees-grow{flex:1}.bees-theme-toggle{display:grid;place-items:center;flex:none;width:34px;height:34px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-button-elevated-fill);cursor:pointer}.bees-theme-toggle:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-floating-hover)}.bees-theme-toggle svg{width:16px;height:16px}.bees-theme-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.bees-content{min-height:0;flex:1;overflow:auto;padding:22px}.bees-panel{max-width:1050px;margin:0 auto}.bees-panel-wide{max-width:none}
  .bees-btn,.bees-select,.bees-input,.bees-textarea{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;background:var(--dsw-alias-button-elevated-fill);font:inherit}.bees-btn{padding:7px 11px;cursor:pointer}.bees-btn:hover{background:var(--dsw-alias-button-floating-hover)}.bees-btn.primary{background:#f2b84b;color:#21190b;border-color:#f2b84b;font-weight:700}.bees-btn.danger{color:#d15353}.bees-btn:disabled{opacity:.5;cursor:not-allowed}.bees-select,.bees-input,.bees-textarea{padding:8px 9px}.bees-input,.bees-textarea{width:100%}.bees-textarea{min-height:88px;resize:vertical}
  .bees-row{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-row-main{min-width:0;flex:1}.bees-row-title{font-weight:700}.bees-muted{color:var(--dsw-alias-label-secondary);font-size:12px}.bees-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px}.bees-box{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:15px;background:var(--dsw-specific-sidebar-fill)}.bees-box h2,.bees-box h3{margin:0 0 9px}.bees-empty{border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;padding:28px;text-align:center;color:var(--dsw-alias-label-secondary)}.bees-error{margin:10px 18px 0;padding:9px 12px;border-radius:8px;background:#a9363622;color:#d45d5d}.bees-status{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--dsw-alias-label-secondary)}.bees-running{color:#2e9b61}.bees-failed,.bees-interrupted{color:#cf5b5b}
  .bees-hero h1{font-size:32px;line-height:1.15;margin:0 0 10px}.bees-hero form{display:flex;gap:8px;margin-top:20px}.bees-hero .bees-input{font-size:16px}.bees-proposals{margin-top:18px}.bees-change{margin:7px 0;padding:9px;border-radius:8px;background:var(--dsw-alias-bg-base)}
  .bees-board{display:grid;grid-auto-columns:minmax(250px,1fr);grid-auto-flow:column;gap:12px;overflow-x:auto}.bees-column{min-height:260px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-sidebar-fill)}.bees-column-head{display:flex;padding:12px;border-bottom:1px solid var(--dsw-alias-border-l1);font-weight:750}.bees-count{margin-left:auto;color:var(--dsw-alias-label-secondary)}.bees-cards{display:grid;gap:8px;padding:9px}.bees-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:11px;background:var(--dsw-alias-bg-base)}.bees-card h3{margin:0 0 4px}.bees-card p{white-space:pre-wrap;color:var(--dsw-alias-label-secondary);font-size:12px}.bees-card-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.bees-card-actions .bees-btn{padding:4px 7px;font-size:11px}
  .bees-create{position:relative}.bees-create[open] summary{background:var(--dsw-alias-interactive-bg-hover)}.bees-create summary{list-style:none}.bees-menu{position:absolute;right:0;top:42px;z-index:5;min-width:190px;display:grid;gap:3px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);box-shadow:0 14px 35px #0004}.bees-menu .bees-nav-link{padding:8px}.bees-search{display:flex;gap:8px;margin-bottom:16px}
  .bees-prompt{width:min(540px,calc(100vw - 32px));color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:0;box-shadow:0 18px 60px #0006}.bees-prompt::backdrop{background:#0008}.bees-prompt form{display:grid;gap:14px;padding:20px}.bees-prompt label{white-space:pre-wrap;font-weight:700}.bees-prompt-actions{display:flex;justify-content:flex-end;gap:8px}
  .bees-transcript{display:grid;gap:10px;margin-top:14px}.bees-message{padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-specific-sidebar-fill);white-space:pre-wrap}.bees-message strong{display:block;margin-bottom:5px;text-transform:capitalize}.bees-loading{grid-column:1/-1;display:grid;place-items:center;height:100%;color:var(--dsw-alias-label-secondary)}
  .bees-stack{display:grid;gap:12px}.bees-form{display:grid;gap:10px}.bees-form>label{display:grid;gap:5px}.bees-form-row{display:flex;align-items:end;gap:8px;flex-wrap:wrap}.bees-form-row label{display:grid;gap:5px;min-width:160px;flex:1}.bees-form-row .bees-btn{flex:0 0 auto}.bees-badge{display:inline-flex;padding:2px 7px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:10px;text-transform:uppercase}.bees-segmented{display:flex;gap:7px;flex-wrap:wrap}.bees-segmented .active{border-color:#f2b84b;background:#f2b84b22}.bees-section-title{margin:20px 0 8px}.bees-section-title:first-child{margin-top:0}.bees-page-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}.bees-page-head h2{margin:0}.bees-callout{margin-bottom:14px;padding:12px 14px;border-left:3px solid #f2b84b;border-radius:8px;background:#f2b84b12}.bees-callout h3{margin:0 0 4px}.bees-help-grid h3{margin-bottom:4px}.bees-system-default{border:2px solid #f2b84b;background:linear-gradient(135deg,#f2b84b18,transparent 65%)}.bees-system-default form{display:grid;grid-template-columns:minmax(260px,2fr) minmax(190px,1fr) auto;gap:10px;align-items:end}.bees-system-default label{display:grid;gap:5px}.bees-system-default .bees-btn{margin-bottom:1px}.bees-danger-zone{margin-top:16px;border-color:#d1535355}
  .bees-cockpit-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}.bees-cockpit-head h2{margin:0}.bees-cockpit-board{margin-bottom:16px}.bees-hierarchy-card{display:block;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:11px;color:inherit;background:var(--dsw-alias-bg-base);text-align:left;font:inherit;cursor:pointer}.bees-hierarchy-card:hover,.bees-hierarchy-card.active{border-color:#f2b84b;background:#f2b84b12}.bees-hierarchy-card h3{margin:0 0 4px}.bees-lineage{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-cockpit-detail{display:block}.bees-tabs{display:flex;gap:4px;margin:-5px -5px 14px;padding:5px;overflow-x:auto;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-tab{flex:none;padding:7px 10px;border:0;border-radius:8px;color:var(--dsw-alias-label-secondary);background:transparent;font:inherit;cursor:pointer}.bees-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}.bees-tab.active{color:var(--dsw-alias-label-primary);background:#f2b84b22;font-weight:750}.bees-tab:focus-visible{outline:2px solid #f2b84b;outline-offset:1px}.bees-tab-panel{min-height:220px}.bees-detail-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}.bees-run-list{display:grid;gap:6px}.bees-run-row{display:flex;align-items:center;gap:8px;width:100%;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;color:inherit;background:transparent;text-align:left;cursor:pointer}.bees-run-row.active{border-color:#f2b84b}.bees-audit{border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-audit>summary{cursor:pointer;list-style-position:inside}.bees-audit>summary:hover{background:var(--dsw-alias-interactive-bg-hover)}.bees-audit>summary span{display:block}.bees-audit-detail{padding:0 12px 12px 27px}.bees-audit-detail pre{margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.bees-agent-form textarea{min-height:180px}
  .bees-subagent-card{cursor:default}.bees-subagent-card:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}
  .bees-inbox{display:grid;grid-template-columns:minmax(230px,.72fr) minmax(360px,1.28fr);gap:12px;align-items:start}.bees-inbox-list{display:grid;gap:7px}.bees-inbox-row{display:grid;grid-template-columns:10px minmax(0,1fr) auto;align-items:center;gap:9px;width:100%;padding:11px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;color:inherit;background:var(--dsw-specific-sidebar-fill);text-align:left;font:inherit;cursor:pointer}.bees-inbox-row:hover,.bees-inbox-row.active{border-color:#f2b84b;background:#f2b84b12}.bees-inbox-dot{width:8px;height:8px;border-radius:50%;background:#f2b84b}.bees-inbox-copy{min-width:0}.bees-inbox-copy strong,.bees-inbox-copy span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-answer-card{display:grid;gap:14px;min-height:270px}.bees-answer-head{display:flex;align-items:flex-start;gap:10px}.bees-answer-head h2{margin:2px 0 0;font-size:20px}.bees-question-detail{padding:10px 12px;border-radius:9px;background:var(--dsw-alias-bg-base)}.bees-question-options{display:grid;gap:8px}.bees-choice{display:flex;align-items:flex-start;gap:9px;width:100%;padding:11px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;color:inherit;background:var(--dsw-alias-bg-base);text-align:left;font:inherit;cursor:pointer}.bees-choice:hover,.bees-choice.selected{border-color:#f2b84b;background:#f2b84b16}.bees-choice-mark{display:grid;place-items:center;flex:0 0 22px;height:22px;border-radius:7px;background:var(--dsw-alias-interactive-bg-hover);font-size:11px}.bees-choice.selected .bees-choice-mark{background:#f2b84b;color:#21190b}.bees-choice-copy{display:grid;gap:2px}.bees-answer-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.bees-file-list{display:flex;gap:6px;flex-wrap:wrap;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}.bees-file-chip{max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-file-chip.active{border-color:#f2b84b;background:#f2b84b16}.bees-file-preview{min-height:130px;max-height:460px;overflow:auto;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base)}.bees-file-preview-head{margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-file-preview pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}.bees-blocked{margin-top:18px}
  .bees-workspace-layout{display:grid;grid-template-columns:1fr 340px;gap:12px;align-items:start}.bees-convo-panel{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-sidebar-fill);height:600px;overflow:hidden}.bees-convo-history{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:16px;scroll-behavior:smooth}.bees-convo-composer{padding:12px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}.bees-convo-msg{padding:10px 14px;border-radius:12px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);max-width:85%}.bees-convo-msg.user{align-self:flex-end;background:#f2b84b22;border-color:#f2b84b}.bees-convo-msg.agent{align-self:flex-start}.bees-convo-msg.system{align-self:center;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary);background:transparent;border:none}.bees-details-panel{display:flex;flex-direction:column;gap:12px}
  @media(max-width:780px){.bees-app{grid-template-columns:76px 1fr}.bees-brand span:last-child,.bees-nav-link span:last-child,.bees-nav-child,.bees-nav-pin{display:none}.bees-brand{justify-content:center;padding-inline:8px}.bees-context-switcher{margin-inline:8px}.bees-context-switcher summary{justify-content:center;padding-inline:6px}.bees-context-summary{display:none}.bees-context-panel{position:fixed;top:54px;left:82px;width:260px}.bees-nav-link{justify-content:center}.bees-content{padding:12px}.bees-hero{padding:20px}.bees-hero form,.bees-system-default form{grid-template-columns:1fr}.bees-cockpit-detail,.bees-inbox,.bees-workspace-layout{grid-template-columns:1fr}}
`;
  async function request2(path, options) {
    const response = await fetch(path, {
      ...options,
      headers: { "content-type": "application/json", ...options?.headers ?? {} }
    });
    const value = response.status === 204 ? {} : await response.json();
    if (!response.ok) throw new Error(value.error?.message ?? value.error ?? `Request failed (${response.status})`);
    return value;
  }
  async function openExternal(url) {
    const invoke = window.__TAURI__?.core?.invoke;
    if (invoke) return invoke("open_external_url", { url });
    if (!window.open(url, "_blank", "noopener,noreferrer")) throw new Error("Your browser blocked the website window");
  }
  var collaboration = (action, values = {}) => request2("/bees-api/collaboration", action ? {
    method: "POST",
    body: JSON.stringify({ action, ...values })
  } : void 0);
  function dialogValue(label, initial, confirmOnly = false, inputType = "text") {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "bees-prompt";
      const form = document.createElement("form");
      form.method = "dialog";
      const title = document.createElement("label");
      title.textContent = label;
      form.append(title);
      const input = confirmOnly ? null : document.createElement("input");
      if (input) {
        input.className = "bees-input";
        input.type = inputType;
        input.value = initial;
        input.setAttribute("aria-label", label.split("\n")[0]);
        form.append(input);
      }
      const actions = document.createElement("div");
      actions.className = "bees-prompt-actions";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "bees-btn";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => dialog.close("cancel"));
      const submit = document.createElement("button");
      submit.className = "bees-btn primary";
      submit.textContent = confirmOnly ? "Confirm" : "Continue";
      actions.append(cancel, submit);
      form.append(actions);
      dialog.append(form);
      document.body.append(dialog);
      dialog.addEventListener("close", () => {
        const value = dialog.returnValue === "cancel" ? null : input ? input.value.trim() : true;
        dialog.remove();
        resolve(value);
      }, { once: true });
      requestAnimationFrame(() => {
        dialog.showModal();
        input?.focus();
        input?.select();
      });
    });
  }
  var ask = (label, initial = "", inputType = "text") => dialogValue(label, initial, false, inputType);
  var confirmAction2 = (label) => dialogValue(label, "", true);
  var Button = ({ children, className = "", ...props }) => h("button", { type: "button", className: `bees-btn ${className}`, ...props }, children);
  function AuditEvent({ event, detail, onOpen, openLabel = "Open related item" }) {
    const title = String(event.type ?? "Audit event").replace(/^domain-/, "").replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
    return h(
      "details",
      { className: "bees-audit" },
      h("summary", { className: "bees-row" }, h(
        "span",
        { className: "bees-row-main" },
        h("span", { className: "bees-row-title" }, title),
        h("span", { className: "bees-muted" }, [detail, new Date(event.createdAt).toLocaleString()].filter(Boolean).join(" · "))
      )),
      h(
        "div",
        { className: "bees-audit-detail" },
        event.executionId ? h("div", { className: "bees-muted" }, `Run: ${event.executionId}`) : null,
        h("pre", null, JSON.stringify(event.metadata ?? {}, null, 2)),
        onOpen ? h(Button, { onClick: onOpen }, openLabel) : null
      )
    );
  }
  function ThemeIcon({ theme }) {
    const props = {
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true"
    };
    if (theme === "light") return h(
      "svg",
      props,
      h("circle", { cx: 12, cy: 12, r: 3.5 }),
      h("path", { d: "M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" })
    );
    if (theme === "dark") return h(
      "svg",
      props,
      h("path", { d: "M21 12.8A8.5 8.5 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8Z" })
    );
    return h(
      "svg",
      props,
      h("rect", { x: 3, y: 4, width: 18, height: 13, rx: 2 }),
      h("path", { d: "M8 21h8M12 17v4" })
    );
  }
  function ThemeToggle({ ctx }) {
    const [preference, setPreference] = useState(() => ctx.theme.getTheme().preference);
    useEffect(() => ctx.on("theme/change", ({ preference: next }) => setPreference(next)), [ctx]);
    const currentIndex = Math.max(0, THEMES.findIndex(([theme]) => theme === preference));
    const [currentTheme, currentLabel] = THEMES[currentIndex];
    const [nextTheme, nextLabel] = THEMES[(currentIndex + 1) % THEMES.length];
    const label = `${currentLabel} theme; switch to ${nextLabel}`;
    return h("button", {
      type: "button",
      className: "bees-theme-toggle",
      title: label,
      "aria-label": label,
      onClick: () => ctx.theme.setTheme(nextTheme)
    }, h(ThemeIcon, { theme: currentTheme }));
  }
  function usePreference(scope) {
    const [snapshot, setSnapshot] = useState(() => scope.getSnapshot());
    useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
    return snapshot.value ?? { pins: [], lastScope: "" };
  }
  function useSnapshot(source, fallback = null) {
    const [observed, setObserved] = useState(() => ({ source, snapshot: source?.getSnapshot() ?? fallback }));
    const snapshot = observed.source === source ? observed.snapshot : source?.getSnapshot() ?? fallback;
    useEffect(() => {
      if (!source) {
        setObserved({ source, snapshot: fallback });
        return void 0;
      }
      const update = () => setObserved({ source, snapshot: source.getSnapshot() });
      update();
      return source.subscribe(update);
    }, [source]);
    return snapshot;
  }
  function sectionFor(child) {
    return NAVIGATION.find((section) => section.id === child || section.children.some(([id]) => id === child)) ?? NAVIGATION[0];
  }
  function navigationItem(id) {
    const section = NAVIGATION.find((item) => item.id === id || item.children.some(([child2]) => child2 === id));
    if (!section) return null;
    const child = section.children.find(([child2]) => child2 === id);
    return { id, label: child?.[1] ?? section.label, icon: section.icon, route: child?.[0] ?? section.defaultChild };
  }
  function scopeParts(data, scope) {
    const [kind, id] = String(scope).split(":");
    const workspace = kind === "workspace" ? data.workspaces.find((row) => row.id === id) : null;
    const teamId = workspace?.teamId ?? (kind === "team" ? id : "");
    const team = data.teams.find((row) => row.id === teamId);
    const organizationId = team?.organizationId ?? (kind === "organization" ? id : "");
    const organization = data.organizations.find((row) => row.id === organizationId);
    return { workspaceId: workspace?.id ?? "", teamId, organizationId, workspace, team, organization };
  }
  function Empty({ children }) {
    return h("div", { className: "bees-empty" }, children);
  }
  function PinButton({ id, label, pins, setPins }) {
    const active = pins.includes(id);
    return h("button", {
      className: `bees-nav-pin ${active ? "active" : ""}`,
      title: active ? `Unpin ${label}` : `Pin ${label}`,
      "aria-label": active ? `Unpin ${label}` : `Pin ${label}`,
      onClick: (e) => {
        e.stopPropagation();
        setPins(active ? pins.filter((p) => p !== id) : [...pins, id]);
      }
    }, h(PinIcon, { active }));
  }
  var isDone = (item) => item.completed || item.archivedAt || ["completed", "cancelled"].includes(item.runtimePhase);
  function workItemsFor(data, route, workspaceIds) {
    let rows = data.items.filter((item) => workspaceIds.includes(data.processes.find(({ id }) => id === item.processId)?.workspaceId) && item.kind !== "run");
    if (route === "goals") rows = rows.filter(({ kind }) => kind === "goal");
    if (route === "waiting") rows = rows.filter((item) => !isDone(item) && (["waiting", "failed"].includes(item.runtimePhase) || data.runs.some((run) => run.workItemId === item.id && ["waiting_for_input", "waiting_for_approval", "interrupted"].includes(run.status))));
    if (route === "waiting") return rows;
    return rows.filter((item) => route === "completed" ? isDone(item) : !isDone(item));
  }

  // dsh-runtime/plugin/client/home.js
  function Home({ data, workspaceId, act, openWorkItem }) {
    const [outcome, setOutcome] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [showAllTemplates, setShowAllTemplates] = useState(false);
    const submit = async () => {
      if (!workspaceId || !outcome.trim()) return;
      setBusy(true);
      setError("");
      try {
        const text = outcome.trim();
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        const title = lines[0].length > 60 ? lines[0].substring(0, 57) + "..." : lines[0];
        const created = await act({ action: "create_goal", workspaceId, title, description: text, priority: "normal" });
        if (created?.id) openWorkItem(created.id);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusy(false);
      }
    };
    const processes = data.processes.filter((row) => row.workspaceId === workspaceId && row.kind === "standard");
    const templates = (data.templates ?? []).filter((row) => row.workspaceId === workspaceId);
    const cards = [...templates.map((t) => ({ ...t, isTemplate: true })), ...processes.map((p) => ({ ...p, isTemplate: false }))];
    const visibleCards = showAllTemplates ? cards : cards.slice(0, 10);
    const activeWork = data.workItems ? data.workItems.filter((w) => !["completed", "cancelled", "archived"].includes(w.runtimePhase)) : [];
    const needsAttention = activeWork.filter((w) => ["waiting", "failed"].includes(w.runtimePhase)).slice(0, 5);
    const recentWork = activeWork.filter((w) => !needsAttention.includes(w)).slice(0, 5);
    return h(
      "div",
      { className: "bees-panel bees-panel-wide bees-home-layout" },
      h(
        "div",
        { className: "bees-home-main" },
        h(
          "div",
          { className: "bees-hero" },
          h(
            "div",
            { className: "bees-hero-head" },
            h("h1", null, "What outcome should Bees own?"),
            h("p", { className: "bees-hero-desc" }, "Ask an agent to propose a goal or visible process. Nothing changes until you review and apply it.")
          ),
          h(
            "form",
            {
              className: "bees-composer",
              onSubmit: (event) => {
                event.preventDefault();
                void submit();
              }
            },
            h("textarea", {
              className: "bees-composer-input",
              placeholder: workspaceId ? "e.g., Research top CRM software and draft a comparison report" : "Choose a workspace first",
              disabled: !workspaceId || busy,
              value: outcome,
              onInput: (e) => setOutcome(e.target.value),
              onKeyDown: (e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }
            }),
            error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
            h(
              "div",
              { className: "bees-composer-foot" },
              h("span", { className: "bees-composer-hint" }, "Press ⌘ + Enter to start"),
              h("button", { className: "bees-btn primary", disabled: !workspaceId || !outcome.trim() || busy }, busy ? "Starting..." : "Ask Bees")
            )
          )
        ),
        needsAttention.length > 0 && h(
          "div",
          { className: "bees-home-section" },
          h("h3", null, "Needs your attention"),
          h(
            "div",
            { className: "bees-work-list" },
            needsAttention.map(
              (w) => h(
                "button",
                { className: "bees-work-card", onClick: () => openWorkItem(w.id), key: w.id },
                h("div", { className: "bees-work-card-title" }, w.title || w.id),
                h("div", { className: "bees-work-card-meta" }, `Phase: ${w.runtimePhase || "unknown"}`)
              )
            )
          )
        ),
        recentWork.length > 0 && h(
          "div",
          { className: "bees-home-section" },
          h("h3", null, "Recent work"),
          h(
            "div",
            { className: "bees-work-list" },
            recentWork.map(
              (w) => h(
                "button",
                { className: "bees-work-card", onClick: () => openWorkItem(w.id), key: w.id },
                h("div", { className: "bees-work-card-title" }, w.title || w.id),
                h("div", { className: "bees-work-card-meta" }, w.runtimePhase || "in progress")
              )
            )
          )
        )
      ),
      h(
        "div",
        { className: "bees-home-side" },
        h("h3", null, "Templates"),
        h(
          "div",
          { className: "bees-home-templates" },
          cards.length > 0 ? visibleCards.map(
            (card) => h(
              "button",
              { className: "bees-template-card", onClick: async () => {
                if (card.isTemplate) {
                  const p = await act({ action: "create_process", workspaceId, name: `New from ${card.name}`, templateId: card.id });
                  if (p?.id) openWorkItem(null, p.id);
                } else {
                  openWorkItem(null, card.id);
                }
              }, key: card.id },
              h("div", { className: "bees-template-card-title" }, card.name),
              h("div", { className: "bees-template-card-meta" }, card.description || (card.isTemplate ? "Template" : "Process"))
            )
          ) : h("p", { className: "bees-muted" }, "No templates available."),
          cards.length > 10 && !showAllTemplates ? h("button", {
            className: "bees-btn",
            style: { width: "100%", marginTop: "4px" },
            onClick: () => setShowAllTemplates(true)
          }, `Show all ${cards.length} templates`) : null
        )
      )
    );
  }
  function GuidePage() {
    return h(
      "div",
      { className: "bees-stack" },
      h(
        "div",
        { className: "bees-callout" },
        h("h3", null, "Bees in one sentence"),
        h("div", null, "Tell Bees the outcome, choose the repeatable path, and let agents move the work through it.")
      ),
      h(
        "div",
        { className: "bees-grid bees-help-grid" },
        h(
          "section",
          { className: "bees-box" },
          h("h3", null, "Goal = the outcome"),
          h("p", null, "Use a goal when you care about the result but do not want to plan every task."),
          h("p", { className: "bees-muted" }, "Example: “Launch the new website.” Bees may create or coordinate several work items to reach it.")
        ),
        h(
          "section",
          { className: "bees-box" },
          h("h3", null, "Work item = one piece of work"),
          h("p", null, "Use a work item for one concrete deliverable that follows a process."),
          h("p", { className: "bees-muted" }, "Example: “Write the launch announcement.” It moves through Draft → Review → Done.")
        ),
        h(
          "section",
          { className: "bees-box" },
          h("h3", null, "Process = the path"),
          h("p", null, "A process is a live sequence of stages that routes real work to agents."),
          h("p", { className: "bees-muted" }, "Create one when work should repeatedly follow the same handoffs.")
        ),
        h(
          "section",
          { className: "bees-box" },
          h("h3", null, "Template = a saved blueprint"),
          h("p", null, "A template remembers a process design but runs nothing."),
          h("p", { className: "bees-muted" }, "Create one directly under Processes → Templates, or save an existing process as a template.")
        ),
        h(
          "section",
          { className: "bees-box" },
          h("h3", null, "Agent pool = interchangeable agents"),
          h("p", null, "Use a pool when several agents can handle the same stage and Bees may choose any available match."),
          h("p", { className: "bees-muted" }, "Use one named agent when context, ownership, or continuity matters.")
        ),
        h(
          "section",
          { className: "bees-box" },
          h("h3", null, "Needs you = blocked work"),
          h("p", null, "This queue collects questions, approvals, failures, and other work an agent cannot continue alone."),
          h("p", { className: "bees-muted" }, "It is not a stage and you do not assign an agent to it. Assign agents on a process stage or override one on the work item.")
        )
      )
    );
  }

  // dsh-runtime/plugin/client/work.js
  function WorkItemDetails({ ctx, data, item, teamId, act, onArchived }) {
    const process = data.processes.find(({ id }) => id === item.processId);
    const stage = data.stages.find(({ id }) => id === item.stageId);
    const assignments = data.assignments.filter(({ workspaceId }) => workspaceId === process?.workspaceId);
    const assignment = assignments.find(({ id }) => id === item.agentAssignmentId);
    const routeAgent = assignments.find(({ id }) => id === stage?.routeTargetId);
    const routePool = data.pools.find(({ id }) => id === stage?.routeTargetId);
    const routeLabel = routeAgent?.name ?? routePool?.name ?? `Workspace ${stage?.driver === "review" ? "reviewer" : "worker"}`;
    const itemRuns = data.runs.filter(({ workItemId }) => workItemId === item.id);
    const [selectedRun, setSelectedRun] = useState("");
    const [activeTab, setActiveTab] = useState("details");
    const [handled, setHandled] = useState(() => /* @__PURE__ */ new Set());
    const [history, setHistory] = useState(null);
    const [audit, setAudit] = useState([]);
    const convoRef = React.useRef(null);
    const run = itemRuns.find(({ id }) => id === selectedRun) ?? itemRuns[0];
    const pendingRun = itemRuns.find(({ status, sessionId }) => sessionId && ["waiting_for_input", "waiting_for_approval", "interrupted"].includes(status));
    const sessions = useSnapshot(ctx.sessions.list, { ids: [], byId: {} });
    const pendingSummary = pendingRun ? sessions.byId[pendingRun.sessionId] : null;
    const binding = pendingRun ? ctx.sessions.binding(pendingRun.sessionId) : null;
    const pendingSession = useSnapshot(binding?.session);
    const expectedInteraction = pendingSummary?.pendingInteraction;
    const interaction = pendingSession?.pending?.find((wait) => !handled.has(wait.key) && (expectedInteraction === "plan-review" ? wait.kind === "question" : wait.kind === expectedInteraction)) ?? pendingSession?.pending?.find((wait) => !handled.has(wait.key));
    useEffect(() => {
      setSelectedRun("");
      setHistory(null);
      setHandled(/* @__PURE__ */ new Set());
      setActiveTab("details");
    }, [item.id]);
    useEffect(() => {
      if (pendingRun?.sessionId) void ctx.sessions.open(pendingRun.sessionId);
    }, [ctx, pendingRun?.sessionId]);
    useEffect(() => {
      let active = true;
      if (!run) {
        setHistory(null);
        return () => {
          active = false;
        };
      }
      request2(`/bees-api/run-history?executionId=${encodeURIComponent(run.id)}`).then((value) => active && setHistory(value.history)).catch((error) => active && setHistory({ error: error instanceof Error ? error.message : String(error) }));
      return () => {
        active = false;
      };
    }, [run?.id]);
    useEffect(() => {
      let active = true;
      request2("/bees-api/audit").then(({ events: events2 }) => active && setAudit(events2));
      return () => {
        active = false;
      };
    }, [item.id, data.runs.length]);
    useEffect(() => {
      if (convoRef.current) convoRef.current.scrollTop = convoRef.current.scrollHeight;
    }, [history, pendingRun, interaction]);
    const edit = async () => {
      const title = await ask("Work title", item.title);
      if (!title) return;
      const description = await ask("Description", item.description) ?? item.description;
      const owner = await ask("Person responsible (optional)", item.owner ?? "") ?? "";
      const agentName = await ask(`Worker override (optional; blank uses stage routing):
${assignments.map(({ name }) => name).join("\n")}`, assignment?.name ?? "");
      if (agentName === null) return;
      const nextAgent = assignments.find(({ name }) => name === agentName);
      if (agentName && !nextAgent) return;
      await act({ action: "edit_item", itemId: item.id, title, description, owner, priority: item.priority, parentId: item.parentId, agentAssignmentId: nextAgent?.id ?? null });
    };
    const addFile = async () => {
      const attached = data.attachments.filter(({ workItemId }) => workItemId === item.id).map(({ locationId }) => locationId);
      const available = data.locations.filter(({ teamId: id, archivedAt, id: locationId }) => id === teamId && !archivedAt && !attached.includes(locationId));
      const name = await ask(`Team location:
${available.map(({ name: name2 }) => name2).join("\n")}`);
      const location = available.find((row) => row.name === name);
      if (!location) return;
      const relativePath = location.kind === "folder" ? await ask("Relative file or folder inside this location (optional)", "") : "";
      if (relativePath !== null) await act({ action: "attach_location", itemId: item.id, locationId: location.id, relativePath });
    };
    const addSubitem = async () => {
      const title = await ask("Sub-item title", "");
      if (!title) return;
      const description = await ask("What does success look like?", "") ?? "";
      const agentName = await ask(`Worker override (optional; blank uses stage routing):
${assignments.map(({ name }) => name).join("\n")}`, assignment?.name ?? "");
      if (agentName === null) return;
      const childAgent = assignments.find(({ name }) => name === agentName);
      if (agentName && !childAgent) return;
      await act({ action: "create_item", processId: item.processId, parentId: item.id, title, description, agentAssignmentId: childAgent?.id ?? null });
    };
    const publish = async () => {
      const attached = data.attachments.filter(({ workItemId }) => workItemId === item.id).map(({ locationId }) => locationId);
      const choices = data.locations.filter(({ id }) => attached.includes(id));
      const name = await ask(`Publish to:
${choices.map(({ name: name2 }) => name2).join("\n")}`);
      const location = choices.find((row) => row.name === name);
      if (run && location) await act({ action: "publish_run", executionId: run.id, locationId: location.id });
    };
    const archive = async () => {
      if (!await confirmAction2(`Archive “${item.title}”? Active work will be cancelled. Its history will be preserved.`)) return;
      if (await act({ action: "archive_item", itemId: item.id })) onArchived?.();
    };
    const answered = (key) => setHandled((current) => new Set(current).add(key));
    const runAudit = new Set(itemRuns.map(({ id }) => id));
    const events = audit.filter(({ executionId, metadata }) => runAudit.has(executionId) || metadata?.itemId === item.id || metadata?.parentId === item.id || metadata?.resultId === item.id);
    const convoItems = [];
    if (item.title) convoItems.push(h("div", { className: "bees-convo-msg user", key: "start" }, h("strong", null, item.kind === "goal" ? "Goal" : "Work item"), h("div", null, item.title)));
    if (history?.messages) {
      let toolCount = 0;
      for (const msg of history.messages) {
        if (msg.role === "user") convoItems.push(h("div", { className: "bees-convo-msg user", key: msg.id }, msg.parts.map((p) => p.text).join(" ")));
        else {
          const textParts = msg.parts.filter((p) => p.text);
          const toolParts = msg.parts.filter((p) => p.type === "tool");
          if (textParts.length) convoItems.push(h("div", { className: "bees-convo-msg agent", key: msg.id }, h("strong", null, "Agent"), h("div", null, textParts.map((p) => p.text).join(" "))));
          if (toolParts.length) {
            toolCount += toolParts.length;
            convoItems.push(h("div", { className: "bees-convo-msg system", key: `tool-${msg.id}` }, `${toolParts.length} tasks/actions performed`));
          }
        }
      }
    } else if (events.length) {
      convoItems.push(h("div", { className: "bees-convo-msg system", key: "audit-events" }, `${events.length} background events recorded`));
    }
    return h(
      "div",
      { className: "bees-workspace-layout" },
      h(
        "div",
        { className: "bees-convo-panel" },
        h(
          "div",
          { className: "bees-convo-history", ref: convoRef },
          ...convoItems,
          pendingRun ? h(AgentInteractionPanel, {
            run: pendingRun,
            item,
            summary: pendingSummary,
            session: pendingSession,
            interaction,
            handled,
            onAnswered: answered
          }) : item.runtimePhase === "running" ? h("div", { className: "bees-convo-msg system" }, "Agent is working...") : null,
          item.runtimeError ? h("div", { className: "bees-convo-msg agent", style: { borderColor: "#d15353", background: "#a9363622" } }, h("strong", null, "Error"), h("div", null, item.runtimeError)) : null
        ),
        h(
          "div",
          { className: "bees-convo-composer" },
          h(
            "div",
            { style: { display: "flex", gap: "8px" } },
            h("input", { className: "bees-input", placeholder: pendingRun ? "Answer above..." : "Composer available when agent asks...", disabled: true, style: { flex: 1 } }),
            ["running", "waiting"].includes(item.runtimePhase) ? h(Button, { onClick: () => act({ action: "pause_item", itemId: item.id }) }, "Pause") : null,
            item.runtimePhase === "paused" ? h(Button, { className: "primary", onClick: () => act({ action: "resume_item", itemId: item.id }) }, "Resume") : null,
            item.runtimePhase === "failed" ? h(Button, { className: "primary", onClick: () => act({ action: "retry_item", itemId: item.id }) }, "Retry") : null
          )
        )
      ),
      h(
        "div",
        { className: "bees-details-panel" },
        h(
          "div",
          { className: "bees-box" },
          h(
            "div",
            { className: "bees-tabs", role: "tablist" },
            h("button", { className: `bees-tab ${activeTab === "details" ? "active" : ""}`, onClick: () => setActiveTab("details") }, "Details"),
            h("button", { className: `bees-tab ${activeTab === "files" ? "active" : ""}`, onClick: () => setActiveTab("files") }, "Files"),
            h("button", { className: `bees-tab ${activeTab === "runs" ? "active" : ""}`, onClick: () => setActiveTab("runs") }, "Runs"),
            h("button", { className: `bees-tab ${activeTab === "audit" ? "active" : ""}`, onClick: () => setActiveTab("audit") }, "Audit")
          ),
          h(
            "div",
            { className: "bees-tab-panel" },
            activeTab === "details" ? h(
              React.Fragment,
              null,
              h("div", { className: "bees-status" }, `${process?.name ?? "Process"} · ${stage?.name ?? "Stage"}`),
              h("h3", null, "Active Agent"),
              h("p", { className: "bees-muted" }, assignment ? `${assignment.name}${assignment.model ? ` · ${assignment.model}` : ""}` : `Stage route: ${routeLabel}`),
              h("h3", null, "Process"),
              process?.description ? h(MarkdownText, { text: process.description }) : h("p", { className: "bees-muted" }, "No description"),
              h("h3", null, "Description"),
              item.description ? h(MarkdownText, { text: item.description }) : h("p", { className: "bees-muted" }, "No description"),
              h("div", { className: "bees-detail-actions" }, h(Button, { onClick: edit }, "Edit"), h(Button, { onClick: addSubitem }, "New sub-item"), h(Button, { className: "danger", onClick: archive }, "Archive"))
            ) : activeTab === "files" ? h(
              React.Fragment,
              null,
              h("h3", null, "Inputs"),
              h("div", { className: "bees-detail-actions", style: { marginBottom: "12px" } }, h(Button, { onClick: addFile }, "Add inputs")),
              h("h3", null, "Generated Files"),
              run?.outputs.length ? h("p", null, run.outputs.join(", ")) : h("p", { className: "bees-muted" }, "No outputs generated yet."),
              run?.status === "completed" && run.outputs.length && data.attachments.some(({ workItemId }) => workItemId === item.id) ? h(Button, { className: "primary", onClick: publish }, "Publish outputs") : null
            ) : activeTab === "runs" ? h(
              React.Fragment,
              null,
              h("h3", { className: "bees-section-title" }, "Runs"),
              itemRuns.length ? h("div", { className: "bees-run-list" }, ...itemRuns.map((row) => h(
                "button",
                { className: `bees-run-row ${row.id === run?.id ? "active" : ""}`, key: row.id, onClick: () => setSelectedRun(row.id) },
                h("span", { className: `bees-status bees-${row.status}` }, row.status),
                h("span", null, new Date(row.updatedAt).toLocaleString()),
                h("span", { className: "bees-grow" }),
                h("span", { className: "bees-muted" }, `${row.outputs.length} outputs`)
              ))) : h(Empty, null, "No runs yet")
            ) : h(
              React.Fragment,
              null,
              h("h3", null, "Audit"),
              ...events.length ? events.map((event) => h(AuditEvent, {
                event,
                key: event.id,
                detail: event.metadata?.action ?? event.metadata?.outcome,
                onOpen: runAudit.has(event.executionId) ? () => {
                  setSelectedRun(event.executionId);
                  setActiveTab("runs");
                } : null,
                openLabel: "Open run"
              })) : [h("p", { className: "bees-muted", key: "none" }, "No audit events for this work item yet")]
            )
          )
        )
      )
    );
  }
  function descendantSessions(sessionIds, sessions) {
    const summaries = new Map(Object.values(sessions.byId).map((summary) => [summary.id, summary]));
    for (const [parentId, catalog] of Object.entries(sessions.subagentsByParent ?? {})) {
      for (const entry of catalog.entries) if (entry.kind === "child") {
        const summary = summaries.get(entry.id);
        summaries.set(entry.id, {
          ...summary,
          id: entry.id,
          displayTitle: entry.label ?? summary?.displayTitle ?? entry.id,
          running: entry.activity === "running",
          blank: summary?.blank ?? false,
          updatedAt: summary?.updatedAt ?? 0,
          parentId,
          origin: "subagent"
        });
      }
    }
    const descendants = [];
    const byParent = /* @__PURE__ */ new Map();
    for (const summary of summaries.values()) if (summary.origin === "subagent" && summary.parentId) {
      const children = byParent.get(summary.parentId) ?? [];
      children.push(summary);
      byParent.set(summary.parentId, children);
    }
    const seen = /* @__PURE__ */ new Set();
    const visit = (parentId, depth) => {
      for (const summary of byParent.get(parentId) ?? []) {
        if (seen.has(summary.id)) continue;
        seen.add(summary.id);
        descendants.push({ summary, depth });
        visit(summary.id, depth + 1);
      }
    };
    for (const sessionId of sessionIds) visit(sessionId, 0);
    return descendants;
  }
  function runsForAttempt(item, data) {
    const runs = data.runs.filter(({ workItemId }) => workItemId === item.id);
    const attempt = Number(item.runtimeAttempt);
    if (!attempt) return runs;
    const suffix = new RegExp(`-(?:work-${attempt}|review-${attempt}-\\d+)$`);
    const current = runs.filter(({ id }) => suffix.test(id));
    return current.length ? current : runs;
  }
  function WorkItemCockpit({ ctx, data, rootId, teamId, act, onBack }) {
    const root = data.items.find(({ id }) => id === rootId);
    const sessions = useSnapshot(ctx.sessions.list, { ids: [], byId: {}, subagentsByParent: {} });
    const [selectedId, setSelectedId] = useState(rootId);
    useEffect(() => setSelectedId(rootId), [rootId]);
    const visibleIds = /* @__PURE__ */ new Set([rootId]);
    for (let added = true; added; ) {
      added = false;
      for (const item of data.items) if ((!root || item.processId === root.processId) && item.parentId && visibleIds.has(item.parentId) && !visibleIds.has(item.id)) {
        visibleIds.add(item.id);
        added = true;
      }
    }
    const items = data.items.filter(({ id, archivedAt }) => visibleIds.has(id) && !archivedAt);
    const hierarchyRuns = items.flatMap((item) => runsForAttempt(item, data));
    const runSessionIds = [...new Set(hierarchyRuns.flatMap(({ sessionId, previousSessionId }) => [sessionId, previousSessionId]).filter(Boolean))];
    const catalogParents = [.../* @__PURE__ */ new Set([
      ...runSessionIds,
      ...descendantSessions(runSessionIds, sessions).map(({ summary }) => summary.id)
    ])];
    const catalogKey = catalogParents.join("|");
    useEffect(() => {
      for (const sessionId of catalogParents) ctx.sessions.setSubagentCatalogOpen(sessionId, true);
      return () => {
        for (const sessionId of catalogParents) ctx.sessions.setSubagentCatalogOpen(sessionId, false);
      };
    }, [ctx, catalogKey]);
    if (!root) return h(Empty, null, "Work item not found");
    const process = data.processes.find(({ id }) => id === root.processId);
    const stages = data.stages.filter(({ processId }) => processId === root.processId);
    const selected = items.find(({ id }) => id === selectedId) ?? root;
    const latest = /* @__PURE__ */ new Map();
    for (const run of data.runs) if (run.workItemId && !latest.has(run.workItemId)) latest.set(run.workItemId, run);
    const subagents = items.flatMap((item) => {
      const sessionIds = [...new Set(runsForAttempt(item, data).flatMap(({ sessionId, previousSessionId }) => [sessionId, previousSessionId]).filter(Boolean))];
      return descendantSessions(sessionIds, sessions).map(({ summary, depth }) => ({ summary, depth, item }));
    });
    const terminalStage = stages.find(({ isTerminal }) => isTerminal) ?? stages.at(-1);
    const workStage = stages.find(({ name, isTerminal }) => !isTerminal && /^work$/i.test(name));
    const waitingStage = stages.find(({ name }) => /^(waiting|blocked)$/i.test(name));
    const subagentStageId = ({ summary, item }) => !summary.running ? terminalStage?.id : summary.pendingInteraction ? waitingStage?.id ?? item.stageId : workStage?.id ?? item.stageId;
    const lineage = (item) => {
      const names = [];
      let current = item;
      while (current?.parentId && visibleIds.has(current.parentId)) {
        current = data.items.find(({ id }) => id === current.parentId);
        if (current) names.unshift(current.title);
      }
      return names.join(" → ");
    };
    const completed = items.filter(({ completed: completed2 }) => completed2).length + subagents.filter(({ summary }) => !summary.running).length;
    const total = items.length + subagents.length;
    return h(
      "div",
      null,
      h(
        "header",
        { className: "bees-cockpit-head" },
        h(Button, { onClick: onBack }, "← Work"),
        h("div", null, h("h2", null, root.title), h("div", { className: "bees-muted" }, `${process?.name ?? "Process"} · ${completed} of ${total} work items complete`))
      ),
      h("div", { className: "bees-board bees-cockpit-board" }, ...stages.map((stage) => {
        const rows = items.filter(({ stageId }) => stageId === stage.id);
        const childRows = subagents.filter((child) => subagentStageId(child) === stage.id);
        return h(
          "section",
          { className: "bees-column", key: stage.id },
          h("header", { className: "bees-column-head" }, stage.name, h("span", { className: "bees-count" }, rows.length + childRows.length)),
          h("div", { className: "bees-cards" }, ...rows.length || childRows.length ? [...rows.map((item) => {
            const run = latest.get(item.id);
            const parentPath = lineage(item);
            const routedAgent = data.assignments.find(({ id }) => id === (run?.resolvedAgentId ?? item.agentAssignmentId));
            return h(
              "button",
              { className: `bees-hierarchy-card ${selected.id === item.id ? "active" : ""}`, key: item.id, onClick: () => setSelectedId(item.id) },
              h("h3", null, item.title),
              h("div", { className: "bees-lineage bees-muted" }, item.id === root.id ? "Root work item" : parentPath || "Sub-item"),
              h("div", { className: "bees-muted" }, [item.runtimePhase, routedAgent?.name, run?.status].filter(Boolean).join(" · "))
            );
          }), ...childRows.map(({ summary, depth, item }) => {
            const label = summary.projectionValues?.subagent?.label ?? summary.displayTitle;
            const status = summary.pendingInteraction ? "waiting" : summary.running ? "running" : "done";
            return h(
              "article",
              { className: "bees-hierarchy-card bees-subagent-card", key: summary.id },
              h("h3", null, label),
              h("div", { className: "bees-lineage bees-muted" }, `${item.title} → ${depth ? "Nested subagent" : "Subagent"}`),
              h("div", { className: "bees-muted" }, status)
            );
          })] : [h(Empty, { key: "empty" }, "No work in this stage")])
        );
      })),
      h(WorkItemDetails, { ctx, data, item: selected, teamId, act, onArchived: onBack })
    );
  }
  function WorkItemForm({ data, kind, workspaceId, defaultProcessId, act, onCancel, onCreated }) {
    const processes = data.processes.filter((process) => process.workspaceId === workspaceId);
    const assignments = data.assignments.filter((assignment) => assignment.workspaceId === workspaceId);
    const goal = kind === "goal";
    if (!workspaceId) return h(
      "div",
      { className: "bees-stack" },
      h("div", { className: "bees-page-head" }, h(Button, { onClick: onCancel }, "← Work"), h("h2", null, goal ? "New goal" : "New work")),
      h(Empty, null, "Choose one workspace before creating work.")
    );
    if (!goal && !processes.length) return h(
      "div",
      { className: "bees-stack" },
      h("div", { className: "bees-page-head" }, h(Button, { onClick: onCancel }, "← Work"), h("h2", null, "New work")),
      h(Empty, null, "Create a process first. Work always follows a process so Bees knows its stages.")
    );
    return h(
      "form",
      { className: "bees-box bees-form", onSubmit: async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const command = goal ? {
          action: "create_goal",
          workspaceId,
          title: String(form.get("title") ?? ""),
          description: String(form.get("description") ?? ""),
          priority: String(form.get("priority") ?? "normal")
        } : {
          action: "create_item",
          processId: String(form.get("processId") ?? ""),
          title: String(form.get("title") ?? ""),
          description: String(form.get("description") ?? ""),
          priority: String(form.get("priority") ?? "normal"),
          agentAssignmentId: String(form.get("agentAssignmentId") ?? "") || null
        };
        const created = await act(command);
        if (created?.id) onCreated(created.id);
      } },
      h(
        "div",
        { className: "bees-page-head" },
        h(Button, { onClick: onCancel }, "← Work"),
        h(
          "div",
          null,
          h("h2", null, goal ? "New goal" : "New work"),
          h("div", { className: "bees-muted" }, goal ? "Describe the outcome. Bees will plan and execute the work needed to reach it." : "Create the whole work item here, then Bees starts it in the process's first stage.")
        )
      ),
      !goal ? h("label", null, "Process", h(
        "select",
        {
          className: "bees-select",
          name: "processId",
          required: true,
          defaultValue: processes.some(({ id }) => id === defaultProcessId) ? defaultProcessId : processes[0]?.id
        },
        ...processes.map((process) => h("option", { value: process.id, key: process.id }, process.name))
      )) : null,
      h("label", null, goal ? "Goal" : "Title", h("input", {
        className: "bees-input",
        name: "title",
        required: true,
        autoFocus: true,
        placeholder: goal ? "Launch the product successfully" : "Draft the launch announcement"
      })),
      h("label", null, "What does success look like?", h("textarea", {
        className: "bees-textarea",
        name: "description",
        placeholder: "Include the result, constraints, and evidence Bees should produce."
      })),
      h(
        "div",
        { className: "bees-form-row" },
        h("label", null, "Priority", h(
          "select",
          { className: "bees-select", name: "priority", defaultValue: "normal" },
          h("option", { value: "low" }, "Low"),
          h("option", { value: "normal" }, "Normal"),
          h("option", { value: "high" }, "High")
        )),
        !goal ? h("label", null, "Agent override (optional)", h(
          "select",
          { className: "bees-select", name: "agentAssignmentId", defaultValue: "" },
          h("option", { value: "" }, "Use each stage's assigned agent"),
          ...assignments.map((agent) => h("option", { value: agent.id, key: agent.id, disabled: !agent.enabled }, agent.name))
        )) : null
      ),
      h(
        "div",
        { className: "bees-detail-actions" },
        h("button", { className: "bees-btn primary" }, goal ? "Create goal" : "Create work"),
        h(Button, { onClick: onCancel }, "Cancel")
      )
    );
  }
  function displayOption(label) {
    const text = String(label);
    const recommended = /\s*\(recommended\)\s*$/i.test(text);
    return { label: text.replace(/\s*\(recommended\)\s*$/i, ""), recommended };
  }
  function FilePreview({ target }) {
    const [file, setFile] = useState(null);
    const [error, setError] = useState("");
    useEffect(() => {
      let current = true;
      setFile(null);
      setError("");
      const query = new URLSearchParams({ executionId: target.executionId, path: target.path });
      request2(`/bees-api/run-file?${query}`).then((value) => {
        if (current) setFile(value);
      }).catch((reason) => {
        if (current) setError(reason instanceof Error ? reason.message : String(reason));
      });
      return () => {
        current = false;
      };
    }, [target.executionId, target.path]);
    return h(
      "section",
      { className: "bees-file-preview", "aria-label": "File contents" },
      h("div", { className: "bees-file-preview-head" }, h("strong", null, file?.path ?? target.path)),
      error ? h("div", { className: "bees-error", role: "alert" }, error) : !file ? h("div", { className: "bees-loading" }, "Opening file…") : file.format === "markdown" ? h(MarkdownText, { text: file.content }) : h("pre", null, file.content)
    );
  }
  function QuestionPanel({ wait, onAnswered }) {
    const pending = useMemo(() => new PendingQuestion(wait), [wait]);
    const questions = pending.questions ?? [];
    const [index, setIndex] = useState(0);
    const [drafts, setDrafts] = useState(() => questions.map(() => ({ selected: [], custom: "", skipped: false })));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const question = questions[index];
    if (!question) return h(Empty, null, "The agent sent an empty question request.");
    const draft = drafts[index];
    const setDraft = (change) => setDrafts((current) => current.map((value, itemIndex) => itemIndex === index ? change(value) : value));
    const choose = (label) => setDraft((current) => ({
      ...current,
      selected: question.multiSelect === true ? current.selected.includes(label) ? current.selected.filter((value) => value !== label) : [...current.selected, label] : [label],
      custom: question.multiSelect === true ? current.custom : "",
      skipped: false
    }));
    const submit = async (nextDrafts) => {
      setBusy(true);
      setError("");
      try {
        await pending.answer({ answers: questions.map((item, itemIndex) => {
          const answer = nextDrafts[itemIndex];
          return { id: item.id, selected: answer.selected, ...answer.custom.trim() ? { custom: answer.custom.trim() } : {} };
        }) });
        onAnswered(wait.key);
      } catch (reason) {
        setBusy(false);
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    const continueFlow = (nextDrafts = drafts) => {
      const answer = nextDrafts[index];
      if (!answer.skipped && !answer.selected.length && !answer.custom.trim()) {
        setError("Choose an option or enter an answer.");
        return;
      }
      setError("");
      if (index < questions.length - 1) setIndex((current) => current + 1);
      else void submit(nextDrafts);
    };
    const skip = () => {
      const next = drafts.map((value, itemIndex) => itemIndex === index ? { selected: [], custom: "", skipped: true } : value);
      setDrafts(next);
      continueFlow(next);
    };
    const custom = (event) => {
      const value = event.target.value;
      setDraft((current) => ({ ...current, custom: value, selected: question.multiSelect === true ? current.selected : [], skipped: false }));
    };
    return h(
      React.Fragment,
      null,
      h(
        "div",
        null,
        h("div", { className: "bees-muted" }, [question.header, questions.length > 1 ? `Question ${index + 1} of ${questions.length}` : ""].filter(Boolean).join(" · ")),
        h("h3", { className: "bees-section-title" }, question.question)
      ),
      question.detail ? h("div", { className: "bees-question-detail" }, h(MarkdownText, { text: question.detail })) : null,
      h(
        "div",
        { className: "bees-question-options", role: question.multiSelect === true ? "group" : "radiogroup" },
        ...(question.options ?? []).map((option, optionIndex) => {
          const selected = draft.selected.includes(option.label);
          const shown = displayOption(option.label);
          return h(
            "button",
            {
              type: "button",
              key: `${option.label}:${optionIndex}`,
              disabled: busy,
              className: `bees-choice ${selected ? "selected" : ""}`,
              role: question.multiSelect === true ? "checkbox" : "radio",
              "aria-checked": selected,
              onClick: () => choose(option.label)
            },
            h("span", { className: "bees-choice-mark", "aria-hidden": "true" }, question.multiSelect === true ? selected ? "✓" : "" : optionIndex + 1),
            h(
              "span",
              { className: "bees-choice-copy" },
              h("strong", null, shown.label, shown.recommended ? " · Recommended" : ""),
              option.description ? h("span", { className: "bees-muted" }, option.description) : null
            )
          );
        }),
        (question.options ?? []).length ? h("input", {
          className: "bees-input",
          type: "text",
          value: draft.custom,
          disabled: busy,
          placeholder: question.multiSelect === true ? "Add another answer (optional)" : "Or type another answer",
          onChange: custom,
          onKeyDown: (event) => {
            if (event.key === "Enter" && !event.nativeEvent?.isComposing) {
              event.preventDefault();
              continueFlow();
            }
          }
        }) : h("textarea", {
          className: "bees-textarea",
          value: draft.custom,
          disabled: busy,
          autoFocus: true,
          placeholder: "Type your answer",
          onChange: custom,
          onKeyDown: (event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              continueFlow();
            }
          }
        })
      ),
      error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
      h(
        "div",
        { className: "bees-answer-actions" },
        index > 0 ? h(Button, { disabled: busy, onClick: () => {
          setIndex((current) => current - 1);
          setError("");
        } }, "Back") : null,
        h(Button, { disabled: busy, onClick: skip }, "Skip"),
        h("div", { className: "bees-grow" }),
        h(Button, { className: "primary", disabled: busy, onClick: () => continueFlow() }, busy ? "Sending…" : index < questions.length - 1 ? "Next" : "Send answer")
      )
    );
  }
  function ApprovalPanel({ wait, onAnswered }) {
    const [busy, setBusy] = useState("");
    const [error, setError] = useState("");
    const answer = async (outcome) => {
      setBusy(outcome);
      setError("");
      try {
        const receipt = await wait.respond({ ok: true, value: {
          sessionId: wait.sessionId,
          approvalId: wait.payload.approvalId,
          outcome
        } });
        if (!receipt.accepted) throw new Error(`approval response rejected: ${receipt.reason}`);
        onAnswered(wait.key);
      } catch (reason) {
        setBusy("");
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    return h(
      React.Fragment,
      null,
      h(
        "div",
        null,
        h("div", { className: "bees-muted" }, wait.payload.toolName || "Agent action"),
        h("h3", { className: "bees-section-title" }, "Approve this action?")
      ),
      wait.payload.reason ? h("div", { className: "bees-question-detail" }, h(MarkdownText, { text: wait.payload.reason })) : null,
      error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
      h(
        "div",
        { className: "bees-answer-actions" },
        h(Button, { className: "danger", disabled: Boolean(busy), onClick: () => void answer("rejected") }, busy === "rejected" ? "Denying…" : "Deny"),
        h(Button, { className: "primary", disabled: Boolean(busy), onClick: () => void answer("allowed-once") }, busy === "allowed-once" ? "Approving…" : "Approve once")
      )
    );
  }
  var interactionName = (kind) => kind === "approval" ? "Approval" : kind === "plan-review" ? "Plan review" : "Question";
  function AgentInteractionPanel({ run, item, summary, session, interaction, handled, onAnswered, onOpenWork }) {
    const files = run.files ?? (run.outputs ?? []).map((path) => `outputs/${path}`);
    const [viewer, setViewer] = useState(files.length ? { executionId: run.id, path: files[0] } : null);
    const fileKey = files.join("|");
    useEffect(() => setViewer((current) => files.length ? current?.executionId === run.id && files.includes(current.path) ? current : { executionId: run.id, path: files[0] } : null), [run.id, fileKey]);
    return h(
      "section",
      { className: "bees-box bees-answer-card" },
      h(
        "div",
        { className: "bees-answer-head" },
        h(
          "div",
          null,
          h("div", { className: "bees-status" }, interactionName(summary?.pendingInteraction ?? interaction?.kind)),
          h("h2", null, item?.title ?? summary?.displayTitle ?? "Agent run")
        ),
        h("div", { className: "bees-grow" }),
        onOpenWork ? h(Button, { onClick: onOpenWork }, "Open work") : null
      ),
      interaction?.kind === "question" ? h(QuestionPanel, { key: interaction.key, wait: interaction, onAnswered }) : interaction?.kind === "approval" ? h(ApprovalPanel, { key: interaction.key, wait: interaction, onAnswered }) : h(Empty, null, run.status === "interrupted" ? "The prior request was interrupted. Retry the work to ask again." : session?.pending?.some(({ key }) => handled.has(key)) ? "Answer sent. Waiting for the agent…" : "Loading the agent's request…"),
      files.length ? h(
        "div",
        { className: "bees-file-list" },
        h("span", { className: "bees-muted" }, "Files"),
        ...files.map((path) => h(Button, {
          className: `bees-file-chip ${viewer?.path === path ? "active" : ""}`,
          key: path,
          title: path,
          onClick: () => setViewer({ executionId: run.id, path })
        }, path))
      ) : null,
      viewer ? h(FilePreview, { target: viewer }) : null
    );
  }
  function NeedsYouPage({ ctx, data, workspaceIds, openWorkItem }) {
    const sessions = useSnapshot(ctx.sessions.list, { ids: [], byId: {} });
    const [selectedId, setSelectedId] = useState("");
    const [handled, setHandled] = useState(() => /* @__PURE__ */ new Set());
    const [handledRuns, setHandledRuns] = useState(() => /* @__PURE__ */ new Set());
    const seen = /* @__PURE__ */ new Set();
    const rows = data.runs.filter((run) => workspaceIds.includes(run.workspaceId) && run.sessionId).map((run) => ({ run, session: sessions.byId[run.sessionId], item: data.items.find(({ id }) => id === run.workItemId) })).filter(({ run }) => ["waiting_for_input", "waiting_for_approval", "interrupted"].includes(run.status) && !seen.has(run.sessionId) && seen.add(run.sessionId));
    const rowKey = rows.map(({ run, session: session2 }) => `${run.id}:${session2?.pendingInteraction ?? "none"}`).join("|");
    useEffect(() => setSelectedId((current) => rows.some(({ run }) => run.id === current) ? current : rows[0]?.run.id ?? ""), [rowKey]);
    useEffect(() => setHandledRuns((current) => new Set([...current].filter((id) => rows.some(({ run }) => run.id === id)))), [rowKey]);
    const selected = rows.find(({ run }) => run.id === selectedId) ?? rows[0];
    useEffect(() => {
      for (const { run } of rows) if (run.sessionId) void ctx.sessions.open(run.sessionId);
    }, [ctx, rowKey]);
    useEffect(() => {
      if (selected?.run.sessionId) ctx.sessions.open(selected.run.sessionId);
    }, [ctx, selected?.run.sessionId]);
    const binding = selected ? ctx.sessions.binding(selected.run.sessionId) : null;
    const session = useSnapshot(binding?.session);
    const interaction = session?.pending?.find((pending) => !handled.has(pending.key) && (selected?.session?.pendingInteraction === "plan-review" ? pending.kind === "question" : pending.kind === selected?.session?.pendingInteraction)) ?? session?.pending?.find((pending) => !handled.has(pending.key));
    const actionableRunIds = new Set(rows.map(({ run }) => run.id));
    const blocked = data.runs.filter((run) => workspaceIds.includes(run.workspaceId) && ["waiting_for_input", "waiting_for_approval", "interrupted"].includes(run.status) && !actionableRunIds.has(run.id));
    const answered = (key) => {
      setHandled((current) => new Set(current).add(key));
      const completed = new Set(handledRuns);
      if (selected) completed.add(selected.run.id);
      setHandledRuns(completed);
      const next = rows.find(({ run }) => !completed.has(run.id));
      if (next) setSelectedId(next.run.id);
    };
    return h(
      React.Fragment,
      null,
      h(
        "div",
        { className: "bees-callout" },
        h("h3", null, "Answer agents without leaving the queue"),
        h("div", null, "Questions and approvals update live. After you answer, Bees moves to the next waiting agent.")
      ),
      rows.length ? h(
        "div",
        { className: "bees-inbox" },
        h("div", { className: "bees-inbox-list", "aria-label": "Waiting agents" }, ...rows.map(({ run, session: summary, item }) => {
          const agent = data.assignments.find(({ id }) => id === run.resolvedAgentId);
          const rowTitle = item?.title ?? summary?.displayTitle ?? "Agent run";
          return h(
            "button",
            { type: "button", className: `bees-inbox-row ${run.id === selected?.run.id ? "active" : ""}`, key: run.id, onClick: () => setSelectedId(run.id) },
            h("span", { className: "bees-inbox-dot", "aria-hidden": "true" }),
            h(
              "span",
              { className: "bees-inbox-copy" },
              h("strong", null, rowTitle),
              h("span", { className: "bees-muted" }, agent?.name ?? summary?.agentPreset ?? "Agent")
            ),
            h("span", { className: "bees-badge" }, interactionName(summary?.pendingInteraction))
          );
        })),
        h(AgentInteractionPanel, {
          run: selected.run,
          item: selected.item,
          summary: selected.session,
          session,
          interaction,
          handled,
          onAnswered: answered,
          onOpenWork: selected.run.workItemId ? () => openWorkItem(selected.run.workItemId) : null
        })
      ) : h(Empty, null, "No live agent questions or approvals right now"),
      blocked.length ? h(
        "section",
        { className: "bees-blocked" },
        h("h3", null, "Other blocked work"),
        ...blocked.map((run) => {
          const item = data.items.find(({ id }) => id === run.workItemId);
          return h(
            "div",
            { className: "bees-row", key: run.id },
            h(
              "div",
              { className: "bees-row-main" },
              h("div", { className: "bees-row-title" }, item?.title ?? "Agent run"),
              h("div", { className: "bees-muted" }, run.status === "interrupted" ? "The prior wait was interrupted; retry the work to ask again." : "Reconnect to the agent or open the work item to recover.")
            ),
            run.workItemId ? h(Button, { onClick: () => openWorkItem(run.workItemId) }, "Open work") : null
          );
        })
      ) : null
    );
  }
  function WorkPage({ ctx, data, route, workspaceIds, workspaceId, teamId, workItemId, setWorkItemId, creating, setCreating, defaultProcessId, act }) {
    if (workItemId) return h(WorkItemCockpit, { ctx, data, rootId: workItemId, teamId, act, onBack: () => setWorkItemId("") });
    if (["work", "goal"].includes(creating)) return h(WorkItemForm, {
      data,
      kind: creating,
      workspaceId,
      defaultProcessId,
      act,
      onCancel: () => setCreating(""),
      onCreated: (id) => {
        setCreating("");
        setWorkItemId(id);
      }
    });
    const rows = workItemsFor(data, route, workspaceIds);
    return h(
      "div",
      null,
      route === "waiting" ? h(
        "div",
        { className: "bees-callout" },
        h("h3", null, "Needs you is a queue, not a process stage"),
        h("div", null, "Items appear here when an agent asks a question, needs approval, or cannot continue. Open one to change its agent, retry it, stop it, or archive it.")
      ) : null,
      h(
        "div",
        { className: "bees-row" },
        route === "goals" ? h("div", { className: "bees-muted bees-grow" }, "A goal is an outcome Bees owns; it can contain many work items.") : h("div", { className: "bees-grow" }),
        ["all-work", "goals"].includes(route) ? h(Button, {
          className: "primary",
          disabled: !workspaceId,
          onClick: () => setCreating(route === "goals" ? "goal" : "work")
        }, route === "goals" ? "New goal" : "New work") : null
      ),
      ...rows.length ? rows.map((item) => {
        const process = data.processes.find(({ id }) => id === item.processId);
        const stage = data.stages.find(({ id }) => id === item.stageId);
        return h(
          "button",
          { className: "bees-row bees-nav-link", key: item.id, onClick: () => setWorkItemId(item.id) },
          h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, item.title), h("div", { className: "bees-muted" }, `${process?.name ?? "Process"} · ${stage?.name ?? "Stage"}`)),
          h("span", { className: "bees-status" }, item.kind)
        );
      }) : [h(Empty, { key: "empty" }, route === "goals" ? "No goals yet" : route === "waiting" ? "Nothing needs you right now" : "No work in this view")]
    );
  }

  // dsh-runtime/plugin/client/processes.js
  function ProcessForm({ kind, draft, workspaceId, act, onCancel, onCreated }) {
    const template = kind === "template";
    const initialStages = draft?.stages ?? ["Plan", "Doing", "Done"];
    if (!workspaceId) return h(
      "div",
      { className: "bees-stack" },
      h("div", { className: "bees-page-head" }, h(Button, { onClick: onCancel }, "← Processes"), h("h2", null, template ? "New template" : "New process")),
      h(Empty, null, "Choose one workspace before creating a process.")
    );
    return h(
      "form",
      { className: "bees-box bees-form", onSubmit: async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const stages = String(form.get("stages") ?? "").split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
        const created = await act({
          action: template ? "create_process_template" : "create_process",
          workspaceId,
          name: String(form.get("name") ?? ""),
          description: String(form.get("description") ?? ""),
          stages
        });
        if (created?.id) onCreated(created.id);
      } },
      h(
        "div",
        { className: "bees-page-head" },
        h(Button, { onClick: onCancel }, "← Processes"),
        h(
          "div",
          null,
          h("h2", null, template ? "New process template" : draft ? "Create process from template" : "New process"),
          h("div", { className: "bees-muted" }, template ? "A template is a reusable blueprint. It does not run work by itself." : "Design the whole workflow here. Each line becomes a stage; the final stage is Done.")
        )
      ),
      h("label", null, template ? "Template name" : "Process name", h("input", {
        className: "bees-input",
        name: "name",
        required: true,
        autoFocus: true,
        defaultValue: draft?.name ?? "",
        placeholder: template ? "Editorial workflow" : "Publish an article"
      })),
      h("label", null, "Description", h("textarea", {
        className: "bees-textarea",
        name: "description",
        defaultValue: draft?.description ?? "",
        placeholder: "When should someone use this workflow?"
      })),
      h("label", null, "Stages (one per line)", h("textarea", {
        className: "bees-textarea",
        name: "stages",
        required: true,
        defaultValue: initialStages.join("\n"),
        "aria-describedby": "process-stage-help"
      })),
      h("div", { className: "bees-muted", id: "process-stage-help" }, "Use 2–12 unique stages. A stage named Review gets an independent reviewer; the last stage completes the work."),
      h(
        "div",
        { className: "bees-detail-actions" },
        h("button", { className: "bees-btn primary" }, template ? "Create template" : "Create process"),
        h(Button, { onClick: onCancel }, "Cancel")
      )
    );
  }
  function ProcessesPage({ data, route, workspaceIds, workspaceId, teamId, processId, setProcessId, openWorkItem, creating, setCreating, processDraft, setProcessDraft, act }) {
    const processes = data.processes.filter((process) => workspaceIds.includes(process.workspaceId));
    if (["process", "template"].includes(creating)) return h(ProcessForm, {
      kind: creating,
      draft: processDraft,
      workspaceId,
      act,
      onCancel: () => {
        setCreating("");
        setProcessDraft(null);
      },
      onCreated: (id) => {
        const wasTemplate = creating === "template";
        setCreating("");
        setProcessDraft(null);
        if (!wasTemplate) setProcessId(id);
      }
    });
    const edit = async (process) => {
      const name = await ask("Process name", process.name);
      if (!name) return;
      const description = await ask("Description", process.description) ?? process.description;
      const current = data.stages.filter(({ processId: processId2 }) => processId2 === process.id).map(({ name: name2 }) => name2);
      const stages = (await ask("Stages, comma separated", current.join(", ")) ?? "").split(",").map((value) => value.trim()).filter(Boolean);
      await act({ action: "edit_process", processId: process.id, name, description, stages });
    };
    if (processId) {
      const process = processes.find(({ id }) => id === processId);
      if (process) {
        const attached = data.processAttachments.filter((row) => row.processId === process.id);
        const locations = data.locations.filter((row) => row.teamId === teamId && !row.archivedAt);
        const processStages = data.stages.filter(({ processId: processId2 }) => processId2 === process.id);
        const processAgents = data.assignments.filter(({ workspaceId: workspaceId2 }) => workspaceId2 === process.workspaceId);
        const processPools = data.pools.filter(({ workspaceId: workspaceId2 }) => workspaceId2 === process.workspaceId);
        const roots = data.items.filter((item) => item.processId === process.id && !item.parentId && !item.archivedAt && item.kind !== "run");
        const attach = async () => {
          const available = locations.filter((location2) => !attached.some(({ locationId }) => locationId === location2.id));
          const name = await ask(`Team location:
${available.map(({ name: name2 }) => name2).join("\n")}`);
          const location = available.find((row) => row.name === name);
          if (!location) return;
          const relativePath = location.kind === "folder" ? await ask("Relative file or folder inside this location (optional)", "") : "";
          if (relativePath !== null) await act({ action: "attach_location", processId: process.id, locationId: location.id, relativePath });
        };
        const setStageRoute = async (stage, value) => {
          const separator = value.indexOf(":");
          await act({
            action: "set_stage_route",
            stageId: stage.id,
            targetType: separator < 0 ? null : value.slice(0, separator),
            targetId: separator < 0 ? null : value.slice(separator + 1),
            requiredCapabilities: stage.requiredCapabilities
          });
        };
        const setRequirements = async (stage) => {
          const value = await ask("Required capabilities, comma separated", stage.requiredCapabilities.join(", "));
          if (value === null) return;
          await act({
            action: "set_stage_route",
            stageId: stage.id,
            targetType: stage.routeType,
            targetId: stage.routeTargetId,
            requiredCapabilities: value.split(",").map((entry) => entry.trim()).filter(Boolean)
          });
        };
        const saveTemplate = async () => {
          const name = await ask("Template name", process.name);
          if (!name) return;
          await act({ action: "save_process_template", processId: process.id, name });
        };
        const archiveProcess = async () => {
          if (!await confirmAction2(`Archive “${process.name}”? Its work and history will be preserved.`)) return;
          if (await act({ action: "archive_process", processId: process.id })) setProcessId("");
        };
        return h(
          "div",
          null,
          h(
            "div",
            { className: "bees-row" },
            h(Button, { onClick: () => setProcessId("") }, "← All processes"),
            h("strong", null, process.name),
            h("div", { className: "bees-grow" }),
            ...attached.map(({ locationId, relativePath }) => {
              const location = locations.find(({ id }) => id === locationId);
              return location ? h(Button, { key: `${locationId}:${relativePath}`, onClick: () => act({ action: "detach_location", processId: process.id, locationId }) }, `$[${location.name}]${relativePath ? `/${relativePath}` : ""} ×`) : null;
            }),
            h(Button, { onClick: attach, disabled: !locations.some((location) => !attached.some(({ locationId }) => locationId === location.id)) }, "Add files"),
            process.kind === "standard" ? h(Button, { onClick: saveTemplate }, "Save as template") : null,
            h(Button, { className: "primary", onClick: () => openWorkItem(null, process.id) }, "New work")
          ),
          h(
            "section",
            { className: "bees-box" },
            h("h3", null, "Stage routing"),
            h("p", { className: "bees-muted" }, "Assign an agent or pool to each stage here—including a stage named Waiting. “Needs you” is a separate queue for blocked work, not an assignable stage. Workspace defaults remain the fallback."),
            ...processStages.map((stage) => h(
              "div",
              { className: "bees-row", key: stage.id },
              h(
                "div",
                { className: "bees-row-main" },
                h("div", { className: "bees-row-title" }, stage.name),
                h("div", { className: "bees-muted" }, stage.requiredCapabilities.length ? `Requires: ${stage.requiredCapabilities.join(", ")}` : stage.driver)
              ),
              stage.driver === "terminal" ? h("span", { className: "bees-badge" }, "Terminal") : h(
                React.Fragment,
                null,
                h(
                  "select",
                  {
                    className: "bees-select",
                    value: stage.routeType ? `${stage.routeType}:${stage.routeTargetId}` : "",
                    "aria-label": `${stage.name} agent route`,
                    onChange: (event) => void setStageRoute(stage, event.target.value)
                  },
                  h("option", { value: "" }, `Workspace ${stage.driver === "review" ? "reviewer" : "worker"}`),
                  h("optgroup", { label: "Agents" }, ...processAgents.map((agent) => h("option", { value: `agent:${agent.id}`, key: agent.id, disabled: !agent.enabled }, agent.name))),
                  h("optgroup", { label: "Pools" }, ...processPools.map((pool) => h("option", { value: `pool:${pool.id}`, key: pool.id }, pool.name)))
                ),
                h(Button, { onClick: () => setRequirements(stage) }, "Requirements")
              )
            ))
          ),
          ...roots.length ? roots.map((item) => {
            const stage = data.stages.find(({ id }) => id === item.stageId);
            return h(
              "button",
              { className: "bees-row bees-nav-link", key: item.id, onClick: () => openWorkItem(item.id) },
              h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, item.title), h("div", { className: "bees-muted" }, `${stage?.name ?? "Stage"} · ${item.runtimePhase}`)),
              h("span", { className: `bees-status bees-${item.runtimePhase}` }, item.runtimePhase)
            );
          }) : [h(Empty, { key: "empty" }, "No root work items in this process")],
          process.kind === "standard" ? h(
            "section",
            { className: "bees-box bees-danger-zone" },
            h("h3", null, "Archive process"),
            h("p", { className: "bees-muted" }, "Archive hides this process without breaking work history or database links."),
            h(Button, { className: "danger", onClick: archiveProcess }, "Archive process")
          ) : null
        );
      }
    }
    if (route === "templates") {
      const templates = (data.templates ?? []).filter((template) => workspaceIds.includes(template.workspaceId));
      return h(
        "div",
        null,
        h(
          "div",
          { className: "bees-callout" },
          h("h3", null, "A template is a reusable process blueprint"),
          h("div", null, "A process runs real work. A template only remembers the name, explanation, and stages so you can create similar processes quickly.")
        ),
        h(
          "div",
          { className: "bees-row" },
          h("div", { className: "bees-grow" }),
          h(Button, { className: "primary", disabled: !workspaceId, onClick: () => {
            setProcessDraft(null);
            setCreating("template");
          } }, "New template")
        ),
        ...templates.length ? templates.map((template) => h(
          "div",
          { className: "bees-row", key: template.id },
          h(
            "div",
            { className: "bees-row-main" },
            h("div", { className: "bees-row-title" }, template.name),
            h("div", { className: "bees-muted" }, [template.description, template.stages.join(" → ")].filter(Boolean).join(" · "))
          ),
          h(Button, {
            className: "primary",
            disabled: template.workspaceId !== workspaceId,
            onClick: () => {
              setProcessDraft(template);
              setCreating("process");
            }
          }, "Use template"),
          h(Button, { className: "danger", onClick: async () => await confirmAction2(`Archive template “${template.name}”?`) && act({ action: "archive_process_template", templateId: template.id }) }, "Archive")
        )) : [h(Empty, { key: "empty" }, "No templates yet. Create one here or save an existing process as a template.")]
      );
    }
    return h(
      "div",
      null,
      h("div", { className: "bees-row" }, h("div", { className: "bees-grow" }), h(Button, {
        className: "primary",
        disabled: !workspaceId,
        onClick: () => {
          setProcessDraft(null);
          setCreating("process");
        }
      }, "New process")),
      ...processes.length ? processes.map((process) => {
        const stages = data.stages.filter(({ processId: processId2 }) => processId2 === process.id);
        return h(
          "div",
          { className: "bees-row", key: process.id },
          h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, process.name), h("div", { className: "bees-muted" }, [process.description, stages.map(({ name }) => name).join(" → ")].filter(Boolean).join(" · "))),
          h(Button, { onClick: () => setProcessId(process.id) }, "Open"),
          h(Button, { onClick: () => edit(process) }, "Edit")
        );
      }) : [h(Empty, { key: "empty" }, "No processes yet")]
    );
  }

  // dsh-runtime/plugin/client/agents.js
  var CODEX_CHANNELS = [
    ["__bees_latest_sol__", "sol", "Sol"],
    ["__bees_latest_terra__", "terra", "Terra"],
    ["__bees_latest_luna__", "luna", "Luna"]
  ];
  function latestCodexModel(models, family) {
    const pattern = new RegExp(`^gpt-\\d+(?:\\.\\d+)*-${family}$`, "i");
    return models.filter(({ id }) => pattern.test(id)).sort((left, right) => right.id.localeCompare(left.id, void 0, { numeric: true }))[0];
  }
  function agentModelLabel(group, model) {
    if (group.id === "claude-code") {
      if (model.id === "default") return "CLI default (auto-updates)";
      if (["sonnet", "opus", "haiku"].includes(model.id))
        return `Latest ${model.id[0].toUpperCase()}${model.id.slice(1)} (auto-updates)`;
    }
    return model.name === model.id ? model.id : `${model.name} (${model.id})`;
  }
  function AgentModelSelect({ ctx, value = "", effort = "", systemDefault, allowSystemDefault = true }) {
    const [catalog, setCatalog] = useState({ groups: [], failures: [], loading: true, error: "" });
    const [route, setRoute] = useState(value);
    const [reasoningEffort, setReasoningEffort] = useState(effort);
    useEffect(() => {
      let mounted = true;
      void ctx.get("connection").api.llm.models({}).then((response) => {
        if (!response.result.ok) throw new Error(response.result.error.message);
        if (mounted) setCatalog({ ...response.result.value, loading: false, error: "" });
      }).catch((reason) => {
        if (mounted) setCatalog({
          groups: [],
          failures: [],
          loading: false,
          error: reason instanceof Error ? reason.message : String(reason)
        });
      });
      return () => {
        mounted = false;
      };
    }, [ctx]);
    const groups = [...catalog.groups].sort((left, right) => left.name.localeCompare(right.name, void 0, { sensitivity: "base" }));
    const codex = groups.find(({ id }) => id === "openai-codex");
    const channels = CODEX_CHANNELS.flatMap(([id, family, name]) => {
      const model = latestCodexModel(codex?.models ?? [], family);
      return model ? [{ id, name, model, route: `openai-codex/${id}` }] : [];
    });
    const routes = new Set(groups.flatMap((group) => group.models.map((model) => `${group.id}/${model.id}`)));
    for (const channel of channels) routes.add(channel.route);
    const preserveCurrent = value && (catalog.loading || catalog.error || !routes.has(value));
    const selectedModel = channels.find((channel) => channel.route === route)?.model ?? groups.flatMap(({ id, models }) => models.map((model) => ({ ...model, route: `${id}/${model.id}` }))).find((model) => model.route === route);
    const efforts = selectedModel?.reasoning?.efforts ?? [];
    const effortIds = new Set(efforts.map(({ id }) => id));
    const preserveEffort = reasoningEffort && !effortIds.has(reasoningEffort);
    const defaultEffort = selectedModel?.reasoning?.defaultEffort;
    const defaultEffortName = efforts.find(({ id }) => id === defaultEffort)?.name ?? defaultEffort;
    const systemDefaultLabel = systemDefault?.provider && systemDefault?.model ? `System default — ${systemDefault.provider}/${systemDefault.model}${systemDefault.reasoningEffort ? ` · ${systemDefault.reasoningEffort} effort` : ""}` : "System default (auto-updates)";
    return h(
      React.Fragment,
      null,
      h(
        "label",
        null,
        "Model",
        h(
          "select",
          { className: "bees-select", name: "model", value: route, required: !allowSystemDefault, onChange: (event) => {
            setRoute(event.target.value);
            setReasoningEffort("");
          } },
          allowSystemDefault ? h("option", { value: "" }, catalog.loading ? `${systemDefaultLabel} (loading available models…)` : systemDefaultLabel) : !route ? h("option", { value: "", disabled: true }, catalog.loading ? "Loading available models…" : "Choose a model") : null,
          preserveCurrent ? h("option", { value }, catalog.loading ? `Current: ${value}` : catalog.error ? `Current: ${value} (catalog unavailable)` : `Current: ${value} (unavailable)`) : null,
          ...groups.flatMap((group) => [
            h("option", { value: `__provider_${group.id}`, disabled: true, key: `provider:${group.id}` }, group.name),
            ...group.id === "openai-codex" ? channels.map((channel) => h("option", {
              value: channel.route,
              key: `${group.id}:channel:${channel.id}`
            }, `  Latest ${channel.name} (auto-updates)`)) : [],
            ...group.models.map((model) => h(
              "option",
              { value: `${group.id}/${model.id}`, key: `${group.id}:${model.id}` },
              `  ${agentModelLabel(group, model)}`
            ))
          ])
        ),
        catalog.error ? h("span", { className: "bees-muted", role: "status" }, `Could not load available models: ${catalog.error}`) : catalog.failures.length ? h(
          "span",
          { className: "bees-muted", role: "status" },
          `Some providers could not load: ${catalog.failures.map(({ name }) => name).join(", ")}`
        ) : null
      ),
      h(
        "label",
        null,
        "Reasoning effort",
        h(
          "select",
          {
            className: "bees-select",
            name: "reasoningEffort",
            value: reasoningEffort,
            disabled: !selectedModel?.reasoning && !reasoningEffort,
            onChange: (event) => setReasoningEffort(event.target.value)
          },
          h("option", { value: "" }, defaultEffortName ? `Model default (${defaultEffortName})` : "Model default (recommended)"),
          preserveEffort ? h("option", { value: reasoningEffort }, `Current: ${reasoningEffort} (unavailable)`) : null,
          ...efforts.map((level) => h("option", { value: level.id, key: level.id }, level.name))
        ),
        !route ? h("span", { className: "bees-muted" }, "Choose a model to override its reasoning effort.") : null
      )
    );
  }
  function SystemDefaultSettings({ ctx, systemDefault, reload }) {
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const route = systemDefault?.provider && systemDefault?.model ? `${systemDefault.provider}/${systemDefault.model}` : "";
    const save = async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const modelRoute = String(form.get("model") ?? "");
      const separator = modelRoute.indexOf("/");
      if (separator < 1 || separator === modelRoute.length - 1) return setMessage("Choose a model.");
      setBusy(true);
      setMessage("");
      try {
        await request("/bees-api/system-default-model", { method: "POST", body: JSON.stringify({
          provider: modelRoute.slice(0, separator),
          model: modelRoute.slice(separator + 1),
          reasoningEffort: String(form.get("reasoningEffort") ?? "")
        }) });
        await reload();
        setMessage("System default updated.");
      } catch (reason) {
        setMessage(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusy(false);
      }
    };
    return h(
      "section",
      { className: "bees-box bees-system-default" },
      h("h2", null, "System default"),
      h("p", { className: "bees-muted" }, "New agents use this model unless you choose a different one. Choose another default before turning this connection off."),
      h(
        "form",
        { key: `${route}:${systemDefault?.reasoningEffort ?? ""}`, onSubmit: save },
        h(AgentModelSelect, { ctx, value: route, effort: systemDefault?.reasoningEffort, allowSystemDefault: false }),
        h(Button, { type: "submit", className: "primary", disabled: busy }, busy ? "Saving…" : "Save default")
      ),
      message ? h("div", { className: message.endsWith("updated.") ? "bees-muted" : "bees-error", role: "status" }, message) : null
    );
  }
  function AgentCreateForm({ ctx, data, workspaceId, act, onCancel, onCreated }) {
    const presets = data.presets.filter(({ broken }) => !broken);
    if (!workspaceId) return h(Empty, null, "Choose one workspace before creating an agent.");
    return h(
      "form",
      { className: "bees-box bees-form bees-agent-form", onSubmit: async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const created = await act({
          action: "add_agent_assignment",
          workspaceId,
          name: String(form.get("name") ?? ""),
          presetId: String(form.get("presetId") ?? ""),
          description: String(form.get("description") ?? ""),
          instructions: String(form.get("instructions") ?? ""),
          model: String(form.get("model") ?? ""),
          reasoningEffort: String(form.get("reasoningEffort") ?? ""),
          capabilities: String(form.get("capabilities") ?? "").split(","),
          enabled: form.get("enabled") === "on",
          maxConcurrency: Number(form.get("maxConcurrency") ?? 0)
        });
        if (created?.id) onCreated(created.id);
      } },
      h(
        "div",
        { className: "bees-page-head" },
        h(Button, { onClick: onCancel }, "← Agents"),
        h("div", null, h("h2", null, "New agent"), h("div", { className: "bees-muted" }, "Configure the agent's complete toolbox and routing identity before adding it."))
      ),
      h("label", null, "Name", h("input", { className: "bees-input", name: "name", required: true, autoFocus: true, placeholder: "Research agent" })),
      h("label", null, "Description", h("input", { className: "bees-input", name: "description", placeholder: "What should this agent be used for?" })),
      h("label", null, "Agent preset (skills and tools)", h(
        "select",
        {
          className: "bees-select",
          name: "presetId",
          required: true,
          defaultValue: presets.find(({ id }) => id === "standard")?.id ?? presets[0]?.id
        },
        ...presets.map((preset) => h("option", { value: preset.id, key: preset.id }, preset.name))
      )),
      h(AgentModelSelect, { ctx, systemDefault: data.systemDefaultModel }),
      h("label", null, "Capabilities (comma separated)", h("input", { className: "bees-input", name: "capabilities", placeholder: "research, writing" })),
      h("label", null, "Maximum concurrent runs (0 is unlimited)", h("input", { className: "bees-input", name: "maxConcurrency", type: "number", min: 0, max: 1e3, defaultValue: 0 })),
      h("label", null, h("span", null, h("input", { name: "enabled", type: "checkbox", defaultChecked: true }), " Available for routing")),
      h("label", null, "Instructions", h("textarea", { className: "bees-textarea", name: "instructions", placeholder: "How should this agent complete work?" })),
      h(
        "div",
        { className: "bees-detail-actions" },
        h("button", { className: "bees-btn primary", disabled: !presets.length }, "Create agent"),
        h(Button, { onClick: onCancel }, "Cancel")
      )
    );
  }
  function PoolCreateForm({ workspaceId, act, onCancel, onCreated }) {
    if (!workspaceId) return h(Empty, null, "Choose one workspace before creating a pool.");
    return h(
      "form",
      { className: "bees-box bees-form", onSubmit: async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const created = await act({
          action: "add_agent_pool",
          workspaceId,
          name: String(form.get("name") ?? ""),
          description: String(form.get("description") ?? "")
        });
        if (created?.id) onCreated(created.id);
      } },
      h(
        "div",
        { className: "bees-page-head" },
        h(Button, { onClick: onCancel }, "← Pools"),
        h("div", null, h("h2", null, "New agent pool"), h("div", { className: "bees-muted" }, "Name the interchangeable role now, then add and prioritize member agents."))
      ),
      h("label", null, "Name", h("input", { className: "bees-input", name: "name", required: true, autoFocus: true, placeholder: "Editorial reviewers" })),
      h("label", null, "Description", h("textarea", { className: "bees-textarea", name: "description", placeholder: "When should Bees route work to this pool?" })),
      h("div", { className: "bees-detail-actions" }, h("button", { className: "bees-btn primary" }, "Create pool"), h(Button, { onClick: onCancel }, "Cancel"))
    );
  }
  function AgentsPage({ ctx, data, route, workspaceIds, workspaceId, creating, setCreating, act, openDshSettings }) {
    const assignments = data.assignments.filter((row) => workspaceIds.includes(row.workspaceId));
    const pools = data.pools.filter((row) => workspaceIds.includes(row.workspaceId));
    const [selectedId, setSelectedId] = useState("");
    const [selectedPoolId, setSelectedPoolId] = useState("");
    const selected = assignments.find(({ id }) => id === selectedId);
    const selectedPool = pools.find(({ id }) => id === selectedPoolId);
    if (creating === "agent") return h(AgentCreateForm, {
      ctx,
      data,
      workspaceId,
      act,
      onCancel: () => setCreating(""),
      onCreated: (id) => {
        setCreating("");
        setSelectedId(id);
      }
    });
    if (creating === "pool") return h(PoolCreateForm, {
      workspaceId,
      act,
      onCancel: () => setCreating(""),
      onCreated: (id) => {
        setCreating("");
        setSelectedPoolId(id);
      }
    });
    if (route === "skills") return h(
      "div",
      { className: "bees-stack" },
      h(
        "div",
        { className: "bees-callout" },
        h("h3", null, "Skills are reusable instructions and tools"),
        h("div", null, "An agent preset is its toolbox: prompt, skills, tools, and permissions. Choose a preset when you create or configure an agent; manage the preset's skill library in DSH settings.")
      ),
      h(
        "section",
        { className: "bees-box" },
        h(
          "div",
          { className: "bees-row" },
          h(
            "div",
            { className: "bees-row-main" },
            h("h3", null, "Available agent presets"),
            h("div", { className: "bees-muted" }, "Agents select one of these libraries.")
          ),
          h(Button, { className: "primary", onClick: openDshSettings }, "Manage presets & skills")
        ),
        ...data.presets.length ? data.presets.map((preset) => h(
          "div",
          { className: "bees-row", key: preset.id },
          h(
            "div",
            { className: "bees-row-main" },
            h("div", { className: "bees-row-title" }, preset.name),
            h("div", { className: "bees-muted" }, preset.broken ? "Unavailable" : preset.description || "Agent preset")
          ),
          h("span", { className: "bees-badge" }, preset.trust ?? "preset")
        )) : [h(Empty, { key: "empty" }, "No agent presets are available")]
      ),
      h(
        "section",
        { className: "bees-box" },
        h("h3", null, "Importing public libraries"),
        h("p", { className: "bees-muted" }, "Public skill, tool, agent, and MCP repositories need a reviewed import flow because they can add instructions, code, network access, and permissions. Bees should show provenance and requested permissions before installation—not bulk-enable unknown repositories.")
      )
    );
    if (route === "pools") {
      if (selectedPool) {
        const members = data.poolMembers.filter(({ poolId }) => poolId === selectedPool.id);
        const memberAgents = members.map((member) => ({
          ...member,
          agent: assignments.find(({ id }) => id === member.agentAssignmentId)
        })).filter(({ agent }) => agent);
        const available = assignments.filter(({ workspaceId: id, id: agentId }) => id === selectedPool.workspaceId && !members.some(({ agentAssignmentId }) => agentAssignmentId === agentId));
        const addMember = async () => {
          const name = await ask(`Agent:
${available.map(({ name: name2 }) => name2).join("\n")}`, available[0]?.name ?? "");
          const agent = available.find((row) => row.name === name);
          if (!agent) return;
          const priority = await ask("Priority (1 runs first)", "100", "number");
          if (priority === null) return;
          await act({ action: "set_agent_pool_member", agentPoolId: selectedPool.id, agentAssignmentId: agent.id, priority: Number(priority) });
        };
        return h(
          "div",
          { className: "bees-stack" },
          h(
            "form",
            { className: "bees-box bees-form", onSubmit: async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              await act({
                action: "edit_agent_pool",
                agentPoolId: selectedPool.id,
                name: String(form.get("name") ?? ""),
                description: String(form.get("description") ?? "")
              });
            } },
            h("div", { className: "bees-row" }, h(Button, { onClick: () => setSelectedPoolId("") }, "← Pools"), h("strong", null, selectedPool.name)),
            h("label", null, "Name", h("input", { className: "bees-input", name: "name", defaultValue: selectedPool.name })),
            h("label", null, "Description", h("input", { className: "bees-input", name: "description", defaultValue: selectedPool.description })),
            h("div", { className: "bees-detail-actions" }, h("button", { className: "bees-btn primary" }, "Save pool"))
          ),
          h(
            "section",
            { className: "bees-box" },
            h(
              "div",
              { className: "bees-row" },
              h("h3", null, "Members"),
              h("div", { className: "bees-grow" }),
              h(Button, { className: "primary", disabled: !available.length, onClick: addMember }, "Add agent")
            ),
            ...memberAgents.length ? memberAgents.map((member) => h(
              "div",
              { className: "bees-row", key: member.agentAssignmentId },
              h(
                "div",
                { className: "bees-row-main" },
                h("div", { className: "bees-row-title" }, member.agent.name),
                h("div", { className: "bees-muted" }, `Priority ${member.priority}${member.lastAssignedAt ? ` · last selected ${new Date(member.lastAssignedAt).toLocaleString()}` : " · never selected"}`)
              ),
              h(Button, { onClick: () => act({
                action: "set_agent_pool_member",
                agentPoolId: selectedPool.id,
                agentAssignmentId: member.agentAssignmentId,
                priority: member.priority,
                enabled: !member.enabled
              }) }, member.enabled ? "Pause" : "Enable"),
              h(Button, { className: "danger", onClick: async () => await confirmAction(`Remove ${member.agent.name} from ${selectedPool.name}?`) && act({ action: "set_agent_pool_member", agentPoolId: selectedPool.id, agentAssignmentId: member.agentAssignmentId, remove: true }) }, "Remove")
            )) : [h(Empty, { key: "empty" }, "No agents in this pool yet")]
          )
        );
      }
      return h(
        "div",
        null,
        h(
          "div",
          { className: "bees-callout" },
          h("h3", null, "A pool is a backup bench"),
          h("div", null, "Put interchangeable agents in a pool when any one of them can do the same stage. Bees picks an available compatible agent deterministically. Use one named agent when continuity matters.")
        ),
        h(
          "div",
          { className: "bees-row" },
          h("div", { className: "bees-grow" }),
          h(Button, { className: "primary", disabled: !workspaceId, onClick: () => setCreating("pool") }, "New pool")
        ),
        ...pools.length ? pools.map((pool) => {
          const members = data.poolMembers.filter(({ poolId }) => poolId === pool.id);
          return h(
            "div",
            { className: "bees-row", key: pool.id },
            h(
              "div",
              { className: "bees-row-main" },
              h("div", { className: "bees-row-title" }, pool.name),
              h("div", { className: "bees-muted" }, `${members.filter(({ enabled }) => enabled).length} enabled agents · ${pool.description || "Deterministic agent pool"}`)
            ),
            h(Button, { onClick: () => setSelectedPoolId(pool.id) }, "Configure")
          );
        }) : [h(Empty, { key: "empty" }, "No agent pools yet")]
      );
    }
    if (selected) return h(
      "form",
      { className: "bees-box bees-form bees-agent-form", key: selected.id, onSubmit: async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const saved = await act({
          action: "edit_agent_assignment",
          agentAssignmentId: selected.id,
          name: String(form.get("name") ?? selected.name),
          presetId: String(form.get("presetId") ?? selected.presetId),
          description: String(form.get("description") ?? ""),
          instructions: String(form.get("instructions") ?? ""),
          model: String(form.get("model") ?? ""),
          reasoningEffort: String(form.get("reasoningEffort") ?? ""),
          capabilities: String(form.get("capabilities") ?? "").split(","),
          enabled: form.get("enabled") === "on",
          maxConcurrency: Number(form.get("maxConcurrency") ?? 0)
        });
        if (saved) setSelectedId("");
      } },
      h("div", { className: "bees-row" }, h(Button, { onClick: () => setSelectedId("") }, "← Agents"), h("strong", null, selected.name), h("div", { className: "bees-grow" }), selected.systemRole ? h("span", { className: "bees-badge" }, `Bees ${selected.systemRole}`) : null),
      h("label", null, "Name", h("input", { className: "bees-input", name: "name", defaultValue: selected.name, disabled: Boolean(selected.systemRole) })),
      h("label", null, "Description", h("input", { className: "bees-input", name: "description", defaultValue: selected.description })),
      h("label", null, "DSH preset", h("select", { className: "bees-select", name: "presetId", defaultValue: selected.presetId }, ...data.presets.filter(({ broken }) => !broken).map((preset) => h("option", { value: preset.id, key: preset.id }, preset.name)))),
      h(AgentModelSelect, {
        ctx,
        value: selected.model ?? "",
        effort: selected.reasoningEffort ?? "",
        systemDefault: data.systemDefaultModel
      }),
      h("label", null, "Capabilities, comma separated", h("input", { className: "bees-input", name: "capabilities", defaultValue: selected.capabilities.join(", "), placeholder: "research, writing" })),
      h("label", null, "Maximum concurrent runs (0 is unlimited)", h("input", { className: "bees-input", name: "maxConcurrency", type: "number", min: 0, max: 1e3, defaultValue: selected.maxConcurrency })),
      h("label", null, h("input", { name: "enabled", type: "checkbox", defaultChecked: selected.enabled }), " Available for routing"),
      h("label", null, "Instructions", h("textarea", { className: "bees-textarea", name: "instructions", defaultValue: selected.instructions, placeholder: selected.systemRole === "reviewer" ? "How this workspace should review work" : "How this agent should complete work" })),
      h("p", { className: "bees-muted" }, selected.systemRole ? "Bees keeps the runtime completion protocol protected. These instructions customize how this workspace's built-in agent performs its role." : "These instructions are mounted with the selected DSH preset."),
      h("div", { className: "bees-detail-actions" }, h("button", { className: "bees-btn primary" }, "Save agent"))
    );
    return h(
      "div",
      null,
      h("div", { className: "bees-row" }, h("div", { className: "bees-grow" }), h(Button, { className: "primary", disabled: !workspaceId, onClick: () => setCreating("agent") }, "New agent")),
      ...assignments.length ? assignments.map((agent) => h("div", { className: "bees-row", key: agent.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, agent.name), h("div", { className: "bees-muted" }, `${agent.enabled ? agent.presetId : "Unavailable"}${agent.model ? ` · ${agent.model}` : " · default model"}${agent.reasoningEffort ? ` · ${agent.reasoningEffort} effort` : ""}${agent.capabilities.length ? ` · ${agent.capabilities.join(", ")}` : ""} · ${agent.description || "Agent preset assignment"}`)), agent.systemRole ? h("span", { className: "bees-badge" }, `Bees ${agent.systemRole}`) : null, h(Button, { onClick: () => setSelectedId(agent.id) }, "Configure"))) : [h(Empty, { key: "empty" }, "No agents assigned to this scope")]
    );
  }

  // dsh-runtime/plugin/client/resources.js
  function FilesPage({ ctx, data, route, teamId, act }) {
    const team = data.teams.find(({ id }) => id === teamId);
    const locations = data.locations.filter((row) => row.teamId === teamId && !row.archivedAt);
    const pickFolder = async () => ctx.workspaces.pickDirectory();
    const addFolder = async () => {
      const path = await pickFolder();
      if (!path) return;
      const name = await ask("Team location name", path.split(/[\\/]/).filter(Boolean).pop() ?? "Files");
      if (name) await act({ action: "add_location", teamId, name, kind: "folder", path });
    };
    const addFile = async () => {
      const path = typeof ctx.workspaces.pickFile === "function" ? await ctx.workspaces.pickFile() : await ask("Absolute path to a file on this device", "");
      if (!path) return;
      const name = await ask("Team file name", path.split(/[\\/]/).filter(Boolean).pop() ?? "File");
      if (name) await act({ action: "add_location", teamId, name, kind: "file", path });
    };
    const pickMapping = async (location) => location.kind === "folder" ? pickFolder() : ask(`Absolute path for ${location.name} on this device`, location.localPath ?? "");
    if (route === "references") return h(
      "div",
      { className: "bees-grid" },
      ...locations.map((location) => h("section", { className: "bees-box", key: location.id }, h("h3", null, `$[${location.name}]`), h("p", { className: "bees-muted" }, `Stable logical id ${location.logicalId}. Add /relative/path when referencing a child.`))),
      locations.length ? null : h(Empty, null, "Create a location before using logical references")
    );
    if (route === "mappings") return h("div", null, ...locations.map((location) => h(
      "div",
      { className: "bees-row", key: location.id },
      h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, location.name), h("div", { className: "bees-muted" }, location.localPath || "Not mapped on this device")),
      h(Button, { onClick: async () => {
        const path = await pickMapping(location);
        if (path) await act({ action: "map_location", locationId: location.id, path });
      } }, location.mapped ? "Change" : "Map"),
      location.mapped ? h(Button, { onClick: () => act({ action: "unmap_location", locationId: location.id }) }, "Remove mapping") : null
    )), locations.length ? null : h(Empty, null, "No team locations to map"));
    return h(
      "div",
      null,
      h(
        "div",
        { className: "bees-row" },
        h("div", { className: "bees-grow" }),
        h(Button, { disabled: !teamId || team?.role !== "admin", onClick: addFile }, "Add file"),
        h(Button, { className: "primary", disabled: !teamId || team?.role !== "admin", onClick: addFolder }, "Add folder")
      ),
      ...locations.length ? locations.map((location) => h(
        "div",
        { className: "bees-row", key: location.id },
        h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, location.name), h("div", { className: "bees-muted" }, `${location.kind} · ${location.mapped ? "mapped on this device" : "mapping needed"}`)),
        h(Button, { className: "danger", disabled: team?.role !== "admin", onClick: async () => await confirmAction2(`Archive “${location.name}”? This will not delete the external folder.`) && act({ action: "archive_location", locationId: location.id }) }, "Archive")
      )) : [h(Empty, { key: "empty" }, "No shared team locations yet")]
    );
  }
  function ActivityPage({ data, route, workspaceIds, setRoute, openWorkItem, openProcess }) {
    const runs = data.runs.filter((run2) => workspaceIds.includes(run2.workspaceId));
    const [events, setEvents] = useState([]);
    const [selected, setSelected] = useState("");
    const [history, setHistory] = useState(null);
    useEffect(() => {
      if (route === "audit") void request2("/bees-api/audit").then((value) => setEvents(value.events));
    }, [route]);
    useEffect(() => {
      let active = true;
      if (!selected) {
        setHistory(null);
        return () => {
          active = false;
        };
      }
      request2(`/bees-api/run-history?executionId=${encodeURIComponent(selected)}`).then((value) => active && setHistory(value.history)).catch((error) => active && setHistory({ error: error instanceof Error ? error.message : String(error) }));
      return () => {
        active = false;
      };
    }, [selected]);
    if (route === "evaluations") return h(Empty, null, "Evaluations are not available in the current Bees profile.");
    if (route === "audit") return h("div", null, ...events.length ? events.map((event) => {
      const run2 = runs.find(({ id }) => id === event.executionId);
      const relatedIds = [event.metadata?.itemId, event.metadata?.parentId, event.metadata?.resultId].filter(Boolean);
      const item = data.items.find(({ id, processId }) => relatedIds.includes(id) && workspaceIds.includes(data.processes.find((process2) => process2.id === processId)?.workspaceId));
      const process = data.processes.find(({ id, workspaceId }) => workspaceIds.includes(workspaceId) && [event.metadata?.processId, event.metadata?.resultId].includes(id));
      const runItem = run2 ? data.items.find(({ id }) => id === run2.workItemId) : null;
      const detail = runItem?.title ?? item?.title ?? process?.name ?? event.metadata?.action ?? event.metadata?.outcome;
      const onOpen = run2 ? () => {
        setSelected(run2.id);
        setRoute("runs");
      } : item ? () => openWorkItem(item.id) : process ? () => openProcess(process.id) : null;
      return h(AuditEvent, {
        event,
        detail,
        onOpen,
        key: event.id,
        openLabel: run2 ? "Open run" : item ? "Open work item" : "Open process"
      });
    }) : [h(Empty, { key: "empty" }, "No audit events yet")]);
    const run = runs.find(({ id }) => id === selected);
    if (run) return h(
      "div",
      null,
      h("div", { className: "bees-row" }, h(Button, { onClick: () => setSelected("") }, "← Runs"), h("strong", null, data.items.find(({ id }) => id === run.workItemId)?.title ?? "Ask Bees"), h("div", { className: "bees-grow" }), h("span", { className: `bees-status bees-${run.status}` }, run.status)),
      run.resolvedAgentId ? h(
        "section",
        { className: "bees-box" },
        h("h3", null, "Agent dispatch"),
        h("p", null, data.assignments.find(({ id }) => id === run.resolvedAgentId)?.name ?? "Unavailable agent"),
        h("p", { className: "bees-muted" }, run.dispatchReason)
      ) : null,
      run.outputs.length ? h("section", { className: "bees-box" }, h("h3", null, "Outputs"), h("p", null, run.outputs.join(", "))) : null,
      history?.error ? h(Empty, null, history.error) : history ? h(
        "div",
        { className: "bees-transcript" },
        ...history.messages?.length ? history.messages.map((message) => h(
          "div",
          { className: "bees-message", key: message.id },
          h("strong", null, message.role),
          message.parts.map((part, index) => h("div", { key: index }, part.type === "tool" ? `${part.toolName}: ${part.state}` : part.text ?? ""))
        )) : [h(Empty, { key: "empty" }, "No transcript messages yet")]
      ) : h(Empty, null, "Loading transcript…")
    );
    return h("div", null, ...runs.length ? runs.map((row) => h(
      "button",
      { className: "bees-row bees-nav-link", key: row.id, onClick: () => setSelected(row.id) },
      h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, data.items.find(({ id }) => id === row.workItemId)?.title ?? "Ask Bees"), h("div", { className: "bees-muted" }, [data.assignments.find(({ id }) => id === row.resolvedAgentId)?.name, new Date(row.updatedAt).toLocaleString()].filter(Boolean).join(" · "))),
      h("span", { className: `bees-status bees-${row.status}` }, row.status)
    )) : [h(Empty, { key: "empty" }, "No runs yet")]);
  }
  function KnowledgePage({ data, route, workspaceId, teamId }) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);
    if (route === "sources") {
      const locations = data.locations.filter((row) => row.teamId === teamId && !row.archivedAt);
      return locations.length ? locations.map((row) => h("div", { className: "bees-row", key: row.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, row.name), h("div", { className: "bees-muted" }, row.mapped ? "Available for bounded on-demand indexing" : "Map on this device to search")))) : h(Empty, null, "No approved sources in this team");
    }
    if (route === "artifacts") {
      const rows = data.runs.filter((run) => run.workspaceId === workspaceId && run.outputs.length);
      return rows.length ? rows.map((run) => h("div", { className: "bees-row", key: run.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, data.items.find(({ id }) => id === run.workItemId)?.title ?? "Run"), h("div", { className: "bees-muted" }, run.outputs.join(", "))))) : h(Empty, null, "No run artifacts yet");
    }
    return h(
      "div",
      null,
      h(
        "form",
        { className: "bees-search", onSubmit: async (event) => {
          event.preventDefault();
          setResults((await request2(`/bees-api/search?q=${encodeURIComponent(query)}&workspaceId=${encodeURIComponent(workspaceId)}`)).results);
        } },
        h("input", { className: "bees-input", value: query, onChange: (event) => setQuery(event.target.value), disabled: !workspaceId, placeholder: "Search work and approved files", "aria-label": "Search" }),
        h("button", { className: "bees-btn primary", disabled: !workspaceId }, "Search")
      ),
      ...results.map((result) => h("div", { className: "bees-row", key: result.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, result.title), h("div", { className: "bees-muted" }, result.excerpt)))),
      h("p", { className: "bees-muted" }, "Run transcripts are available from Activity → Runs.")
    );
  }

  // dsh-runtime/plugin/client/settings.js
  function AiSettings({ ctx, modelSettings, preferences, systemDefault, reload }) {
    return h(
      "div",
      { className: "bees-stack" },
      h(SystemDefaultSettings, { ctx, systemDefault, reload }),
      h(SubscriptionSettings, { modelSettings, preferences, systemDefault, ask, openExternal, Button }),
      h(FreeAiSettings, { ctx, modelSettings, preferences, systemDefault, ask, confirmAction: confirmAction2, openExternal, Button }),
      h(LocalAiSettings, { modelSettings, preferences, systemDefault, ask, confirmAction: confirmAction2, Button }),
      h(ExternalLocalAiSettings, { modelSettings, preferences, systemDefault, ask, Button }),
      h(CustomAiSettings, { ctx, modelSettings, preferences, systemDefault, ask, confirmAction: confirmAction2, openExternal, Button })
    );
  }
  function AppearanceSettings({ ctx }) {
    const theme = ctx.get("theme");
    const [snapshot, setSnapshot] = useState(() => theme.getTheme());
    useEffect(() => ctx.on("theme/change", setSnapshot), [ctx]);
    return h(
      "section",
      { className: "bees-box" },
      h("h3", null, "Appearance"),
      h("p", { className: "bees-muted" }, "This preference applies across organizations and workspaces on this device."),
      h("div", { className: "bees-segmented" }, ...["system", "light", "dark"].map((id) => h(Button, {
        key: id,
        className: snapshot.preference === id ? "active" : "",
        "aria-pressed": snapshot.preference === id,
        onClick: () => {
          theme.setTheme(id);
          setSnapshot(theme.getTheme());
        }
      }, id[0].toUpperCase() + id.slice(1))))
    );
  }
  function OrganizationsSettings({ reload }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState("");
    const [mode, setMode] = useState("sign_in");
    const [busy, setBusy] = useState(false);
    const refresh = async () => {
      try {
        setData(await collaboration());
        setError("");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    useEffect(() => {
      void refresh();
    }, []);
    const auth = async (event) => {
      event.preventDefault();
      setBusy(true);
      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      try {
        setData(await collaboration(mode, {
          name: String(form.get("name") ?? ""),
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? "")
        }));
        setError("");
        await reload();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusy(false);
      }
    };
    if (!data) return h(Empty, null, error || "Loading account…");
    if (!data.account) return h(
      "div",
      { className: "bees-stack" },
      h(
        "section",
        { className: "bees-box" },
        h("h3", null, mode === "sign_in" ? "Sign in" : "Create account"),
        h("p", { className: "bees-muted" }, "Sign in to see organization invitations and manage connected organizations."),
        h(
          "div",
          { className: "bees-segmented" },
          h(Button, { className: mode === "sign_in" ? "active" : "", onClick: () => setMode("sign_in") }, "Sign in"),
          h(Button, { className: mode === "sign_up" ? "active" : "", onClick: () => setMode("sign_up") }, "Create account")
        ),
        h(
          "form",
          { className: "bees-form", onSubmit: auth },
          mode === "sign_up" ? h("label", null, "Name", h("input", { className: "bees-input", name: "name", required: true })) : null,
          h("label", null, "Email", h("input", { className: "bees-input", name: "email", type: "email", required: true })),
          h("label", null, "Password", h("input", { className: "bees-input", name: "password", type: "password", minLength: 8, required: true })),
          h(Button, { type: "submit", className: "primary", disabled: busy }, busy ? "Connecting…" : mode === "sign_in" ? "Sign in" : "Create account")
        )
      ),
      error ? h("div", { className: "bees-error", role: "alert" }, error) : null
    );
    const run = async (action, values = {}) => {
      setBusy(true);
      try {
        setData(await collaboration(action, values));
        setError("");
        await reload();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusy(false);
      }
    };
    return h(
      "div",
      { className: "bees-stack" },
      h(
        "section",
        { className: "bees-box" },
        h("h3", null, data.account.name || data.account.email),
        h("p", { className: "bees-muted" }, data.account.email),
        h(
          "div",
          { className: "bees-form-row" },
          h(Button, { disabled: busy, onClick: () => run("sync") }, "Refresh"),
          h(Button, { className: "danger", disabled: busy, onClick: () => run("sign_out") }, "Sign out")
        )
      ),
      h(
        "section",
        { className: "bees-box" },
        h("h3", null, "Organizations"),
        ...data.organizations.length ? data.organizations.map((organization) => h(
          "div",
          { className: "bees-row", key: organization.id },
          h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, organization.name), h("div", { className: "bees-muted" }, organization.role))
        )) : [h(Empty, { key: "empty" }, "No connected organizations yet")]
      ),
      h(
        "section",
        { className: "bees-box" },
        h("h3", null, "Pending invitations"),
        ...data.invitations.length ? data.invitations.map((invitation) => h(
          "div",
          { className: "bees-row", key: invitation.id },
          h(
            "div",
            { className: "bees-row-main" },
            h("div", { className: "bees-row-title" }, invitation.organizationName),
            h("div", { className: "bees-muted" }, `${invitation.role} · expires ${new Date(invitation.expiresAt).toLocaleDateString()}`)
          ),
          h(Button, { className: "primary", disabled: busy, onClick: () => run("accept_invitation", { invitationId: invitation.id }) }, "Accept")
        )) : [h(Empty, { key: "empty" }, "No pending organization invitations")]
      ),
      error ? h("div", { className: "bees-error", role: "alert" }, error) : null
    );
  }
  function OrganizationSettings({ organization }) {
    const [people, setPeople] = useState(null);
    const [error, setError] = useState("");
    const load = async () => {
      if (!organization?.connected || !["owner", "admin"].includes(organization.role)) return;
      try {
        setPeople(await collaboration("organization_people", { organizationId: organization.id }));
        setError("");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    useEffect(() => {
      setPeople(null);
      setError("");
      void load();
    }, [organization?.id]);
    if (!organization) return h(Empty, null, "Choose an organization");
    if (!organization.connected) return h(
      "section",
      { className: "bees-box" },
      h("h3", null, organization.name),
      h("p", { className: "bees-muted" }, "This organization is local to this device. Connect an account to invite members.")
    );
    if (!["owner", "admin"].includes(organization.role)) return h(
      "section",
      { className: "bees-box" },
      h("h3", null, organization.name),
      h("p", { className: "bees-muted" }, `Your role is ${organization.role}. Only organization administrators can invite members.`)
    );
    const invite = async (event) => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      try {
        setPeople(await collaboration("invite_organization_member", {
          organizationId: organization.id,
          email: String(form.get("email") ?? ""),
          role: String(form.get("role") ?? "member")
        }));
        setError("");
        formElement.reset();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    if (!people) return h(Empty, null, error || "Loading organization members…");
    return h(
      "div",
      { className: "bees-stack" },
      h(
        "section",
        { className: "bees-box" },
        h("h3", null, `${organization.name} members`),
        ...people.memberships.map((member) => h(
          "div",
          { className: "bees-row", key: member.id },
          h(
            "div",
            { className: "bees-row-main" },
            h("div", { className: "bees-row-title" }, member.email || member.userId),
            h("div", { className: "bees-muted" }, member.status)
          ),
          h("span", { className: "bees-badge" }, member.role)
        ))
      ),
      h(
        "section",
        { className: "bees-box" },
        h("h3", null, "Invite organization member"),
        h(
          "form",
          { className: "bees-form-row", onSubmit: invite },
          h("label", null, "Email", h("input", { className: "bees-input", name: "email", type: "email", required: true })),
          h("label", null, "Role", h("select", { className: "bees-select", name: "role" }, h("option", { value: "member" }, "Member"), h("option", { value: "admin" }, "Admin"))),
          h("button", { className: "bees-btn primary" }, "Send invitation")
        ),
        ...people.invitations.map((invitation) => h(
          "div",
          { className: "bees-row", key: invitation.id },
          h(
            "div",
            { className: "bees-row-main" },
            h("div", { className: "bees-row-title" }, invitation.email),
            h("div", { className: "bees-muted" }, `Pending · expires ${new Date(invitation.expiresAt).toLocaleDateString()}`)
          ),
          h("span", { className: "bees-badge" }, invitation.role)
        ))
      ),
      error ? h("div", { className: "bees-error", role: "alert" }, error) : null
    );
  }
  function TeamSettings({ team, organization }) {
    const [people, setPeople] = useState(null);
    const [error, setError] = useState("");
    const load = async () => {
      if (!team || !organization?.connected || team.role !== "admin") return;
      try {
        setPeople(await collaboration("team_people", { teamId: team.id }));
        setError("");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    useEffect(() => {
      setPeople(null);
      setError("");
      void load();
    }, [team?.id]);
    if (!team) return h(Empty, null, "Choose a team");
    if (!organization?.connected) return h(
      "section",
      { className: "bees-box" },
      h("h3", null, team.name),
      h("p", { className: "bees-muted" }, "This team is local to this device.")
    );
    if (team.role !== "admin") return h(
      "section",
      { className: "bees-box" },
      h("h3", null, team.name),
      h("p", { className: "bees-muted" }, "Only team administrators can add organization members to this team.")
    );
    if (!people) return h(Empty, null, error || "Loading team members…");
    const add = async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        setPeople(await collaboration("add_team_member", {
          teamId: team.id,
          userId: String(form.get("userId") ?? ""),
          role: String(form.get("role") ?? "member")
        }));
        setError("");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    return h(
      "div",
      { className: "bees-stack" },
      h(
        "section",
        { className: "bees-box" },
        h("h3", null, `${team.name} members`),
        ...people.members.map((member) => h(
          "div",
          { className: "bees-row", key: member.id },
          h(
            "div",
            { className: "bees-row-main" },
            h("div", { className: "bees-row-title" }, member.email || member.userId),
            h("div", { className: "bees-muted" }, "Active organization member")
          ),
          h("span", { className: "bees-badge" }, member.role)
        ))
      ),
      h(
        "section",
        { className: "bees-box" },
        h("h3", null, "Add organization member"),
        h("p", { className: "bees-muted" }, "Team membership starts immediately; there is no invitation to accept."),
        people.candidates.length ? h(
          "form",
          { className: "bees-form-row", onSubmit: add },
          h("label", null, "Organization member", h(
            "select",
            { className: "bees-select", name: "userId" },
            ...people.candidates.map((candidate) => h("option", { value: candidate.userId, key: candidate.userId }, candidate.email || candidate.userId))
          )),
          h("label", null, "Role", h("select", { className: "bees-select", name: "role" }, h("option", { value: "member" }, "Member"), h("option", { value: "admin" }, "Admin"))),
          h("button", { className: "bees-btn primary" }, "Add member")
        ) : h(Empty, null, "Every active organization member is already on this team")
      ),
      error ? h("div", { className: "bees-error", role: "alert" }, error) : null
    );
  }
  function SettingsPage({ ctx, data, route, workspaceId, teamId, organizationId, modelSettings, preferences, reload }) {
    const workspace = data.workspaces.find(({ id }) => id === workspaceId);
    const team = data.teams.find(({ id }) => id === teamId);
    const organization = data.organizations.find(({ id }) => id === organizationId);
    if (route === "personal-ai") return h(AiSettings, { ctx, modelSettings, preferences, systemDefault: data.systemDefaultModel, reload });
    if (route === "appearance") return h(AppearanceSettings, { ctx });
    if (route === "organizations") return h(OrganizationsSettings, { reload });
    if (route === "connections") return h(Empty, null, "No external tool connections are configured in this Bees profile.");
    if (route === "workspace-settings") return workspace ? h("div", { className: "bees-grid" }, h("section", { className: "bees-box" }, h("h3", null, workspace.name), h("p", { className: "bees-muted" }, `${workspace.authority === "local" ? "Private on this device" : "Connected"} · ${workspace.hosting}`), h("p", { className: "bees-muted" }, workspace.dshWorkspaceId ? "Runtime ready" : "Runtime initializing"))) : h(Empty, null, "Choose a workspace to view workspace settings");
    if (route === "team-settings") return h(TeamSettings, { team, organization });
    if (route === "organization-settings") return h(OrganizationSettings, { organization });
    return h("div", { className: "bees-grid" }, h("section", { className: "bees-box" }, h("h3", null, "Organization role"), h("p", null, organization?.role ?? "None")), h("section", { className: "bees-box" }, h("h3", null, "Team role"), h("p", null, team?.role ?? "None")), h("section", { className: "bees-box" }, h("h3", null, "Runtime enforcement"), h("p", { className: "bees-muted" }, "Membership and role checks protect domain commands. Bees approval protects publication and protected tools.")));
  }

  // dsh-runtime/plugin/client/shell.js
  function ContextSwitcher({ data, organizationId, teamId, workspaceId, onChange, onCreateOrganization, onCreateTeam, onCreateWorkspace }) {
    const [query, setQuery] = useState("");
    const root = useRef(null);
    useEffect(() => {
      const dismiss = (event) => {
        if (!root.current?.contains(event.target)) root.current?.removeAttribute("open");
      };
      document.addEventListener("pointerdown", dismiss, true);
      return () => document.removeEventListener("pointerdown", dismiss, true);
    }, []);
    const organization = data.organizations.find(({ id }) => id === organizationId);
    const team = data.teams.find(({ id }) => id === teamId);
    const workspace = data.workspaces.find(({ id }) => id === workspaceId);
    const needle = query.trim().toLocaleLowerCase();
    const matches = ({ name }) => !needle || name.toLocaleLowerCase().includes(needle);
    const close = (event) => event.currentTarget.closest("details")?.removeAttribute("open");
    const option = (row, active, select, closeAfter = false) => h("button", {
      className: `bees-context-option ${active ? "active" : ""}`,
      key: row.id,
      onClick: (event) => {
        select();
        if (closeAfter) close(event);
      }
    }, h("span", { className: "bees-context-check", "aria-hidden": "true" }, active ? "✓" : ""), row.name);
    const add = (label, action, disabled = false) => h("button", {
      className: "bees-context-option bees-context-add",
      onClick: action,
      disabled
    }, h("span", { className: "bees-context-check", "aria-hidden": "true" }, "+"), label);
    const organizations = data.organizations.filter(matches);
    const teams = data.teams.filter((row) => row.organizationId === organizationId && matches(row));
    const workspaces = data.workspaces.filter((row) => row.teamId === teamId && matches(row));
    return h(
      "details",
      { className: "bees-context-switcher", ref: root },
      h(
        "summary",
        null,
        h(
          "div",
          { className: "bees-context-summary" },
          h("div", { className: "bees-context-primary" }, organization?.name ?? "Choose organization"),
          h("div", { className: "bees-context-secondary" }, team ? `${team.name} · ${workspace?.name ?? "All workspaces"}` : "Choose team")
        ),
        h("span", { className: "bees-context-arrow", "aria-hidden": "true" }, "▾")
      ),
      h(
        "div",
        { className: "bees-context-panel" },
        h("input", { className: "bees-input bees-context-search", value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Search contexts", "aria-label": "Search organizations, teams, and workspaces" }),
        h(
          "div",
          { className: "bees-context-section" },
          h("div", { className: "bees-context-label" }, "Organizations"),
          ...organizations.map((row) => option(row, row.id === organizationId, () => onChange(`organization:${row.id}`))),
          add("New organization", onCreateOrganization)
        ),
        h(
          "div",
          { className: "bees-context-section" },
          h("div", { className: "bees-context-label" }, organization ? `Teams in ${organization.name}` : "Teams"),
          ...teams.map((row) => option(row, row.id === teamId, () => onChange(`team:${row.id}`))),
          add("New team", onCreateTeam, !organizationId)
        ),
        h(
          "div",
          { className: "bees-context-section" },
          h("div", { className: "bees-context-label" }, team ? `Workspaces in ${team.name}` : "Workspaces"),
          team && (!needle || "all workspaces".includes(needle)) ? option({ id: `all:${team.id}`, name: "All workspaces" }, !workspaceId, () => onChange(`team:${team.id}`), true) : null,
          ...workspaces.map((row) => option(row, row.id === workspaceId, () => onChange(`workspace:${row.id}`), true)),
          add("New workspace", onCreateWorkspace, !teamId)
        )
      )
    );
  }
  function BeesApp({ ctx, preferences, modelSettings }) {
    const preference = usePreference(preferences);
    const [data, setData] = useState(null);
    const [error, setError] = useState("");
    const [route, setRoute] = useState("home");
    const [scope, setScopeState] = useState("");
    const [processId, setProcessId] = useState("");
    const [workItemId, setWorkItemId] = useState("");
    const [creating, setCreating] = useState("");
    const [processDraft, setProcessDraft] = useState(null);
    const [workProcessId, setWorkProcessId] = useState("");
    const load = async () => {
      try {
        const value = await request2("/bees-api/snapshot");
        setData(value);
        setError("");
        return value;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        return null;
      }
    };
    useEffect(() => {
      void load();
      const timer = setInterval(() => void load(), 5e3);
      return () => clearInterval(timer);
    }, []);
    useEffect(() => {
      if (!data) return;
      const valid = /* @__PURE__ */ new Set([...data.organizations.map(({ id }) => `organization:${id}`), ...data.teams.map(({ id }) => `team:${id}`), ...data.workspaces.map(({ id }) => `workspace:${id}`)]);
      const preferred = valid.has(preference.lastScope) ? preference.lastScope : data.workspaces[0] ? `workspace:${data.workspaces[0].id}` : `organization:${data.organizations[0]?.id ?? ""}`;
      setScopeState((current) => valid.has(current) ? current : preferred);
    }, [data, preference.lastScope]);
    const setScope = (next) => {
      setScopeState(next);
      setProcessId("");
      setWorkItemId("");
      setCreating("");
      setProcessDraft(null);
      setWorkProcessId("");
      void preferences.set("lastScope", next);
    };
    const parts = data ? scopeParts(data, scope) : { workspaceId: "", teamId: "", organizationId: "" };
    const workspaceIds = data ? parts.workspaceId ? [parts.workspaceId] : data.workspaces.filter(({ teamId }) => teamId === parts.teamId).map(({ id }) => id) : [];
    const act = async (command) => {
      try {
        const result = await request2("/bees-api/command", { method: "POST", body: JSON.stringify(command) });
        await load();
        return result;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        return null;
      }
    };
    const askBees = async (outcome) => {
      if (!parts.workspaceId) return null;
      const result = await act({ action: "ask_bees", workspaceId: parts.workspaceId, outcome });
      if (result?.sessionId) setRoute("runs");
      return result;
    };
    const navigate = (id) => {
      if (id === "dsh-settings") {
        document.querySelector('button[aria-haspopup="dialog"][aria-expanded]')?.click();
        return;
      }
      const section2 = NAVIGATION.find((row) => row.id === id);
      setRoute(section2 ? section2.defaultChild : id);
      setProcessId("");
      setWorkItemId("");
      setCreating("");
      setProcessDraft(null);
      setWorkProcessId("");
    };
    const createOrganization = async () => {
      const name = await ask("Organization name", "");
      if (!name) return;
      const result = await act({ action: "create_organization", name });
      if (result?.id) setScope(`organization:${result.id}`);
    };
    const createTeam = async () => {
      const organization = data.organizations.find(({ id }) => id === parts.organizationId);
      if (!organization) return;
      const name = await ask("Team name", "");
      if (!name) return;
      const result = await act({ action: "create_team", organizationId: organization.id, name });
      if (result?.id) setScope(`team:${result.id}`);
    };
    const createWorkspace = async () => {
      let team = data.teams.find(({ id }) => id === parts.teamId);
      const teams = data.teams.filter(({ organizationId }) => organizationId === parts.organizationId);
      if (!team) {
        const name2 = await ask(`Team:
${teams.map(({ name: name3 }) => name3).join("\n")}`);
        team = teams.find((row) => row.name === name2);
      }
      if (!team) return;
      const name = await ask("Workspace name", "");
      if (!name) return;
      const result = await act({ action: "create_workspace", teamId: team.id, name });
      if (result?.id) setScope(`workspace:${result.id}`);
    };
    const createWork = () => {
      setRoute("all-work");
      setWorkItemId("");
      setWorkProcessId("");
      setCreating("work");
    };
    const createGoal = () => {
      setRoute("goals");
      setWorkItemId("");
      setCreating("goal");
    };
    const createProcess = () => {
      setRoute("all-processes");
      setProcessId("");
      setProcessDraft(null);
      setCreating("process");
    };
    const createRun = async () => {
      const processes = data.processes.filter((row) => row.workspaceId === parts.workspaceId && row.kind === "standard");
      const processName = await ask(`Process:
${processes.map(({ name }) => name).join("\n")}`, processes[0]?.name ?? "");
      const process = processes.find(({ name }) => name === processName);
      if (!process) return;
      const title = await ask("One-off run name", `New ${process.name} run`);
      if (!title) return;
      const work = await act({ action: "create_run", processId: process.id, title });
      if (work?.id) {
        setRoute("all-work");
        setWorkItemId(work.id);
      }
    };
    const createAgent = () => {
      setRoute("all-agents");
      setCreating("agent");
    };
    const localAi = h(LocalAiController, { modelSettings, preferences, onError: setError });
    const freeAi = h(FreeAiController, { modelSettings, onError: setError });
    if (!data) return h(
      React.Fragment,
      null,
      localAi,
      freeAi,
      h("div", { className: "bees-app bees-loading" }, error || "Opening Bees…")
    );
    const section = sectionFor(route);
    const routeLabel = section.children.find(([id]) => id === route)?.[1] ?? section.label;
    const pins = (preference.pins ?? []).filter((id) => navigationItem(id));
    const setPins = (next) => preferences.set("pins", next);
    const openProcess = (id) => {
      setRoute("all-processes");
      setProcessId(id);
      setWorkItemId("");
      setCreating("");
    };
    const openWorkItem = (id, processForWork = "") => {
      setRoute("all-work");
      setProcessId("");
      setWorkItemId(id ?? "");
      setWorkProcessId(processForWork);
      setCreating(id ? "" : "work");
    };
    const pinnedRows = (targetRoute) => {
      const target = sectionFor(targetRoute);
      const openRoute = () => navigate(targetRoute);
      if (target.id === "work") return workItemsFor(data, targetRoute, workspaceIds).map((item) => ({ id: item.id, label: item.title, open: () => openWorkItem(item.id) }));
      if (target.id === "processes") {
        if (targetRoute === "schedules") return data.schedules.filter((row) => workspaceIds.includes(row.workspaceId)).map((row) => ({ id: row.id, label: row.name, open: openRoute }));
        if (targetRoute === "templates") return (data.templates ?? []).filter((row) => workspaceIds.includes(row.workspaceId)).map((row) => ({ id: row.id, label: row.name, open: openRoute }));
        return data.processes.filter((row) => workspaceIds.includes(row.workspaceId)).map((row) => ({ id: row.id, label: row.name, open: () => {
          setRoute("all-processes");
          setProcessId(row.id);
        } }));
      }
      if (target.id === "agents") {
        const assignments = data.assignments.filter((row) => workspaceIds.includes(row.workspaceId));
        if (targetRoute === "skills") return [];
        if (targetRoute === "pools") return data.pools.filter((row) => workspaceIds.includes(row.workspaceId)).map((row) => ({ id: row.id, label: row.name, open: openRoute }));
        return assignments.map((row) => ({ id: row.id, label: row.name, open: openRoute }));
      }
      if (target.id === "files" || targetRoute === "sources") return data.locations.filter((row) => row.teamId === parts.teamId && !row.archivedAt).map((row) => ({ id: row.id, label: row.name, open: openRoute }));
      if (targetRoute === "runs") return data.runs.filter((row) => workspaceIds.includes(row.workspaceId)).map((row) => ({
        id: row.id,
        label: data.items.find(({ id }) => id === row.workItemId)?.title ?? "Ask Bees",
        open: openRoute
      }));
      if (targetRoute === "artifacts") return data.runs.filter((row) => row.workspaceId === parts.workspaceId && row.outputs.length).map((row) => ({ id: row.id, label: data.items.find(({ id }) => id === row.workItemId)?.title ?? "Run", open: openRoute }));
      if (targetRoute === "workspace-settings" && parts.workspace) return [{ id: parts.workspace.id, label: parts.workspace.name, open: openRoute }];
      if (targetRoute === "team-settings") {
        const team = data.teams.find(({ id }) => id === parts.teamId);
        return team ? [{ id: team.id, label: team.name, open: openRoute }] : [];
      }
      if (targetRoute === "organization-settings") {
        const organization = data.organizations.find(({ id }) => id === parts.organizationId);
        return organization ? [{ id: organization.id, label: organization.name, open: openRoute }] : [];
      }
      return [];
    };
    const page = route === "home" ? h(Home, { data, workspaceId: parts.workspaceId, act, openWorkItem }) : route === "guide" ? h(GuidePage) : section.id === "work" ? route === "waiting" ? h(NeedsYouPage, { ctx, data, workspaceIds, openWorkItem }) : h(WorkPage, { ctx, data, route, workspaceIds, workspaceId: parts.workspaceId, teamId: parts.teamId, workItemId, setWorkItemId, creating, setCreating, defaultProcessId: workProcessId, act }) : section.id === "processes" ? h(ProcessesPage, { data, route, workspaceIds, workspaceId: parts.workspaceId, teamId: parts.teamId, processId, setProcessId, openWorkItem, creating, setCreating, processDraft, setProcessDraft, act }) : section.id === "agents" ? h(AgentsPage, { ctx, data, route, workspaceIds, workspaceId: parts.workspaceId, creating, setCreating, act, openDshSettings: () => navigate("dsh-settings") }) : section.id === "files" ? h(FilesPage, { ctx, data, route, teamId: parts.teamId, act }) : section.id === "activity" ? h(ActivityPage, { data, route, workspaceIds, setRoute, openWorkItem, openProcess }) : section.id === "knowledge" ? h(KnowledgePage, { data, route, workspaceId: parts.workspaceId, teamId: parts.teamId }) : h(SettingsPage, { ctx, data, route, workspaceId: parts.workspaceId, teamId: parts.teamId, organizationId: parts.organizationId, modelSettings, preferences, reload: load });
    return h(React.Fragment, null, localAi, freeAi, h(
      "div",
      { className: "bees-app" },
      h(
        "aside",
        { className: "bees-sidebar" },
        h("div", { className: "bees-brand" }, h("span", { className: "bees-mark" }, "B"), h("span", null, "Bees")),
        h(ContextSwitcher, {
          data,
          organizationId: parts.organizationId,
          teamId: parts.teamId,
          workspaceId: parts.workspaceId,
          onChange: setScope,
          onCreateOrganization: createOrganization,
          onCreateTeam: createTeam,
          onCreateWorkspace: createWorkspace
        }),
        h(
          "nav",
          { className: "bees-nav", "aria-label": "Bees navigation" },
          ...pins.map((id) => {
            const pinned = navigationItem(id);
            return h(
              "div",
              { className: "bees-nav-group", key: `pin:${id}` },
              h(
                "div",
                { className: `bees-nav-group-head ${route === pinned.route ? "active" : ""}` },
                h("button", { className: `bees-nav-link ${route === pinned.route ? "active" : ""}`, onClick: () => navigate(pinned.route) }, h("span", { style: { display: "flex", width: 18, color: "var(--dsw-alias-label-secondary)" } }, h(pinned.icon)), h("span", null, pinned.label)),
                h(PinButton, { id: pinned.id, label: pinned.label, pins, setPins })
              ),
              ...pinnedRows(pinned.route).map((row) => h("button", { className: "bees-nav-link bees-nav-record", title: row.label, key: `${pinned.id}:${row.id}`, onClick: row.open }, row.label))
            );
          }),
          h("div", { className: "bees-nav-standard" }, ...NAVIGATION.map((item, idx) => h(
            React.Fragment,
            { key: item.id },
            idx === 4 ? h("div", { className: "bees-nav-separator" }) : null,
            h(
              "div",
              { className: `bees-nav-menu ${section.id === item.id ? "active" : ""}` },
              h("button", { className: `bees-nav-link ${section.id === item.id ? "active" : ""}`, onClick: () => navigate(item.id) }, h("span", { style: { display: "flex", width: 18, color: "var(--dsw-alias-label-secondary)" } }, h(item.icon)), h("span", null, item.label)),
              h(PinButton, { id: item.id, label: item.label, pins, setPins }),
              item.children.length > 0 ? h(
                "div",
                { className: "bees-nav-flyout" },
                ...item.children.map(
                  ([child, label]) => h(
                    "div",
                    { className: `bees-nav-flyout-item ${route === child ? "active" : ""}`, key: `${item.id}:${child}` },
                    h("button", { className: `bees-nav-link bees-nav-child ${route === child ? "active" : ""}`, onClick: () => navigate(child) }, label),
                    h(PinButton, { id: child, label, pins, setPins })
                  )
                )
              ) : null
            )
          )))
        ),
        h(
          "div",
          { className: "bees-sidebar-foot" },
          h("button", { className: `bees-nav-link ${route === "guide" ? "active" : ""}`, onClick: () => navigate("guide") }, h("span", { style: { display: "flex", width: 18, color: "var(--dsw-alias-label-secondary)" } }, h(BookIcon)), h("span", null, "How Bees works"))
        )
      ),
      h(
        "section",
        { className: "bees-main" },
        h(
          "header",
          { className: "bees-top" },
          h("div", { className: "bees-title" }, routeLabel),
          route !== "home" ? h("div", { className: "bees-context" }, parts.workspace?.name ?? parts.team?.name ?? parts.organization?.name ?? "") : null,
          route !== "home" ? h(PinButton, { id: route, label: routeLabel, pins, setPins }) : null,
          h("div", { className: "bees-grow" }),
          h(ThemeToggle, { ctx })
        ),
        error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
        h("main", { className: "bees-content" }, h("div", { className: `bees-panel ${section.id === "work" && workItemId ? "bees-panel-wide" : ""}` }, page))
      )
    ));
  }

  // dsh-runtime/plugin/client/index.js
  window.__ModuleLoader__.load({
    id: "@bees/dsh-plugin",
    factory: (require2) => {
      configureRuntime(require2);
      const module = { exports: {} };
      const exports = module.exports;
      exports.inject = ["slots", "workspaces", "settingsScope", "connection", "theme", "sessions"];
      exports.apply = (ctx) => {
        const style = document.createElement("style");
        style.dataset.plugin = "@bees/dsh-plugin";
        style.textContent = css;
        document.head.append(style);
        ctx.effect(() => () => style.remove(), "bees: styles");
        const preferences = ctx.settingsScope.bind({ namespace: "bees-ui" });
        const modelSettings = ctx.settingsScope.bind({ namespace: "llm-pi-ai" });
        ctx.slots.inject("shell.overlay", () => ctx.slots.register({
          name: "shell.overlay",
          id: "bees-product",
          order: -100,
          label: "Bees",
          inject: () => ({ ctx, preferences, modelSettings })
        }, BeesApp));
      };
      return module.exports;
    }
  });
})();
