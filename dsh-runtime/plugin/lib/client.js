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

  // dsh-runtime/node_modules/gridstack/dist/gridstack.min.css
  var gridstack_min_default = `.grid-stack{position:relative}.grid-stack-placeholder>.placeholder-content{background-color:rgba(0,0,0,.1);margin:0;position:absolute;width:auto;z-index:0!important}.grid-stack>.grid-stack-item{position:absolute;padding:0;top:0;width:var(--gs-column-width);height:var(--gs-cell-height)}.grid-stack>.grid-stack-item>.grid-stack-item-content{margin:0;position:absolute;width:auto;overflow-x:hidden;overflow-y:auto}.grid-stack>.grid-stack-item.size-to-content:not(.size-to-content-max)>.grid-stack-item-content{overflow-y:hidden}.grid-stack:not(.grid-stack-rtl)>.grid-stack-item{left:0}.grid-stack.grid-stack-rtl>.grid-stack-item{right:0}.grid-stack>.grid-stack-item>.grid-stack-item-content,.grid-stack>.grid-stack-placeholder>.placeholder-content{top:var(--gs-item-margin-top);right:var(--gs-item-margin-right);bottom:var(--gs-item-margin-bottom);left:var(--gs-item-margin-left)}.grid-stack-item>.ui-resizable-handle{position:absolute;font-size:.1px;display:block;-ms-touch-action:none;touch-action:none;user-select:none;z-index:100}.grid-stack-item.ui-resizable-autohide>.ui-resizable-handle,.grid-stack-item.ui-resizable-disabled>.ui-resizable-handle{display:none}.grid-stack-item>.ui-resizable-ne,.grid-stack-item>.ui-resizable-nw,.grid-stack-item>.ui-resizable-se,.grid-stack-item>.ui-resizable-sw{background-image:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="%23666" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 20 20"><path d="m10 3 2 2H8l2-2v14l-2-2h4l-2 2"/></svg>');background-repeat:no-repeat;background-position:center;z-index:101}.grid-stack-item>.ui-resizable-ne{transform:rotate(45deg)}.grid-stack-item>.ui-resizable-sw{transform:rotate(45deg)}.grid-stack-item>.ui-resizable-nw{transform:rotate(-45deg)}.grid-stack-item>.ui-resizable-se{transform:rotate(-45deg)}.grid-stack-item>.ui-resizable-nw{cursor:nw-resize;width:20px;height:20px;top:var(--gs-item-margin-top);left:var(--gs-item-margin-left)}.grid-stack-item>.ui-resizable-n{cursor:n-resize;height:10px;top:var(--gs-item-margin-top);left:25px;right:25px}.grid-stack-item>.ui-resizable-ne{cursor:ne-resize;width:20px;height:20px;top:var(--gs-item-margin-top);right:var(--gs-item-margin-right)}.grid-stack-item>.ui-resizable-e{cursor:e-resize;width:10px;top:15px;bottom:15px;right:var(--gs-item-margin-right)}.grid-stack-item>.ui-resizable-se{cursor:se-resize;width:20px;height:20px;bottom:var(--gs-item-margin-bottom);right:var(--gs-item-margin-right)}.grid-stack-item>.ui-resizable-s{cursor:s-resize;height:10px;left:25px;bottom:var(--gs-item-margin-bottom);right:25px}.grid-stack-item>.ui-resizable-sw{cursor:sw-resize;width:20px;height:20px;bottom:var(--gs-item-margin-bottom);left:var(--gs-item-margin-left)}.grid-stack-item>.ui-resizable-w{cursor:w-resize;width:10px;top:15px;bottom:15px;left:var(--gs-item-margin-left)}.grid-stack-item.ui-draggable-dragging>.ui-resizable-handle{display:none!important}.grid-stack-item.ui-draggable-dragging{will-change:left,right,top}.grid-stack-item.ui-resizable-resizing{will-change:width,height}.ui-draggable-dragging,.ui-resizable-resizing{z-index:10000}.ui-draggable-dragging>.grid-stack-item-content,.ui-resizable-resizing>.grid-stack-item-content{box-shadow:1px 4px 6px rgba(0,0,0,.2);opacity:.8}.grid-stack-animate,.grid-stack-animate .grid-stack-item{transition:left .3s,right .3s,top .3s,height .3s,width .3s}.grid-stack-animate .grid-stack-item.grid-stack-placeholder,.grid-stack-animate .grid-stack-item.ui-draggable-dragging,.grid-stack-animate .grid-stack-item.ui-resizable-resizing{transition:left 0s,right 0s,top 0s,height 0s,width 0s}.grid-stack>.grid-stack-item[gs-y="0"]{top:0}.grid-stack:not(.grid-stack-rtl)>.grid-stack-item[gs-x="0"]{left:0}.grid-stack.grid-stack-rtl>.grid-stack-item[gs-x="0"]{right:0}.gs-print-show{display:none}@media print{@page gs-landscape{size:landscape}@page gs-portrait{size:portrait}.grid-stack{display:block!important;height:auto!important;position:static!important}.grid-stack>.grid-stack-item{display:block!important;float:left!important;position:static!important;height:auto!important;left:auto!important;top:auto!important;width:calc(100% * var(--gs-w)/ var(--gs-columns,12))!important;break-inside:avoid!important;page-break-inside:avoid!important}.grid-stack>.grid-stack-item>.grid-stack-item-content{position:relative!important;height:auto!important;overflow:visible!important;white-space:normal!important;margin-top:var(--gs-item-margin-top)!important;margin-right:var(--gs-item-margin-right)!important;margin-bottom:var(--gs-item-margin-bottom)!important;margin-left:var(--gs-item-margin-left)!important;top:auto!important;right:auto!important;bottom:auto!important;left:auto!important}.gs-print-hide{display:none}.gs-print-show{display:block}.grid-stack>.grid-stack-item.gs-print-hide{display:none!important}.grid-stack>.grid-stack-item[gs-page-break=true],.grid-stack>.grid-stack-item[gs-print-orientation]{float:none!important;clear:both!important}.grid-stack>.grid-stack-item[gs-page-break=true]{page-break-before:always!important;break-before:page!important}.grid-stack>.grid-stack-item[gs-print-orientation=landscape]{page:gs-landscape;min-width:calc(100vmax * var(--gs-w)/ var(--gs-columns,12))!important}.grid-stack>.grid-stack-item[gs-print-orientation=portrait]{page:gs-portrait;min-width:calc(100vmin * var(--gs-w)/ var(--gs-columns,12))!important}.grid-stack>.grid-stack-item>.ui-resizable-handle{display:none!important}}`;

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
    { id: "home", label: "Home", icon: HomeIcon, defaultChild: "home", children: [
      ["guide", "How Bees works"]
    ] },
    { id: "work", label: "Work", icon: WorkIcon, defaultChild: "all-work", children: [
      ["all-work", "Work items"],
      ["goals", "Goals"],
      ["waiting", "Needs you"],
      ["completed", "Completed"]
    ] },
    { id: "agents", label: "Agents", icon: AgentsIcon, defaultChild: "all-agents", children: [
      ["all-agents", "All agents"],
      ["pools", "Pools"],
      ["presets", "Agent presets"],
      ["skills", "Skills & tools"],
      ["mcp", "MCP servers"]
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
  .bees-dashboard{min-width:0}.bees-dashboard-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:12px}.bees-dashboard-select{min-width:180px;max-width:320px}.bees-dashboard-add{position:relative}.bees-dashboard-add>summary{list-style:none}.bees-dashboard-add>summary::-webkit-details-marker{display:none}.bees-dashboard-widget-menu{position:absolute;right:0;top:42px;z-index:120;width:290px;max-height:min(480px,70vh);overflow:auto;display:grid;gap:3px;padding:7px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-base);box-shadow:0 14px 35px #0004}.bees-dashboard-widget-menu button{display:grid;gap:2px;padding:9px;border:0;border-radius:8px;color:inherit;background:transparent;text-align:left;font:inherit;cursor:pointer}.bees-dashboard-widget-menu button:hover{background:var(--dsw-alias-interactive-bg-hover)}.bees-dashboard-widget-menu span{color:var(--dsw-alias-label-secondary);font-size:11px}
  .bees-dashboard-grid{margin:-6px}.bees-dashboard-widget{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-sidebar-fill);box-shadow:0 2px 8px #00000008}.bees-dashboard-grid.editing .bees-dashboard-widget{border-color:#f2b84b88}.bees-dashboard-widget-handle{display:flex;align-items:center;gap:8px;flex:none;min-height:40px;padding:9px 11px;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-dashboard-grid.editing .bees-dashboard-widget-handle{cursor:grab}.bees-dashboard-widget-handle strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-dashboard-remove{display:grid;place-items:center;width:24px;height:24px;margin-left:auto;border:0;border-radius:7px;color:var(--dsw-alias-label-secondary);background:transparent;font:20px/1 inherit;cursor:pointer}.bees-dashboard-remove:hover{color:#d15353;background:var(--dsw-alias-interactive-bg-hover)}.bees-dashboard-widget-body{min-height:0;flex:1;overflow:auto;padding:11px}.bees-dashboard-widget-body>.bees-empty{padding:20px}.bees-dashboard-composer{height:100%;padding:12px}.bees-dashboard-composer .bees-composer-input{min-height:60px;flex:1}.bees-dashboard-composer .bees-error{margin:0}.bees-dashboard-list{display:grid;gap:6px}.bees-dashboard-row{width:100%;padding:8px;border:0;border-radius:8px;color:inherit;background:var(--dsw-alias-bg-base);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;font:inherit;cursor:pointer}.bees-dashboard-row:hover{background:var(--dsw-alias-interactive-bg-hover)}.bees-dashboard-view-all{position:sticky;bottom:0;margin-top:3px}.bees-dashboard-metrics{height:100%;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.bees-dashboard-metric{display:grid;place-items:center;align-content:center;border-radius:10px;background:var(--dsw-alias-bg-base);text-align:center}.bees-dashboard-metric strong{font-size:25px}.bees-dashboard-metric span{color:var(--dsw-alias-label-secondary);font-size:11px}.bees-dashboard-proposal{padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}.bees-dashboard-proposal p{margin:4px 0}.bees-dashboard .bees-home-templates{gap:7px}.bees-dashboard .bees-template-card{padding:10px}
  .bees-composer { display: flex; flex-direction: column; gap: 12px; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px; padding: 16px; box-shadow: 0 4px 12px #0000000a; transition: border-color 0.2s, box-shadow 0.2s; }
  .bees-composer:focus-within { border-color: #f2b84b; box-shadow: 0 4px 20px #00000014; }
  .bees-composer-input { border: 0; background: transparent; font-size: 16px; min-height: 120px; outline: none; resize: vertical; font-family: inherit; color: inherit; line-height: 1.5; padding: 0; }
  .bees-composer-input::placeholder { color: var(--dsw-alias-label-secondary); }
  .bees-composer-foot { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  .bees-composer-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); }
  
  .bees-home-templates { display: grid; gap: 12px; }
  .bees-template-card { display: flex; flex-direction: column; gap: 6px; padding: 16px; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; cursor: pointer; text-align: left; transition: border-color 0.2s, box-shadow 0.2s; color: inherit; font: inherit; box-shadow: 0 2px 8px #00000006; }
  .bees-template-card:hover { border-color: #f2b84b; }
  .bees-template-card-title { font-weight: 600; font-size: 14px; }
  .bees-template-card-meta { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.4; }
  
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
  .bees-cockpit-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}.bees-cockpit-head h2{margin:0}.bees-cockpit-board{margin-bottom:16px}.bees-hierarchy-card{display:block;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:11px;color:inherit;background:var(--dsw-alias-bg-base);text-align:left;font:inherit;cursor:pointer}.bees-hierarchy-card:hover,.bees-hierarchy-card.active{border-color:#f2b84b;background:#f2b84b12}.bees-hierarchy-card h3{margin:0 0 4px}.bees-lineage{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-cockpit-detail{display:block}.bees-tabbar{display:flex;align-items:center;gap:8px;margin:-5px -5px 14px;padding:5px;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-tabs{display:flex;min-width:0;gap:4px;overflow-x:auto}.bees-tab-actions{display:flex;flex:none;gap:6px;margin-left:auto}.bees-tab-actions .bees-btn{padding:5px 8px;font-size:12px}.bees-tab{flex:none;padding:7px 10px;border:0;border-radius:8px;color:var(--dsw-alias-label-secondary);background:transparent;font:inherit;cursor:pointer}.bees-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}.bees-tab.active{color:var(--dsw-alias-label-primary);background:#f2b84b22;font-weight:750}.bees-tab:focus-visible{outline:2px solid #f2b84b;outline-offset:1px}.bees-tab-panel{min-height:220px}.bees-detail-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}.bees-run-list{display:grid;gap:6px}.bees-run-row{display:flex;align-items:center;gap:8px;width:100%;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;color:inherit;background:transparent;text-align:left;cursor:pointer}.bees-run-row.active{border-color:#f2b84b}.bees-audit{border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-audit>summary{cursor:pointer;list-style-position:inside}.bees-audit>summary:hover{background:var(--dsw-alias-interactive-bg-hover)}.bees-audit>summary span{display:block}.bees-audit-detail{padding:0 12px 12px 27px}.bees-audit-detail pre{margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.bees-agent-form textarea{min-height:180px}
  .bees-inbox{display:grid;grid-template-columns:minmax(230px,.72fr) minmax(360px,1.28fr);gap:12px;align-items:start}.bees-inbox-list{display:grid;gap:7px}.bees-inbox-row{display:grid;grid-template-columns:10px minmax(0,1fr) auto;align-items:center;gap:9px;width:100%;padding:11px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;color:inherit;background:var(--dsw-specific-sidebar-fill);text-align:left;font:inherit;cursor:pointer}.bees-inbox-row:hover,.bees-inbox-row.active{border-color:#f2b84b;background:#f2b84b12}.bees-inbox-dot{width:8px;height:8px;border-radius:50%;background:#f2b84b}.bees-inbox-copy{min-width:0}.bees-inbox-copy strong,.bees-inbox-copy span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-answer-card{display:grid;gap:14px;min-height:270px}.bees-answer-head{display:flex;align-items:flex-start;gap:10px}.bees-answer-head h2{margin:2px 0 0;font-size:20px}.bees-question-detail{padding:10px 12px;border-radius:9px;background:var(--dsw-alias-bg-base)}.bees-question-options{display:grid;gap:8px}.bees-choice{display:flex;align-items:flex-start;gap:9px;width:100%;padding:11px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;color:inherit;background:var(--dsw-alias-bg-base);text-align:left;font:inherit;cursor:pointer}.bees-choice:hover,.bees-choice.selected{border-color:#f2b84b;background:#f2b84b16}.bees-choice-mark{display:grid;place-items:center;flex:0 0 22px;height:22px;border-radius:7px;background:var(--dsw-alias-interactive-bg-hover);font-size:11px}.bees-choice.selected .bees-choice-mark{background:#f2b84b;color:#21190b}.bees-choice-copy{display:grid;gap:2px}.bees-answer-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.bees-file-list{display:flex;gap:6px;flex-wrap:wrap;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}.bees-file-chip{max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-file-chip.active{border-color:#f2b84b;background:#f2b84b16}.bees-file-preview{min-height:130px;max-height:460px;overflow:auto;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base)}.bees-file-preview-head{margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-file-preview pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}.bees-blocked{margin-top:18px}
  .bees-workspace-layout{display:grid;grid-template-columns:1fr 340px;gap:12px;align-items:start}.bees-convo-panel{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-sidebar-fill);height:600px;overflow:hidden}.bees-convo-history{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:16px;scroll-behavior:smooth}.bees-convo-composer{padding:12px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}.bees-convo-msg{padding:10px 14px;border-radius:12px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);max-width:85%}.bees-convo-msg.user{align-self:flex-end;background:#f2b84b22;border-color:#f2b84b}.bees-convo-msg.agent{align-self:flex-start}.bees-convo-msg.system{align-self:center;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary);background:transparent;border:none}.bees-details-panel{display:flex;flex-direction:column;gap:12px}
  @media(max-width:780px){.bees-app{grid-template-columns:76px 1fr}.bees-brand span:last-child,.bees-nav-link span:last-child,.bees-nav-child,.bees-nav-pin{display:none}.bees-brand{justify-content:center;padding-inline:8px}.bees-context-switcher{margin-inline:8px}.bees-context-switcher summary{justify-content:center;padding-inline:6px}.bees-context-summary{display:none}.bees-context-panel{position:fixed;top:54px;left:82px;width:260px}.bees-nav-link{justify-content:center}.bees-content{padding:12px}.bees-dashboard-toolbar{align-items:stretch;flex-wrap:wrap}.bees-dashboard-select{max-width:none;flex:1}.bees-dashboard-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.bees-hero{padding:20px}.bees-hero form,.bees-system-default form{grid-template-columns:1fr}.bees-cockpit-detail,.bees-inbox,.bees-workspace-layout{grid-template-columns:1fr}}
`;
  async function request(path, options) {
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
  var collaboration = (action, values = {}) => request("/bees-api/collaboration", action ? {
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
  var confirmAction = (label) => dialogValue(label, "", true);
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
  function runTitle(data, run) {
    return data.items.find(({ id }) => id === run.workItemId)?.title ?? (run.mode === "planning" && run.purpose ? `Plan outcome: ${run.purpose}` : "Agent run");
  }
  function workItemsFor(data, route, workspaceIds) {
    let rows = data.items.filter((item) => workspaceIds.includes(data.processes.find(({ id }) => id === item.processId)?.workspaceId) && item.kind !== "run");
    if (route === "goals") rows = rows.filter(({ kind }) => kind === "goal");
    if (route === "waiting") rows = rows.filter((item) => !isDone(item) && (["waiting", "failed"].includes(item.runtimePhase) || data.runs.some((run) => run.workItemId === item.id && ["waiting_for_input", "waiting_for_approval", "interrupted"].includes(run.status))));
    if (route === "waiting") return rows;
    return rows.filter((item) => route === "completed" ? isDone(item) : !isDone(item));
  }

  // dsh-runtime/node_modules/gridstack/dist/utils.js
  var Utils = class _Utils {
    /**
     * Convert a potential selector into an actual list of HTML elements.
     * Supports CSS selectors, element references, and special ID handling.
     *
     * @param els selector string, HTMLElement, or array of elements
     * @param root optional root element to search within (defaults to document, useful for shadow DOM)
     * @returns array of HTML elements matching the selector
     *
     * @example
     * const elements = Utils.getElements('.grid-item');
     * const byId = Utils.getElements('#myWidget');
     * const fromShadow = Utils.getElements('.item', shadowRoot);
     */
    static getElements(els, root = document) {
      if (typeof els === "string") {
        const doc = "getElementById" in root ? root : void 0;
        if (doc && !isNaN(+els[0])) {
          const el = doc.getElementById(els);
          return el ? [el] : [];
        }
        let list = root.querySelectorAll(els);
        if (!list.length && els[0] !== "." && els[0] !== "#") {
          list = root.querySelectorAll("." + els);
          if (!list.length)
            list = root.querySelectorAll("#" + els);
          if (!list.length) {
            const el = root.querySelector(`[gs-id="${els}"]`);
            return el ? [el] : [];
          }
        }
        return Array.from(list);
      }
      return [els];
    }
    /**
     * Convert a potential selector into a single HTML element.
     * Similar to getElements() but returns only the first match.
     *
     * @param els selector string or HTMLElement
     * @param root optional root element to search within (defaults to document)
     * @returns the first HTML element matching the selector, or null if not found
     *
     * @example
     * const element = Utils.getElement('#myWidget');
     * const first = Utils.getElement('.grid-item');
     */
    static getElement(els, root = document) {
      if (typeof els === "string") {
        const doc = "getElementById" in root ? root : void 0;
        if (!els.length)
          return null;
        if (doc && els[0] === "#") {
          return doc.getElementById(els.substring(1));
        }
        if (els[0] === "#" || els[0] === "." || els[0] === "[") {
          return root.querySelector(els);
        }
        if (doc && !isNaN(+els[0])) {
          return doc.getElementById(els);
        }
        let el = root.querySelector(els);
        if (doc && !el) {
          el = doc.getElementById(els);
        }
        if (!el) {
          el = root.querySelector("." + els);
        }
        return el;
      }
      return els;
    }
    /**
     * Check if a widget should be lazy loaded based on node or grid settings.
     *
     * @param n the grid node to check
     * @returns true if the item should be lazy loaded
     *
     * @example
     * if (Utils.lazyLoad(node)) {
     *   // Set up intersection observer for lazy loading
     * }
     */
    static lazyLoad(n) {
      return !!(n.lazyLoad || n.grid?.opts?.lazyLoad && n.lazyLoad !== false);
    }
    /**
     * Create a div element with the specified CSS classes.
     *
     * @param classes array of CSS class names to add
     * @param parent optional parent element to append the div to
     * @returns the created div element
     *
     * @example
     * const div = Utils.createDiv(['grid-item', 'draggable']);
     * const nested = Utils.createDiv(['content'], parentDiv);
     */
    static createDiv(classes, parent) {
      const el = document.createElement("div");
      classes.forEach((c) => {
        if (c)
          el.classList.add(c);
      });
      parent?.appendChild(el);
      return el;
    }
    /**
     * Check if a widget should resize to fit its content.
     *
     * @param n the grid node to check (can be undefined)
     * @param strict if true, only returns true for explicit sizeToContent:true (not numbers)
     * @returns true if the widget should resize to content
     *
     * @example
     * if (Utils.shouldSizeToContent(node)) {
     *   // Trigger content-based resizing
     * }
     */
    static shouldSizeToContent(n, strict = false) {
      return !!(n?.grid && (strict ? n.sizeToContent === true || n.grid.opts.sizeToContent === true && n.sizeToContent === void 0 : !!n.sizeToContent || n.grid.opts.sizeToContent && n.sizeToContent !== false));
    }
    /**
     * Check if two grid positions overlap/intersect.
     *
     * @param a first position with x, y, w, h properties
     * @param b second position with x, y, w, h properties
     * @returns true if the positions overlap
     *
     * @example
     * const overlaps = Utils.isIntercepted(
     *   {x: 0, y: 0, w: 2, h: 1},
     *   {x: 1, y: 0, w: 2, h: 1}
     * ); // true - they overlap
     */
    static isIntercepted(a, b) {
      return !(a.y >= b.y + b.h || a.y + a.h <= b.y || a.x + a.w <= b.x || a.x >= b.x + b.w);
    }
    /**
     * Check if two grid positions are touching (edges or corners).
     *
     * @param a first position
     * @param b second position
     * @returns true if the positions are touching
     *
     * @example
     * const touching = Utils.isTouching(
     *   {x: 0, y: 0, w: 2, h: 1},
     *   {x: 2, y: 0, w: 1, h: 1}
     * ); // true - they share an edge
     */
    static isTouching(a, b) {
      return _Utils.isIntercepted(a, { x: b.x - 0.5, y: b.y - 0.5, w: b.w + 1, h: b.h + 1 });
    }
    /**
     * Calculate the overlapping area between two grid positions.
     *
     * @param a first position
     * @param b second position
     * @returns the area of overlap (0 if no overlap)
     *
     * @example
     * const overlap = Utils.areaIntercept(
     *   {x: 0, y: 0, w: 3, h: 2},
     *   {x: 1, y: 0, w: 3, h: 2}
     * ); // returns 4 (2x2 overlap)
     */
    static areaIntercept(a, b) {
      const x0 = a.x > b.x ? a.x : b.x;
      const x1 = a.x + a.w < b.x + b.w ? a.x + a.w : b.x + b.w;
      if (x1 <= x0)
        return 0;
      const y0 = a.y > b.y ? a.y : b.y;
      const y1 = a.y + a.h < b.y + b.h ? a.y + a.h : b.y + b.h;
      if (y1 <= y0)
        return 0;
      return (x1 - x0) * (y1 - y0);
    }
    /**
     * Calculate the total area of a grid position.
     *
     * @param a position with width and height
     * @returns the total area (width * height)
     *
     * @example
     * const area = Utils.area({x: 0, y: 0, w: 3, h: 2}); // returns 6
     */
    static area(a) {
      return a.w * a.h;
    }
    /**
     * Sort an array of grid nodes by position (y first, then x).
     *
     * @param nodes array of nodes to sort
     * @param dir sort direction: 1 for ascending (top-left first), -1 for descending
     * @returns the sorted array (modifies original)
     *
     * @example
     * const sorted = Utils.sort(nodes); // Sort top-left to bottom-right
     * const reverse = Utils.sort(nodes, -1); // Sort bottom-right to top-left
     */
    static sort(nodes, dir = 1) {
      const und = Number.MAX_SAFE_INTEGER;
      return nodes.sort((a, b) => {
        const diffY = dir * ((a.y ?? und) - (b.y ?? und));
        if (diffY === 0)
          return dir * ((a.x ?? und) - (b.x ?? und));
        return diffY;
      });
    }
    /**
     * Find a grid node by its ID.
     *
     * @param nodes array of nodes to search
     * @param id the ID to search for
     * @returns the node with matching ID, or undefined if not found
     *
     * @example
     * const node = Utils.find(nodes, 'widget-1');
     * if (node) console.log('Found node at:', node.x, node.y);
     */
    static find(nodes, id) {
      return id ? nodes.find((n) => n.id === id) : void 0;
    }
    /**
     * Find a node by ID in a grid, optionally searching nested sub-grids.
     *
     * @param g the grid to search
     * @param id the ID to search for
     * @param recursive if true (default), also search nested sub-grids
     * @returns the node with matching ID, or undefined if not found
     *
     * @example
     * const node = Utils.findInGrid(grid, 'widget-1');          // recursive by default
     * const top  = Utils.findInGrid(grid, 'widget-1', false);   // top-level only
     */
    static findInGrid(g, id, recursive) {
      const hit = g.engine.nodes.find((n) => String(n.id) === id);
      if (hit || !recursive)
        return hit;
      for (const n of g.engine.nodes) {
        if (n.subGrid) {
          const nested = _Utils.findInGrid(n.subGrid, id);
          if (nested)
            return nested;
        }
      }
      return void 0;
    }
    /**
     * Convert various value types to boolean.
     * Handles strings like 'false', 'no', '0' as false.
     *
     * @param v value to convert
     * @returns boolean representation
     *
     * @example
     * Utils.toBool('true');  // true
     * Utils.toBool('false'); // false
     * Utils.toBool('no');    // false
     * Utils.toBool('1');     // true
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static toBool(v) {
      if (typeof v === "boolean") {
        return v;
      }
      if (typeof v === "string") {
        v = v.toLowerCase();
        return !(v === "" || v === "no" || v === "false" || v === "0");
      }
      return Boolean(v);
    }
    /**
     * Convert a string value to a number, handling null and empty strings.
     *
     * @param value string or null value to convert
     * @returns number value, or undefined for null/empty strings
     *
     * @example
     * Utils.toNumber('42');  // 42
     * Utils.toNumber('');    // undefined
     * Utils.toNumber(null);  // undefined
     */
    static toNumber(value) {
      return value === null || value.length === 0 ? void 0 : Number(value);
    }
    /**
     * Parse a height value with units into numeric value and unit string.
     * Supports px, em, rem, vh, vw, %, cm, mm units.
     *
     * @param val height value as number or string with units
     * @returns object with h (height) and unit properties
     *
     * @example
     * Utils.parseHeight('100px');  // {h: 100, unit: 'px'}
     * Utils.parseHeight('2rem');   // {h: 2, unit: 'rem'}
     * Utils.parseHeight(50);       // {h: 50, unit: 'px'}
     */
    static parseHeight(val) {
      let h2;
      let unit = "px";
      if (typeof val === "string") {
        if (val === "auto" || val === "")
          h2 = 0;
        else {
          const match = val.match(/^(-[0-9]+\.[0-9]+|[0-9]*\.[0-9]+|-[0-9]+|[0-9]+)(px|em|rem|vh|vw|%|cm|mm)?$/);
          if (!match) {
            throw new Error(`Invalid height val = ${val}`);
          }
          unit = match[2] || "px";
          h2 = parseFloat(match[1]);
        }
      } else {
        h2 = val;
      }
      return { h: h2, unit };
    }
    /**
     * Copy unset fields from source objects to target object (shallow merge with defaults).
     * Similar to Object.assign but only sets undefined/null fields.
     *
     * @param target the object to copy defaults into
     * @param sources one or more source objects to copy defaults from
     * @returns the modified target object
     *
     * @example
     * const config = { width: 100 };
     * Utils.defaults(config, { width: 200, height: 50 });
     * // config is now { width: 100, height: 50 }
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static defaults(target, ...sources) {
      sources.forEach((source) => {
        for (const key in source) {
          if (!Object.prototype.hasOwnProperty.call(source, key))
            return;
          if (target[key] === null || target[key] === void 0) {
            target[key] = source[key];
          } else if (typeof source[key] === "object" && typeof target[key] === "object") {
            _Utils.defaults(target[key], source[key]);
          }
        }
      });
      return target;
    }
    /**
     * Compare two objects for equality (shallow comparison).
     * Checks if objects have the same fields and values at one level deep.
     *
     * @param a first object to compare
     * @param b second object to compare
     * @returns true if objects have the same values
     *
     * @example
     * Utils.same({x: 1, y: 2}, {x: 1, y: 2}); // true
     * Utils.same({x: 1}, {x: 1, y: 2}); // false
     */
    static same(a, b) {
      if (typeof a !== "object")
        return a == b;
      if (typeof a !== typeof b)
        return false;
      const ao = a;
      const bo = b;
      if (Object.keys(ao).length !== Object.keys(bo).length)
        return false;
      for (const key in ao) {
        if (ao[key] !== bo[key])
          return false;
      }
      return true;
    }
    /**
     * Copy position and size properties from one widget to another.
     * Copies x, y, w, h and optionally min/max constraints.
     *
     * @param a target widget to copy to
     * @param b source widget to copy from
     * @param doMinMax if true, also copy min/max width/height constraints
     * @returns the target widget (a)
     *
     * @example
     * Utils.copyPos(widget1, widget2); // Copy position/size
     * Utils.copyPos(widget1, widget2, true); // Also copy constraints
     */
    static copyPos(a, b, doMinMax = false) {
      if (b.x !== void 0)
        a.x = b.x;
      if (b.y !== void 0)
        a.y = b.y;
      if (b.w !== void 0)
        a.w = b.w;
      if (b.h !== void 0)
        a.h = b.h;
      if (doMinMax) {
        if (b.minW)
          a.minW = b.minW;
        if (b.minH)
          a.minH = b.minH;
        if (b.maxW)
          a.maxW = b.maxW;
        if (b.maxH)
          a.maxH = b.maxH;
      }
      return a;
    }
    /** true if a and b has same size & position */
    static samePos(a, b) {
      return a && b && a.x === b.x && a.y === b.y && (a.w || 1) === (b.w || 1) && (a.h || 1) === (b.h || 1);
    }
    /** given a node, makes sure it's min/max are valid */
    static sanitizeMinMax(node) {
      if (!node.minW) {
        delete node.minW;
      }
      if (!node.minH) {
        delete node.minH;
      }
      if (!node.maxW) {
        delete node.maxW;
      }
      if (!node.maxH) {
        delete node.maxH;
      }
    }
    /** removes field from the first object if same as the second objects (like diffing) and internal '_' for saving */
    static removeInternalAndSame(a, b) {
      if (typeof a !== "object" || typeof b !== "object")
        return;
      if (!a || !b)
        return;
      if (Array.isArray(a) || Array.isArray(b))
        return;
      const ao = a;
      const bo = b;
      for (const key in ao) {
        const aVal = ao[key];
        const bVal = bo[key];
        if (key[0] === "_" || aVal === bVal) {
          delete ao[key];
        } else if (aVal && typeof aVal === "object" && bVal !== void 0) {
          _Utils.removeInternalAndSame(aVal, bVal);
          if (!Object.keys(aVal).length) {
            delete ao[key];
          }
        }
      }
    }
    /** removes internal fields '_' and default values for saving */
    static removeInternalForSave(n, removeEl = true) {
      const nd = n;
      for (const key in nd) {
        if (key[0] === "_" || nd[key] === null || nd[key] === void 0)
          delete nd[key];
      }
      delete n.grid;
      if (removeEl)
        delete n.el;
      if (!n.autoPosition)
        delete n.autoPosition;
      if (!n.noResize)
        delete n.noResize;
      if (!n.noMove)
        delete n.noMove;
      if (!n.locked)
        delete n.locked;
      if (n.w === 1 || n.w === n.minW)
        delete n.w;
      if (n.h === 1 || n.h === n.minH)
        delete n.h;
    }
    /** delay calling the given function for given delay, preventing new calls from happening while waiting */
    static throttle(func, delay) {
      let isWaiting = false;
      return (...args) => {
        if (!isWaiting) {
          isWaiting = true;
          setTimeout(() => {
            func(...args);
            isWaiting = false;
          }, delay);
        }
      };
    }
    static removePositioningStyles(el) {
      const style = el.style;
      if (style.position) {
        style.removeProperty("position");
      }
      if (style.left) {
        style.removeProperty("left");
      }
      if (style.top) {
        style.removeProperty("top");
      }
      if (style.width) {
        style.removeProperty("width");
      }
      if (style.height) {
        style.removeProperty("height");
      }
    }
    /** @internal returns the passed element if vertically scrollable, else the closest parent that will, up to the entire document scrolling element */
    static getScrollElement(el) {
      if (!el)
        return document.scrollingElement || document.documentElement;
      const overflowY = getComputedStyle(el).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
        return el;
      } else {
        return _Utils.getScrollElement(el.parentElement ?? void 0);
      }
    }
    /**
     * @internal Function used to scroll the page.
     *
     * @param event `MouseEvent` that triggers the resize
     * @param el `HTMLElement` that's being resized
     * @param distance Distance from the V edges to start scrolling
     */
    static updateScrollResize(event, el, distance) {
      const scrollEl = _Utils.getScrollElement(el);
      const height = scrollEl.clientHeight;
      const offsetTop = scrollEl === _Utils.getScrollElement() ? 0 : scrollEl.getBoundingClientRect().top;
      const pointerPosY = event.clientY - offsetTop;
      const top = pointerPosY < distance;
      const bottom = pointerPosY > height - distance;
      if (top) {
        scrollEl.scrollBy({ behavior: "smooth", top: pointerPosY - distance });
      } else if (bottom) {
        scrollEl.scrollBy({ behavior: "smooth", top: distance - (height - pointerPosY) });
      }
    }
    /** single level clone, returning a new object with same top fields. This will share sub objects and arrays */
    static clone(obj) {
      if (obj === null || obj === void 0 || typeof obj !== "object") {
        return obj;
      }
      if (obj instanceof Array) {
        return [...obj];
      }
      return { ...obj };
    }
    /**
     * Recursive clone version that returns a full copy, checking for nested objects and arrays ONLY.
     * Note: this will use as-is any key starting with double __ (and not copy inside) some lib have circular dependencies.
     */
    static cloneDeep(obj) {
      const skipFields = ["parentGrid", "el", "grid", "subGrid", "engine"];
      const ret = _Utils.clone(obj);
      for (const key in ret) {
        if (Object.prototype.hasOwnProperty.call(ret, key) && typeof ret[key] === "object" && key.substring(0, 2) !== "__" && !skipFields.find((k) => k === key)) {
          ret[key] = _Utils.cloneDeep(obj[key]);
        }
      }
      return ret;
    }
    /** deep clone the given HTML node, removing the unique id field */
    static cloneNode(el) {
      const node = el.cloneNode(true);
      node.removeAttribute("id");
      return node;
    }
    static appendTo(el, parent) {
      let parentNode;
      if (typeof parent === "string") {
        parentNode = _Utils.getElement(parent);
      } else {
        parentNode = parent;
      }
      if (parentNode) {
        parentNode.appendChild(el);
      }
    }
    static addElStyles(el, styles) {
      if (styles instanceof Object) {
        const elStyle = el.style;
        for (const s in styles) {
          if (Object.prototype.hasOwnProperty.call(styles, s)) {
            if (Array.isArray(styles[s])) {
              styles[s].forEach((val) => {
                elStyle[s] = val;
              });
            } else {
              elStyle[s] = styles[s];
            }
          }
        }
      }
    }
    static initEvent(e, info) {
      const evt = { type: info.type };
      const obj = {
        button: 0,
        which: 0,
        buttons: 1,
        bubbles: true,
        cancelable: true,
        target: info.target ? info.target : e.target
      };
      const src = e;
      ["altKey", "ctrlKey", "metaKey", "shiftKey"].forEach((p) => evt[p] = src[p]);
      ["pageX", "pageY", "clientX", "clientY", "screenX", "screenY"].forEach((p) => evt[p] = src[p]);
      return { ...evt, ...obj };
    }
    /** copies the MouseEvent (or convert Touch) properties and sends it as another event to the given target */
    static simulateMouseEvent(e, simulatedType, target) {
      const me = e;
      const simulatedEvent = new MouseEvent(simulatedType, {
        bubbles: true,
        composed: true,
        cancelable: true,
        view: window,
        detail: 1,
        screenX: e.screenX,
        screenY: e.screenY,
        clientX: e.clientX,
        clientY: e.clientY,
        ctrlKey: me.ctrlKey ?? false,
        altKey: me.altKey ?? false,
        shiftKey: me.shiftKey ?? false,
        metaKey: me.metaKey ?? false,
        button: 0,
        relatedTarget: e.target
      });
      (target || e.target).dispatchEvent(simulatedEvent);
    }
    /**
     * defines an element that is used to get the offset and scale from grid transforms
     * returns the scale and offsets from said element
    */
    static getValuesFromTransformedElement(parent) {
      const transformReference = document.createElement("div");
      _Utils.addElStyles(transformReference, {
        opacity: "0",
        position: "fixed",
        top: "0px",
        left: "0px",
        width: "1px",
        height: "1px",
        zIndex: "-999999"
      });
      parent.appendChild(transformReference);
      const transformValues = transformReference.getBoundingClientRect();
      parent.removeChild(transformReference);
      transformReference.remove();
      return {
        xScale: 1 / transformValues.width,
        yScale: 1 / transformValues.height,
        xOffset: transformValues.left,
        yOffset: transformValues.top
      };
    }
    /** swap the given object 2 field values */
    static swap(o, a, b) {
      if (!o)
        return;
      const obj = o;
      const tmp = obj[a];
      obj[a] = obj[b];
      obj[b] = tmp;
    }
    /** true if the item can be rotated (checking for prop, not space available) */
    static canBeRotated(n) {
      return !(!n || n.w === n.h || n.locked || n.noResize || n.grid?.opts.disableResize || n.minW && n.minW === n.maxW || n.minH && n.minH === n.maxH);
    }
  };

  // dsh-runtime/node_modules/gridstack/dist/gridstack-engine.js
  var GridStackEngine = class _GridStackEngine {
    constructor(opts = {}) {
      this.addedNodes = [];
      this.removedNodes = [];
      this.defaultColumn = 12;
      this.column = opts.column || this.defaultColumn;
      if (this.column > this.defaultColumn)
        this.defaultColumn = this.column;
      this.maxRow = opts.maxRow ?? 0;
      this._float = opts.float ?? false;
      this.nodes = opts.nodes || [];
      this.onChange = opts.onChange ?? (() => {
      });
    }
    /**
     * Enable/disable batch mode for multiple operations to optimize performance.
     * When enabled, layout updates are deferred until batch mode is disabled.
     *
     * @param flag true to enable batch mode, false to disable and apply changes
     * @param doPack if true (default), pack/compact nodes when disabling batch mode
     * @returns the engine instance for chaining
     *
     * @example
     * // Start batch mode for multiple operations
     * engine.batchUpdate(true);
     * engine.addNode(node1);
     * engine.addNode(node2);
     * engine.batchUpdate(false); // Apply all changes at once
     */
    batchUpdate(flag = true, doPack = true) {
      if (!!this.batchMode === flag)
        return this;
      this.batchMode = flag;
      if (flag) {
        this._prevFloat = this._float;
        this._float = true;
        this.cleanNodes();
        if (!this.nodes.some((n) => n._updating))
          this.saveInitial();
      } else {
        this._float = this._prevFloat ?? false;
        delete this._prevFloat;
        if (doPack)
          this._packNodes();
        this._notify();
      }
      return this;
    }
    // use entire row for hitting area (will use bottom reverse sorted first) if we not actively moving DOWN and didn't already skip
    _useEntireRowArea(node, nn) {
      return (!this.float || this.batchMode && !this._prevFloat) && !this._hasLocked && (!node._moving || node._skipDown || nn.y <= node.y);
    }
    /** @internal fix collision on given 'node', going to given new location 'nn', with optional 'collide' node already found.
     * return true if we moved. */
    _fixCollisions(node, nn = node, collide, opt = {}) {
      this.sortNodes(-1);
      collide = collide || this.collide(node, nn);
      if (!collide)
        return false;
      if (node._moving && !node._isExternal && !opt.nested && !this.float) {
        if (this.swap(node, collide))
          return true;
      }
      let area = nn;
      if (!this._loading && this._useEntireRowArea(node, nn)) {
        area = { x: 0, w: this.column, y: nn.y, h: nn.h };
        collide = this.collide(node, area, opt.skip);
      }
      let didMove = false;
      const newOpt = { nested: true, pack: false };
      let counter = 0;
      while (collide = collide || this.collide(node, area, opt.skip)) {
        if (counter++ > this.nodes.length * 2) {
          throw new Error("Infinite collide check");
        }
        let moved;
        if (collide.locked || this._loading || node._moving && !node._skipDown && nn.y > node.y && !this.float && // can take space we had, or before where we're going
        (!this.collide(collide, { ...collide, y: node.y }, node) || !this.collide(collide, { ...collide, y: nn.y - collide.h }, node))) {
          node._skipDown = node._skipDown || nn.y > node.y;
          const newNN = { ...nn, y: collide.y + collide.h, ...newOpt };
          moved = this._loading && Utils.samePos(node, newNN) ? true : this.moveNode(node, newNN);
          if ((collide.locked || this._loading) && moved) {
            Utils.copyPos(nn, node);
          } else if (!collide.locked && moved && opt.pack) {
            this._packNodes();
            nn.y = collide.y + collide.h;
            Utils.copyPos(node, nn);
          }
          didMove = didMove || moved;
        } else {
          moved = this.moveNode(collide, { ...collide, y: nn.y + nn.h, skip: node, ...newOpt });
        }
        if (!moved)
          return didMove;
        collide = void 0;
      }
      return didMove;
    }
    /**
     * Return the first node that intercepts/collides with the given node or area.
     * Used for collision detection during drag and drop operations.
     *
     * @param skip the node to skip in collision detection (usually the node being moved)
     * @param area the area to check for collisions (defaults to skip node's area)
     * @param skip2 optional second node to skip in collision detection
     * @returns the first colliding node, or undefined if no collision
     *
     * @example
     * const colliding = engine.collide(draggedNode, {x: 2, y: 1, w: 2, h: 1});
     * if (colliding) {
     *   console.log('Would collide with:', colliding.id);
     * }
     */
    collide(skip, area = skip, skip2) {
      const skipId = skip._id;
      const skip2Id = skip2?._id;
      return this.nodes.find((n) => n._id !== skipId && n._id !== skip2Id && Utils.isIntercepted(n, area));
    }
    /**
     * Return all nodes that intercept/collide with the given node or area.
     * Similar to collide() but returns all colliding nodes instead of just the first.
     *
     * @param skip the node to skip in collision detection
     * @param area the area to check for collisions (defaults to skip node's area)
     * @param skip2 optional second node to skip in collision detection
     * @returns array of all colliding nodes
     *
     * @example
     * const allCollisions = engine.collideAll(draggedNode);
     * console.log('Colliding with', allCollisions.length, 'nodes');
     */
    collideAll(skip, area = skip, skip2) {
      const skipId = skip._id;
      const skip2Id = skip2?._id;
      return this.nodes.filter((n) => n._id !== skipId && n._id !== skip2Id && Utils.isIntercepted(n, area));
    }
    /** does a pixel coverage collision based on where we started, returning the node that has the most coverage that is >50% mid line */
    directionCollideCoverage(node, o, collides) {
      if (!o.rect || !node._rect)
        return;
      const r0 = node._rect;
      const r = { ...o.rect };
      if (r.y > r0.y) {
        r.h = r.h + r.y - r0.y;
        r.y = r0.y;
      } else {
        r.h = r.h + r0.y - r.y;
      }
      if (r.x > r0.x) {
        r.w = r.w + r.x - r0.x;
        r.x = r0.x;
      } else {
        r.w = r.w + r0.x - r.x;
      }
      let collide;
      let overMax = 0.5;
      for (const n of collides) {
        if (n.locked || !n._rect) {
          continue;
        }
        const r2 = n._rect;
        let yOver = Number.MAX_VALUE, xOver = Number.MAX_VALUE;
        if (r0.y < r2.y) {
          yOver = (r.y + r.h - r2.y) / r2.h;
        } else if (r0.y + r0.h > r2.y + r2.h) {
          yOver = (r2.y + r2.h - r.y) / r2.h;
        }
        if (r0.x < r2.x) {
          xOver = (r.x + r.w - r2.x) / r2.w;
        } else if (r0.x + r0.w > r2.x + r2.w) {
          xOver = (r2.x + r2.w - r.x) / r2.w;
        }
        const over = Math.min(xOver, yOver);
        if (over > overMax) {
          overMax = over;
          collide = n;
        }
      }
      o.collide = collide;
      return collide;
    }
    /**
     * Cache the pixel rectangles for all nodes used for collision detection during drag operations.
     * This optimization converts grid coordinates to pixel coordinates for faster collision detection.
     *
     * @param w width of a single grid cell in pixels
     * @param h height of a single grid cell in pixels
     * @param top top margin/padding in pixels
     * @param right right margin/padding in pixels
     * @param bottom bottom margin/padding in pixels
     * @param left left margin/padding in pixels
     * @returns the engine instance for chaining
     *
     * @internal This is typically called by GridStack during resize events
     */
    cacheRects(w, h2, top, right, bottom, left) {
      this.nodes.forEach((n) => n._rect = {
        y: n.y * h2 + top,
        x: n.x * w + left,
        w: n.w * w - left - right,
        h: n.h * h2 - top - bottom
      });
      return this;
    }
    /**
     * Attempt to swap the positions of two nodes if they meet swapping criteria.
     * Nodes can swap if they are the same size or in the same column/row, not locked, and touching.
     *
     * @param a first node to swap
     * @param b second node to swap
     * @returns true if swap was successful, false if not possible, undefined if not applicable
     *
     * @example
     * const swapped = engine.swap(nodeA, nodeB);
     * if (swapped) {
     *   console.log('Nodes swapped successfully');
     * }
     */
    swap(a, b) {
      if (!b || b.locked || !a || a.locked)
        return false;
      function _doSwap() {
        const x = b.x, y = b.y;
        b.x = a.x;
        b.y = a.y;
        if (a.h != b.h) {
          a.x = x;
          a.y = b.y + b.h;
        } else if (a.w != b.w) {
          a.x = b.x + b.w;
          a.y = y;
        } else {
          a.x = x;
          a.y = y;
        }
        a._dirty = b._dirty = true;
        return true;
      }
      let touching;
      if (a.w === b.w && a.h === b.h && (a.x === b.x || a.y === b.y) && (touching = Utils.isTouching(a, b)))
        return _doSwap();
      if (touching === false)
        return;
      if (a.w === b.w && a.x === b.x && (touching || (touching = Utils.isTouching(a, b)))) {
        if (b.y < a.y) {
          const t = a;
          a = b;
          b = t;
        }
        return _doSwap();
      }
      if (touching === false)
        return;
      if (a.h === b.h && a.y === b.y && (touching || (touching = Utils.isTouching(a, b)))) {
        if (b.x < a.x) {
          const t = a;
          a = b;
          b = t;
        }
        return _doSwap();
      }
      return false;
    }
    /**
     * Check if the specified rectangular area is empty (no nodes occupy any part of it).
     *
     * @param x the x coordinate (column) of the area to check
     * @param y the y coordinate (row) of the area to check
     * @param w the width in columns of the area to check
     * @param h the height in rows of the area to check
     * @returns true if the area is completely empty, false if any node overlaps
     *
     * @example
     * if (engine.isAreaEmpty(2, 1, 3, 2)) {
     *   console.log('Area is available for placement');
     * }
     */
    isAreaEmpty(x, y, w, h2) {
      const nn = { x: x || 0, y: y || 0, w: w || 1, h: h2 || 1 };
      return !this.collide(nn);
    }
    /**
     * Re-layout grid items to reclaim any empty space.
     * This optimizes the grid layout by moving items to fill gaps.
     *
     * @param layout layout algorithm to use:
     *   - 'compact' (default): find truly empty spaces, may reorder items
     *   - 'list': keep the sort order exactly the same, move items up sequentially
     * @param doSort if true (default), sort nodes by position before compacting
     * @returns the engine instance for chaining
     *
     * @example
     * // Compact to fill empty spaces
     * engine.compact();
     *
     * // Compact preserving item order
     * engine.compact('list');
     */
    compact(layout = "compact", doSort = true) {
      if (this.nodes.length === 0)
        return this;
      if (doSort)
        this.sortNodes();
      const wasBatch = this.batchMode;
      if (!wasBatch)
        this.batchUpdate();
      const wasColumnResize = this._inColumnResize;
      if (!wasColumnResize)
        this._inColumnResize = true;
      const copyNodes = this.nodes;
      this.nodes = [];
      copyNodes.forEach((n, index, list) => {
        let after;
        if (!n.locked) {
          n.autoPosition = true;
          if (layout === "list" && index)
            after = list[index - 1];
        }
        this.addNode(n, false, after);
      });
      if (!wasColumnResize)
        delete this._inColumnResize;
      if (!wasBatch)
        this.batchUpdate(false);
      return this;
    }
    /**
     * Enable/disable floating widgets (default: `false`).
     * When floating is enabled, widgets can move up to fill empty spaces.
     * See [example](http://gridstackjs.com/demo/float.html)
     *
     * @param val true to enable floating, false to disable
     *
     * @example
     * engine.float = true;  // Enable floating
     * engine.float = false; // Disable floating (default)
     */
    set float(val) {
      if (this._float === val)
        return;
      this._float = val || false;
      if (!val) {
        this._packNodes()._notify();
      }
    }
    /**
     * Get the current floating mode setting.
     *
     * @returns true if floating is enabled, false otherwise
     *
     * @example
     * const isFloating = engine.float;
     * console.log('Floating enabled:', isFloating);
     */
    get float() {
      return this._float || false;
    }
    /**
     * Sort the nodes array from first to last, or reverse.
     * This is called during collision/placement operations to enforce a specific order.
     *
     * @param dir sort direction: 1 for ascending (first to last), -1 for descending (last to first)
     * @returns the engine instance for chaining
     *
     * @example
     * engine.sortNodes();    // Sort ascending (default)
     * engine.sortNodes(-1);  // Sort descending
     */
    sortNodes(dir = 1) {
      this.nodes = Utils.sort(this.nodes, dir);
      return this;
    }
    /** @internal called to top gravity pack the items back OR revert back to original Y positions when floating */
    _packNodes() {
      if (this.batchMode) {
        return this;
      }
      this.sortNodes();
      if (this.float) {
        this.nodes.forEach((n) => {
          if (n._updating || n._orig === void 0 || n.y === n._orig.y)
            return;
          let newY = n.y;
          while (newY > n._orig.y) {
            --newY;
            const collide = this.collide(n, { x: n.x, y: newY, w: n.w, h: n.h });
            if (!collide) {
              n._dirty = true;
              n.y = newY;
            }
          }
        });
      } else {
        this.nodes.forEach((n, i) => {
          if (n.locked)
            return;
          while (n.y > 0) {
            const newY = i === 0 ? 0 : n.y - 1;
            const canBeMoved = i === 0 || !this.collide(n, { x: n.x, y: newY, w: n.w, h: n.h });
            if (!canBeMoved)
              break;
            n._dirty = n.y !== newY;
            n.y = newY;
          }
        });
      }
      return this;
    }
    /**
     * Prepare and validate a node's coordinates and values for the current grid.
     * This ensures the node has valid position, size, and properties before being added to the grid.
     *
     * @param node the node to prepare and validate
     * @param resizing if true, resize the node down if it's out of bounds; if false, move it to fit
     * @returns the prepared node with valid coordinates
     *
     * @example
     * const node = { w: 3, h: 2, content: 'Hello' };
     * const prepared = engine.prepareNode(node);
     * console.log('Node prepared at:', prepared.x, prepared.y);
     */
    prepareNode(node, resizing) {
      node._id = node._id ?? _GridStackEngine._idSeq++;
      const id = node.id;
      if (id) {
        let count = 1;
        while (this.nodes.find((n) => n.id === node.id && n !== node)) {
          node.id = id + "_" + count++;
        }
      }
      if (node.x === void 0 || node.y === void 0 || node.x === null || node.y === null) {
        node.autoPosition = true;
      }
      const defaults = { x: 0, y: 0, w: 1, h: 1 };
      Utils.defaults(node, defaults);
      if (!node.autoPosition) {
        delete node.autoPosition;
      }
      if (!node.noResize) {
        delete node.noResize;
      }
      if (!node.noMove) {
        delete node.noMove;
      }
      Utils.sanitizeMinMax(node);
      if (typeof node.x == "string") {
        node.x = Number(node.x);
      }
      if (typeof node.y == "string") {
        node.y = Number(node.y);
      }
      if (typeof node.w == "string") {
        node.w = Number(node.w);
      }
      if (typeof node.h == "string") {
        node.h = Number(node.h);
      }
      if (isNaN(node.x)) {
        node.x = defaults.x;
        node.autoPosition = true;
      }
      if (isNaN(node.y)) {
        node.y = defaults.y;
        node.autoPosition = true;
      }
      if (isNaN(node.w)) {
        node.w = defaults.w;
      }
      if (isNaN(node.h)) {
        node.h = defaults.h;
      }
      this.nodeBoundFix(node, resizing);
      return node;
    }
    /**
     * Part 2 of preparing a node to fit inside the grid - validates and fixes coordinates and dimensions.
     * This ensures the node fits within grid boundaries and respects min/max constraints.
     *
     * @param node the node to validate and fix
     * @param resizing if true, resize the node to fit; if false, move the node to fit
     * @returns the engine instance for chaining
     *
     * @example
     * // Fix a node that might be out of bounds
     * engine.nodeBoundFix(node, true); // Resize to fit
     * engine.nodeBoundFix(node, false); // Move to fit
     */
    nodeBoundFix(node, resizing) {
      const before = node._orig || Utils.copyPos({}, node);
      if (node.maxW) {
        node.w = Math.min(node.w || 1, node.maxW);
      }
      if (node.maxH) {
        node.h = Math.min(node.h || 1, node.maxH);
      }
      if (node.minW) {
        node.w = Math.max(node.w || 1, node.minW);
      }
      if (node.minH) {
        node.h = Math.max(node.h || 1, node.minH);
      }
      const saveOrig = (node.x || 0) + (node.w || 1) > this.column;
      if (saveOrig && this.column < this.defaultColumn && !this._inColumnResize && !this.skipCacheUpdate && node._id != null && this.findCacheLayout(node, this.defaultColumn) === -1) {
        const copy = { ...node };
        if (copy.autoPosition || copy.x === void 0) {
          delete copy.x;
          delete copy.y;
        } else
          copy.x = Math.min(this.defaultColumn - 1, copy.x);
        copy.w = Math.min(this.defaultColumn, copy.w || 1);
        this.cacheOneLayout(copy, this.defaultColumn);
      }
      if (node.w > this.column) {
        node.w = this.column;
      } else if (node.w < 1) {
        node.w = 1;
      }
      if (this.maxRow && node.h > this.maxRow) {
        node.h = this.maxRow;
      } else if (node.h < 1) {
        node.h = 1;
      }
      if (node.x < 0) {
        node.x = 0;
      }
      if (node.y < 0) {
        node.y = 0;
      }
      if (node.x + node.w > this.column) {
        if (resizing) {
          node.w = this.column - node.x;
        } else {
          node.x = this.column - node.w;
        }
      }
      if (this.maxRow && node.y + node.h > this.maxRow) {
        if (resizing) {
          node.h = this.maxRow - node.y;
        } else {
          node.y = this.maxRow - node.h;
        }
      }
      if (!Utils.samePos(node, before)) {
        node._dirty = true;
      }
      return this;
    }
    /**
     * Returns a list of nodes that have been modified from their original values.
     * This is used to track which nodes need DOM updates.
     *
     * @param verify if true, performs additional verification by comparing current vs original positions
     * @returns array of nodes that have been modified
     *
     * @example
     * const changed = engine.getDirtyNodes();
     * console.log('Modified nodes:', changed.length);
     *
     * // Get verified dirty nodes
     * const verified = engine.getDirtyNodes(true);
     */
    getDirtyNodes(verify) {
      if (verify) {
        return this.nodes.filter((n) => n._dirty && n._orig && !Utils.samePos(n, n._orig));
      }
      return this.nodes.filter((n) => n._dirty);
    }
    /** @internal call this to call onChange callback with dirty nodes so DOM can be updated */
    _notify(removedNodes) {
      if (this.batchMode || !this.onChange)
        return this;
      const dirtyNodes = (removedNodes || []).concat(this.getDirtyNodes());
      this.onChange(dirtyNodes);
      return this;
    }
    /**
     * Clean all dirty and last tried information from nodes.
     * This resets the dirty state tracking for all nodes.
     *
     * @returns the engine instance for chaining
     *
     * @internal
     */
    cleanNodes() {
      if (this.batchMode)
        return this;
      this.nodes.forEach((n) => {
        delete n._dirty;
        delete n._lastTried;
      });
      return this;
    }
    /**
     * Save the initial position/size of all nodes to track real dirty state.
     * This creates a snapshot of current positions that can be restored later.
     *
     * Note: Should be called right after change events and before move/resize operations.
     *
     * @returns the engine instance for chaining
     *
     * @internal
     */
    saveInitial() {
      this.nodes.forEach((n) => {
        n._orig = Utils.copyPos({}, n);
        delete n._dirty;
      });
      this._hasLocked = this.nodes.some((n) => n.locked);
      return this;
    }
    /**
     * Restore all nodes back to their initial values.
     * This is typically called when canceling an operation (e.g., Esc key during drag).
     *
     * @returns the engine instance for chaining
     *
     * @internal
     */
    restoreInitial() {
      this.nodes.forEach((n) => {
        if (!n._orig || Utils.samePos(n, n._orig))
          return;
        Utils.copyPos(n, n._orig);
        n._dirty = true;
      });
      this._notify();
      return this;
    }
    /**
     * Find the first available empty spot for the given node dimensions.
     * Updates the node's x,y attributes with the found position.
     *
     * @param node the node to find a position for (w,h must be set)
     * @param nodeList optional list of nodes to check against (defaults to engine nodes)
     * @param column optional column count (defaults to engine column count)
     * @param after optional node to start search after (maintains order)
     * @returns true if an empty position was found and node was updated
     *
     * @example
     * const node = { w: 2, h: 1 };
     * if (engine.findEmptyPosition(node)) {
     *   console.log('Found position at:', node.x, node.y);
     * }
     */
    findEmptyPosition(node, nodeList = this.nodes, column = this.column, after) {
      const start = after ? after.y * column + (after.x + after.w) : 0;
      let found = false;
      for (let i = start; !found; ++i) {
        const x = i % column;
        const y = Math.floor(i / column);
        if (x + node.w > column) {
          continue;
        }
        const box = { x, y, w: node.w, h: node.h };
        if (!nodeList.find((n) => Utils.isIntercepted(box, n))) {
          if (node.x !== x || node.y !== y)
            node._dirty = true;
          node.x = x;
          node.y = y;
          delete node.autoPosition;
          found = true;
        }
      }
      return found;
    }
    /**
     * Add the given node to the grid, handling collision detection and re-packing.
     * This is the main method for adding new widgets to the engine.
     *
     * @param node the node to add to the grid
     * @param triggerAddEvent if true, adds node to addedNodes list for event triggering
     * @param after optional node to place this node after (for ordering)
     * @returns the added node (or existing node if duplicate)
     *
     * @example
     * const node = { x: 0, y: 0, w: 2, h: 1, content: 'Hello' };
     * const added = engine.addNode(node, true);
     */
    addNode(node, triggerAddEvent = false, after) {
      const dup = this.nodes.find((n) => n._id === node._id);
      if (dup)
        return dup;
      this._inColumnResize ? this.nodeBoundFix(node) : this.prepareNode(node);
      delete node._temporaryRemoved;
      delete node._removeDOM;
      let skipCollision = false;
      if (node.autoPosition && this.findEmptyPosition(node, this.nodes, this.column, after)) {
        delete node.autoPosition;
        skipCollision = true;
      }
      this.nodes.push(node);
      if (triggerAddEvent) {
        this.addedNodes.push(node);
      }
      if (!skipCollision)
        this._fixCollisions(node);
      if (!this.batchMode) {
        this._packNodes()._notify();
      }
      return node;
    }
    /**
     * Remove the given node from the grid.
     *
     * @param node the node to remove
     * @param removeDOM if true (default), marks node for DOM removal
     * @param triggerEvent if true, adds node to removedNodes list for event triggering
     * @returns the engine instance for chaining
     *
     * @example
     * engine.removeNode(node, true, true);
     */
    removeNode(node, removeDOM = true, triggerEvent = false) {
      if (!this.nodes.find((n) => n._id === node._id)) {
        return this;
      }
      if (triggerEvent) {
        this.removedNodes.push(node);
      }
      if (removeDOM)
        node._removeDOM = true;
      this.nodes = this.nodes.filter((n) => n._id !== node._id);
      if (!node._isAboutToRemove)
        this._packNodes();
      this._notify([node]);
      return this;
    }
    /**
     * Remove all nodes from the grid.
     *
     * @param removeDOM if true (default), marks all nodes for DOM removal
     * @param triggerEvent if true (default), triggers removal events
     * @returns the engine instance for chaining
     *
     * @example
     * engine.removeAll(); // Remove all nodes
     */
    removeAll(removeDOM = true, triggerEvent = true) {
      delete this._layouts;
      if (!this.nodes.length)
        return this;
      removeDOM && this.nodes.forEach((n) => n._removeDOM = true);
      const removedNodes = this.nodes;
      this.removedNodes = triggerEvent ? removedNodes : [];
      this.nodes = [];
      return this._notify(removedNodes);
    }
    /**
     * Check if a node can be moved to a new position, considering layout constraints.
     * This is a safer version of moveNode() that validates the move first.
     *
     * For complex cases (like maxRow constraints), it simulates the move in a clone first,
     * then applies the changes only if they meet all specifications.
     *
     * @param node the node to move
     * @param o move options including target position
     * @returns true if the node was successfully moved
     *
     * @example
     * const canMove = engine.moveNodeCheck(node, { x: 2, y: 1 });
     * if (canMove) {
     *   console.log('Node moved successfully');
     * }
     */
    moveNodeCheck(node, o) {
      if (!this.changedPosConstrain(node, o))
        return false;
      o.pack = true;
      if (!this.maxRow) {
        return this.moveNode(node, o);
      }
      let clonedNode;
      const clone = new _GridStackEngine({
        column: this.column,
        float: this.float,
        nodes: this.nodes.map((n) => {
          if (n._id === node._id) {
            clonedNode = { ...n };
            return clonedNode;
          }
          return { ...n };
        })
      });
      if (!clonedNode)
        return false;
      const canMove = clone.moveNode(clonedNode, o) && clone.getRow() <= Math.max(this.getRow(), this.maxRow);
      if (!canMove && !o.resizing && o.collide && !node._isExternal) {
        const collide = o.collide.el?.gridstackNode;
        if (collide && this.swap(node, collide)) {
          this._notify();
          return true;
        }
      }
      if (!canMove)
        return false;
      clone.nodes.filter((n) => n._dirty).forEach((c) => {
        const n = this.nodes.find((a) => a._id === c._id);
        if (!n)
          return;
        Utils.copyPos(n, c);
        n._dirty = true;
      });
      this._notify();
      return true;
    }
    /** return true if can fit in grid height constrain only (always true if no maxRow) */
    willItFit(node) {
      delete node._willFitPos;
      if (!this.maxRow)
        return true;
      const clone = new _GridStackEngine({
        column: this.column,
        float: this.float,
        nodes: this.nodes.map((n2) => {
          return { ...n2 };
        })
      });
      const n = { ...node };
      this.cleanupNode(n);
      delete n.el;
      delete n._id;
      delete n.content;
      delete n.grid;
      clone.addNode(n);
      if (clone.getRow() <= this.maxRow) {
        node._willFitPos = Utils.copyPos({}, n);
        return true;
      }
      return false;
    }
    /** true if x,y or w,h are different after clamping to min/max */
    changedPosConstrain(node, p) {
      p.w = p.w || node.w;
      p.h = p.h || node.h;
      if (node.x !== p.x || node.y !== p.y)
        return true;
      if (node.maxW) {
        p.w = Math.min(p.w, node.maxW);
      }
      if (node.maxH) {
        p.h = Math.min(p.h, node.maxH);
      }
      if (node.minW) {
        p.w = Math.max(p.w, node.minW);
      }
      if (node.minH) {
        p.h = Math.max(p.h, node.minH);
      }
      return node.w !== p.w || node.h !== p.h;
    }
    /** return true if the passed in node was actually moved (checks for no-op and locked) */
    moveNode(node, o) {
      if (!node || /*node.locked ||*/
      !o)
        return false;
      let wasUndefinedPack = false;
      if (o.pack === void 0 && !this.batchMode) {
        wasUndefinedPack = o.pack = true;
      }
      if (typeof o.x !== "number") {
        o.x = node.x;
      }
      if (typeof o.y !== "number") {
        o.y = node.y;
      }
      if (typeof o.w !== "number") {
        o.w = node.w;
      }
      if (typeof o.h !== "number") {
        o.h = node.h;
      }
      const resizing = node.w !== o.w || node.h !== o.h;
      const nn = Utils.copyPos({}, node, true);
      Utils.copyPos(nn, o);
      this.nodeBoundFix(nn, resizing);
      Utils.copyPos(o, nn);
      if (!o.forceCollide && Utils.samePos(node, o))
        return false;
      const prevPos = Utils.copyPos({}, node);
      const collides = this.collideAll(node, nn, o.skip);
      let needToMove = true;
      if (collides.length) {
        const activeDrag = node._moving && !o.nested;
        let collide = activeDrag ? this.directionCollideCoverage(node, o, collides) : collides[0];
        if (activeDrag && collide && node.grid?.opts?.subGridDynamic && !node.grid._isTemp) {
          const over = Utils.areaIntercept(o.rect, collide._rect);
          const a1 = Utils.area(o.rect);
          const a2 = Utils.area(collide._rect);
          const perc = over / (a1 < a2 ? a1 : a2);
          if (perc > 0.8) {
            collide.grid.makeSubGrid(collide.el, void 0, node);
            collide = void 0;
          }
        }
        if (collide) {
          needToMove = !this._fixCollisions(node, nn, collide, o);
        } else {
          needToMove = false;
          if (wasUndefinedPack)
            delete o.pack;
        }
      }
      if (needToMove && !Utils.samePos(node, nn)) {
        node._dirty = true;
        Utils.copyPos(node, nn);
      }
      if (o.pack) {
        this._packNodes()._notify();
      }
      return !Utils.samePos(node, prevPos);
    }
    getRow() {
      return this.nodes.reduce((row, n) => Math.max(row, n.y + n.h), 0);
    }
    beginUpdate(node) {
      if (!node._updating) {
        node._updating = true;
        delete node._skipDown;
        if (!this.batchMode)
          this.saveInitial();
      }
      return this;
    }
    endUpdate() {
      const n = this.nodes.find((n2) => n2._updating);
      if (n) {
        delete n._updating;
        delete n._skipDown;
      }
      return this;
    }
    /** saves a copy of the largest column layout (eg 12 even when rendering 1 column) so we don't loose orig layout, unless explicity column
     * count to use is given. returning a list of widgets for serialization
     * @param saveElement if true (default), the element will be saved to GridStackWidget.el field, else it will be removed.
     * @param saveCB callback for each node -> widget, so application can insert additional data to be saved into the widget data structure.
     * @param column if provided, the grid will be saved for the given column count (IFF we have matching internal saved layout, or current layout).
     * Note: nested grids will ALWAYS save the container w to match overall layouts (parent + child) to be consistent.
    */
    save(saveElement = true, saveCB, column) {
      const len = this._layouts?.length || 0;
      let layout;
      if (len) {
        if (column) {
          if (column !== this.column)
            layout = this._layouts[column];
        } else if (this.column !== len - 1) {
          layout = this._layouts[len - 1];
        }
      }
      const list = [];
      this.sortNodes();
      this.nodes.forEach((n) => {
        const wl = layout?.find((l) => l._id === n._id);
        const w = { ...n, ...wl || {} };
        Utils.removeInternalForSave(w, !saveElement);
        if (saveCB)
          saveCB(n, w);
        list.push(w);
      });
      return list;
    }
    /** @internal called whenever a node is added or moved - updates the cached layouts */
    layoutsNodesChange(nodes) {
      if (!this._layouts || this._inColumnResize)
        return this;
      this._layouts.forEach((layout, column) => {
        if (!layout || column === this.column)
          return;
        if (column < this.column) {
          this._layouts[column] = void 0;
        } else {
          const ratio = column / this.column;
          nodes.forEach((node) => {
            if (!node._orig)
              return;
            const n = layout.find((l) => l._id === node._id);
            if (!n)
              return;
            if (n.y >= 0 && node.y !== node._orig.y) {
              n.y = n.y + (node.y - node._orig.y);
              if (n.y < 0)
                n.y = 0;
            }
            if (node.x !== node._orig.x) {
              n.x = Math.round(node.x * ratio);
              if (n.x < 0)
                n.x = 0;
            }
            if (node.w !== node._orig.w) {
              n.w = Math.round(node.w * ratio);
              if (n.w < 1)
                n.w = 1;
            }
          });
        }
      });
      return this;
    }
    /**
     * @internal Called to scale the widget width & position up/down based on the column change.
     * Note we store previous layouts (especially original ones) to make it possible to go
     * from say 12 -> 1 -> 12 and get back to where we were.
     *
     * @param prevColumn previous number of columns
     * @param column  new column number
     * @param layout specify the type of re-layout that will happen (position, size, etc...).
     * Note: items will never be outside of the current column boundaries. default (moveScale). Ignored for 1 column
     */
    columnChanged(prevColumn, column, layout = "moveScale") {
      if (!this.nodes.length || !column || prevColumn === column)
        return this;
      const doCompact = layout === "compact" || layout === "list";
      if (doCompact) {
        this.sortNodes(1);
      }
      if (column < prevColumn)
        this.cacheLayout(this.nodes, prevColumn);
      this.batchUpdate();
      let newNodes = [];
      let nodes = doCompact ? this.nodes : Utils.sort(this.nodes, -1);
      if (column > prevColumn && this._layouts) {
        const cacheNodes = this._layouts[column] || [];
        const lastIndex = this._layouts.length - 1;
        if (!cacheNodes.length && prevColumn !== lastIndex && this._layouts[lastIndex]?.length) {
          prevColumn = lastIndex;
          this._layouts[lastIndex].forEach((cacheNode) => {
            const n = nodes.find((n2) => n2._id === cacheNode._id);
            if (n) {
              if (!doCompact && !cacheNode.autoPosition) {
                n.x = cacheNode.x ?? n.x;
                n.y = cacheNode.y ?? n.y;
              }
              n.w = cacheNode.w ?? n.w;
              if (cacheNode.x == void 0 || cacheNode.y === void 0)
                n.autoPosition = true;
            }
          });
        }
        cacheNodes.forEach((cacheNode) => {
          const j = nodes.findIndex((n) => n._id === cacheNode._id);
          if (j !== -1) {
            const n = nodes[j];
            if (doCompact) {
              n.w = cacheNode.w;
              return;
            }
            if (cacheNode.autoPosition || isNaN(cacheNode.x) || isNaN(cacheNode.y)) {
              this.findEmptyPosition(cacheNode, newNodes);
            }
            if (!cacheNode.autoPosition) {
              n.x = cacheNode.x ?? n.x;
              n.y = cacheNode.y ?? n.y;
              n.w = cacheNode.w ?? n.w;
              newNodes.push(n);
            }
            nodes.splice(j, 1);
          }
        });
      }
      if (doCompact) {
        this.compact(layout, false);
      } else {
        if (nodes.length) {
          if (typeof layout === "function") {
            layout(column, prevColumn, newNodes, nodes);
          } else {
            const ratio = doCompact || layout === "none" ? 1 : column / prevColumn;
            const move = layout === "move" || layout === "moveScale";
            const scale = layout === "scale" || layout === "moveScale";
            nodes.forEach((node) => {
              node.x = column === 1 ? 0 : move ? Math.round(node.x * ratio) : Math.min(node.x, column - 1);
              node.w = column === 1 || prevColumn === 1 ? 1 : scale ? Math.round(node.w * ratio) || 1 : Math.min(node.w, column);
              newNodes.push(node);
            });
            nodes = [];
          }
        }
        newNodes = Utils.sort(newNodes, -1);
        this._inColumnResize = true;
        this.nodes = [];
        newNodes.forEach((node) => {
          this.addNode(node, false);
          delete node._orig;
        });
      }
      this.nodes.forEach((n) => delete n._orig);
      this.batchUpdate(false, !doCompact);
      delete this._inColumnResize;
      return this;
    }
    /**
     * call to cache the given layout internally to the given location so we can restore back when column changes size
     * @param nodes list of nodes
     * @param column corresponding column index to save it under
     * @param clear if true, will force other caches to be removed (default false)
     */
    cacheLayout(nodes, column, clear = false) {
      const copy = [];
      nodes.forEach((n, i) => {
        if (n._id === void 0) {
          const existing = n.id ? this.nodes.find((n2) => n2.id === n.id) : void 0;
          n._id = existing?._id ?? _GridStackEngine._idSeq++;
        }
        copy[i] = { x: n.x, y: n.y, w: n.w, _id: n._id };
      });
      this._layouts = clear ? [] : this._layouts || [];
      this._layouts[column] = copy;
      return this;
    }
    /**
     * call to cache the given node layout internally to the given location so we can restore back when column changes size
     * @param node single node to cache
     * @param column corresponding column index to save it under
     */
    cacheOneLayout(n, column) {
      n._id = n._id ?? _GridStackEngine._idSeq++;
      const l = { x: n.x, y: n.y, w: n.w, _id: n._id };
      if (n.autoPosition || n.x === void 0) {
        delete l.x;
        delete l.y;
        if (n.autoPosition)
          l.autoPosition = true;
      }
      this._layouts = this._layouts || [];
      this._layouts[column] = this._layouts[column] || [];
      const index = this.findCacheLayout(n, column);
      if (index === -1)
        this._layouts[column].push(l);
      else
        this._layouts[column][index] = l;
      return this;
    }
    findCacheLayout(n, column) {
      return this._layouts?.[column]?.findIndex((l) => l._id === n._id) ?? -1;
    }
    removeNodeFromLayoutCache(n) {
      if (!this._layouts) {
        return;
      }
      for (let i = 0; i < this._layouts.length; i++) {
        const index = this.findCacheLayout(n, i);
        if (index !== -1) {
          this._layouts[i].splice(index, 1);
        }
      }
    }
    /** called to remove all internal values but the _id */
    cleanupNode(node) {
      const nd = node;
      for (const prop in nd) {
        if (prop[0] === "_" && prop !== "_id")
          delete nd[prop];
      }
      return this;
    }
  };
  GridStackEngine._idSeq = 0;

  // dsh-runtime/node_modules/gridstack/dist/types.js
  var gridDefaults = {
    alwaysShowResizeHandle: "mobile",
    animate: true,
    auto: true,
    cellHeight: "auto",
    cellHeightThrottle: 100,
    cellHeightUnit: "px",
    column: 12,
    draggable: { handle: ".grid-stack-item-content", appendTo: "body", scroll: true },
    handle: ".grid-stack-item-content",
    itemClass: "grid-stack-item",
    margin: 10,
    marginUnit: "px",
    maxRow: 0,
    minRow: 0,
    placeholderClass: "grid-stack-placeholder",
    placeholderText: "",
    removableOptions: { accept: "grid-stack-item", decline: "grid-stack-non-removable" },
    resizable: { handles: "se" },
    rtl: "auto"
    // **** same as not being set ****
    // disableDrag: false,
    // disableResize: false,
    // float: false,
    // handleClass: null,
    // removable: false,
    // staticGrid: false,
    //removable
  };

  // dsh-runtime/node_modules/gridstack/dist/dd-manager.js
  var DDManager = class {
  };

  // dsh-runtime/node_modules/gridstack/dist/dd-touch.js
  var isTouch = typeof window !== "undefined" && typeof document !== "undefined" && ("ontouchstart" in document || "ontouchstart" in window || window.DocumentTouch && document instanceof window.DocumentTouch || navigator.maxTouchPoints > 0 && window.matchMedia("(any-pointer: coarse)").matches || navigator.msMaxTouchPoints > 0);
  var DDTouch = class {
  };
  function simulateMouseEvent(e, simulatedType) {
    if (e.touches.length > 1)
      return;
    if (e.cancelable)
      e.preventDefault();
    Utils.simulateMouseEvent(e.changedTouches[0], simulatedType);
  }
  function simulatePointerMouseEvent(e, simulatedType) {
    if (e.cancelable)
      e.preventDefault();
    Utils.simulateMouseEvent(e, simulatedType);
  }
  function touchstart(e) {
    if (DDTouch.touchHandled)
      return;
    DDTouch.touchHandled = true;
    simulateMouseEvent(e, "mousedown");
  }
  function touchmove(e) {
    if (!DDTouch.touchHandled)
      return;
    simulateMouseEvent(e, "mousemove");
  }
  function touchend(e) {
    if (!DDTouch.touchHandled)
      return;
    if (DDTouch.pointerLeaveTimeout) {
      window.clearTimeout(DDTouch.pointerLeaveTimeout);
      delete DDTouch.pointerLeaveTimeout;
    }
    const wasDragging = !!DDManager.dragElement;
    simulateMouseEvent(e, "mouseup");
    if (!wasDragging) {
      simulateMouseEvent(e, "click");
    }
    DDTouch.touchHandled = false;
  }
  function pointerdown(e) {
    if (e.pointerType === "mouse")
      return;
    e.target.releasePointerCapture(e.pointerId);
  }
  function pointerenter(e) {
    if (!DDManager.dragElement) {
      return;
    }
    if (e.pointerType === "mouse")
      return;
    simulatePointerMouseEvent(e, "mouseenter");
  }
  function pointerleave(e) {
    if (!DDManager.dragElement) {
      return;
    }
    if (e.pointerType === "mouse")
      return;
    DDTouch.pointerLeaveTimeout = window.setTimeout(() => {
      delete DDTouch.pointerLeaveTimeout;
      simulatePointerMouseEvent(e, "mouseleave");
    }, 10);
  }

  // dsh-runtime/node_modules/gridstack/dist/dd-resizable-handle.js
  var DDResizableHandle = class _DDResizableHandle {
    constructor(host, dir, option) {
      this.host = host;
      this.dir = dir;
      this.option = option;
      this._mouseDown = this._mouseDown.bind(this);
      this._mouseMove = this._mouseMove.bind(this);
      this._mouseUp = this._mouseUp.bind(this);
      this._keyEvent = this._keyEvent.bind(this);
      this._init();
    }
    /** @internal */
    _init() {
      if (this.option.element) {
        try {
          this.el = this.option.element instanceof HTMLElement ? this.option.element : this.host.querySelector(this.option.element);
        } catch (error) {
          this.option.element = void 0;
          console.error("Query for resizeable handle failed, falling back", error);
        }
      }
      if (!this.el) {
        this.el = document.createElement("div");
        this.host.appendChild(this.el);
      }
      this.el.classList.add("ui-resizable-handle");
      this.el.classList.add(`${_DDResizableHandle.prefix}${this.dir}`);
      this.el.addEventListener("mousedown", this._mouseDown);
      if (isTouch) {
        this.el.addEventListener("touchstart", touchstart);
        this.el.addEventListener("pointerdown", pointerdown);
      }
      return this;
    }
    /** call this when resize handle needs to be removed and cleaned up */
    destroy() {
      if (this.mouseDownEvent)
        this._mouseUp(this.mouseDownEvent);
      this.el.removeEventListener("mousedown", this._mouseDown);
      if (isTouch) {
        this.el.removeEventListener("touchstart", touchstart);
        this.el.removeEventListener("pointerdown", pointerdown);
      }
      if (!this.option.element) {
        this.host.removeChild(this.el);
      }
      return this;
    }
    /** @internal called on mouse down on us: capture move on the entire document (mouse might not stay on us) until we release the mouse */
    _mouseDown(e) {
      this.mouseDownEvent = e;
      document.addEventListener("mousemove", this._mouseMove, { capture: true, passive: true });
      document.addEventListener("mouseup", this._mouseUp, true);
      if (isTouch) {
        this.el.addEventListener("touchmove", touchmove);
        this.el.addEventListener("touchend", touchend);
      }
      e.stopPropagation();
      e.preventDefault();
    }
    /** @internal */
    _mouseMove(e) {
      const s = this.mouseDownEvent;
      if (this.moving) {
        this._triggerEvent("move", e);
      } else if (Math.abs(e.x - s.x) + Math.abs(e.y - s.y) > 2) {
        this.moving = true;
        this._triggerEvent("start", this.mouseDownEvent);
        this._triggerEvent("move", e);
        document.addEventListener("keydown", this._keyEvent);
      }
      e.stopPropagation();
    }
    /** @internal */
    _mouseUp(e) {
      if (this.moving) {
        this._triggerEvent("stop", e);
        document.removeEventListener("keydown", this._keyEvent);
      }
      document.removeEventListener("mousemove", this._mouseMove, true);
      document.removeEventListener("mouseup", this._mouseUp, true);
      if (isTouch) {
        this.el.removeEventListener("touchmove", touchmove);
        this.el.removeEventListener("touchend", touchend);
      }
      delete this.moving;
      delete this.mouseDownEvent;
      e.stopPropagation();
      e.preventDefault();
    }
    /** @internal call when keys are being pressed - use Esc to cancel */
    _keyEvent(e) {
      if (e.key === "Escape") {
        this.host.gridstackNode?.grid?.engine.restoreInitial();
        this._mouseUp(this.mouseDownEvent);
      }
    }
    /** @internal */
    _triggerEvent(name, event) {
      const opt = this.option;
      if (opt[name])
        opt[name](event);
      return this;
    }
  };
  DDResizableHandle.prefix = "ui-resizable-";

  // dsh-runtime/node_modules/gridstack/dist/dd-base-impl.js
  var DDBaseImplement = class {
    constructor() {
      this._eventRegister = {};
    }
    /**
     * Returns the current disabled state (undefined if not set yet).
     * Note: Use enable()/disable() methods to change state as other operations need to happen.
     */
    get disabled() {
      return this._disabled;
    }
    /**
     * Register an event callback for the specified event.
     *
     * @param event - Event name to listen for
     * @param callback - Function to call when event occurs
     */
    on(event, callback) {
      this._eventRegister[event] = callback;
    }
    /**
     * Unregister an event callback for the specified event.
     *
     * @param event - Event name to stop listening for
     */
    off(event) {
      delete this._eventRegister[event];
    }
    /**
     * Enable this drag & drop implementation.
     * Subclasses should override to perform additional setup.
     */
    enable() {
      this._disabled = false;
    }
    /**
     * Disable this drag & drop implementation.
     * Subclasses should override to perform additional cleanup.
     */
    disable() {
      this._disabled = true;
    }
    /**
     * Destroy this drag & drop implementation and clean up resources.
     * Removes all event handlers and clears internal state.
     */
    destroy() {
      this._eventRegister = {};
    }
    /**
     * Trigger a registered event callback if one exists and the implementation is enabled.
     *
     * @param eventName - Name of the event to trigger
     * @param event - DOM event object to pass to the callback
     * @returns Result from the callback function, if any
     */
    triggerEvent(eventName, event) {
      if (!this.disabled && this._eventRegister[eventName])
        return this._eventRegister[eventName](event);
    }
  };

  // dsh-runtime/node_modules/gridstack/dist/dd-resizable.js
  var DDResizable = class _DDResizable extends DDBaseImplement {
    // have to be public else complains for HTMLElementExtendOpt ?
    constructor(el, option = {}) {
      super();
      this.el = el;
      this.option = option;
      this.rectScale = { x: 1, y: 1 };
      this._ui = () => {
        const containmentEl = this.el.parentElement;
        const containmentRect = containmentEl.getBoundingClientRect();
        const newRect = {
          width: this.originalRect.width,
          height: this.originalRect.height + this.scrolled,
          left: this.originalRect.left,
          right: this.originalRect.right,
          top: this.originalRect.top - this.scrolled
        };
        const rect = this.temporalRect || newRect;
        const leftPos = this.option.rtl ? (containmentRect.right - rect.right) * this.rectScale.x : (rect.left - containmentRect.left) * this.rectScale.x;
        return {
          position: {
            left: leftPos,
            top: (rect.top - containmentRect.top) * this.rectScale.y
          },
          size: {
            width: rect.width * this.rectScale.x,
            height: rect.height * this.rectScale.y
          }
          /* Gridstack ONLY needs position set above... keep around in case.
          element: [this.el], // The object representing the element to be resized
          helper: [], // TODO: not support yet - The object representing the helper that's being resized
          originalElement: [this.el],// we don't wrap here, so simplify as this.el //The object representing the original element before it is wrapped
          originalPosition: { // The position represented as { left, top } before the resizable is resized
            left: this.originalRect.left - containmentRect.left,
            top: this.originalRect.top - containmentRect.top
          },
          originalSize: { // The size represented as { width, height } before the resizable is resized
            width: this.originalRect.width,
            height: this.originalRect.height
          }
          */
        };
      };
      this._mouseOver = this._mouseOver.bind(this);
      this._mouseOut = this._mouseOut.bind(this);
      this.enable();
      this._setupAutoHide(!!this.option.autoHide);
      this._setupHandlers();
    }
    on(event, callback) {
      super.on(event, callback);
    }
    off(event) {
      super.off(event);
    }
    enable() {
      super.enable();
      this.el.classList.remove("ui-resizable-disabled");
      this._setupAutoHide(!!this.option.autoHide);
    }
    disable() {
      super.disable();
      this.el.classList.add("ui-resizable-disabled");
      this._setupAutoHide(false);
    }
    destroy() {
      this._removeHandlers();
      this._setupAutoHide(false);
      delete this.el;
      super.destroy();
    }
    updateOption(opts) {
      const updateHandles = opts.handles && opts.handles !== this.option.handles;
      const updateAutoHide = opts.autoHide && opts.autoHide !== this.option.autoHide;
      Object.assign(this.option, opts);
      if (updateHandles) {
        this._removeHandlers();
        this._setupHandlers();
      }
      if (updateAutoHide) {
        this._setupAutoHide(!!this.option.autoHide);
      }
      return this;
    }
    /** @internal turns auto hide on/off */
    _setupAutoHide(auto) {
      if (auto) {
        this.el.classList.add("ui-resizable-autohide");
        this.el.addEventListener("mouseover", this._mouseOver);
        this.el.addEventListener("mouseout", this._mouseOut);
      } else {
        this.el.classList.remove("ui-resizable-autohide");
        this.el.removeEventListener("mouseover", this._mouseOver);
        this.el.removeEventListener("mouseout", this._mouseOut);
        if (DDManager.overResizeElement === this) {
          delete DDManager.overResizeElement;
        }
      }
      return this;
    }
    /** @internal */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _mouseOver(e) {
      if (DDManager.overResizeElement || DDManager.dragElement)
        return;
      DDManager.overResizeElement = this;
      this.el.classList.remove("ui-resizable-autohide");
    }
    /** @internal */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _mouseOut(e) {
      if (DDManager.overResizeElement !== this)
        return;
      delete DDManager.overResizeElement;
      this.el.classList.add("ui-resizable-autohide");
    }
    /** @internal */
    _setupHandlers() {
      this.handlers = (this.option.handles ?? "se").split(",").map((dir) => dir.trim()).map((dir) => new DDResizableHandle(this.el, dir, {
        element: this.option.element,
        start: (event) => this._resizeStart(event),
        stop: (event) => this._resizeStop(event),
        move: (event) => this._resizing(event, dir)
      }));
      return this;
    }
    /** @internal */
    _resizeStart(event) {
      this.sizeToContent = Utils.shouldSizeToContent(this.el.gridstackNode, true);
      this.originalRect = this.el.getBoundingClientRect();
      this.scrollEl = Utils.getScrollElement(this.el);
      this.scrollY = this.scrollEl.scrollTop;
      this.scrolled = 0;
      this.startEvent = event;
      this._setupHelper();
      this._applyChange();
      const ev = Utils.initEvent(event, { type: "resizestart", target: this.el });
      if (this.option.start) {
        this.option.start(ev, this._ui());
      }
      this.el.classList.add("ui-resizable-resizing");
      this.triggerEvent("resizestart", ev);
      return this;
    }
    /** @internal */
    _resizing(event, dir) {
      this.scrolled = this.scrollEl.scrollTop - this.scrollY;
      this.temporalRect = this._getChange(event, dir);
      this._applyChange();
      const ev = Utils.initEvent(event, { type: "resize", target: this.el });
      ev.resizeDir = dir;
      ev.hasMovedX = this.option.rtl ? dir.includes("e") : dir.includes("w");
      ev.hasMovedY = dir.includes("n");
      if (this.option.resize) {
        this.option.resize(ev, this._ui());
      }
      this.triggerEvent("resize", ev);
      return this;
    }
    /** @internal */
    _resizeStop(event) {
      const ev = Utils.initEvent(event, { type: "resizestop", target: this.el });
      this._cleanHelper();
      if (this.option.stop) {
        this.option.stop(ev);
      }
      this.el.classList.remove("ui-resizable-resizing");
      this.triggerEvent("resizestop", ev);
      delete this.startEvent;
      delete this.originalRect;
      delete this.temporalRect;
      delete this.scrollY;
      delete this.scrolled;
      return this;
    }
    /** @internal */
    _setupHelper() {
      this.elOriginStyleVal = _DDResizable._originStyleProp.map((prop) => this.el.style[prop]);
      const parentEl = this.el.parentElement;
      this.parentOriginStylePosition = parentEl.style.position;
      const dragTransform = Utils.getValuesFromTransformedElement(parentEl);
      this.rectScale = {
        x: dragTransform.xScale,
        y: dragTransform.yScale
      };
      if (getComputedStyle(parentEl).position.match(/static/)) {
        parentEl.style.position = "relative";
      }
      this.el.style.position = "absolute";
      this.el.style.opacity = "0.8";
      return this;
    }
    /** @internal */
    _cleanHelper() {
      _DDResizable._originStyleProp.forEach((prop, i) => {
        this.el.style[prop] = this.elOriginStyleVal[i] || null;
      });
      this.el.parentElement.style.position = this.parentOriginStylePosition || null;
      return this;
    }
    /** @internal */
    _getChange(event, dir) {
      const oEvent = this.startEvent;
      const newRect = {
        width: this.originalRect.width,
        height: this.originalRect.height + this.scrolled,
        left: this.originalRect.left,
        right: this.originalRect.right,
        top: this.originalRect.top - this.scrolled
      };
      const offsetX = event.clientX - oEvent.clientX;
      const offsetY = this.sizeToContent ? 0 : event.clientY - oEvent.clientY;
      let moveLeft = false;
      let moveUp = false;
      const isRtl = this.option.rtl;
      if (!isRtl && dir.indexOf("e") > -1) {
        newRect.width += offsetX;
      } else if (isRtl && dir.indexOf("w") > -1) {
        newRect.width -= offsetX;
      } else if (!isRtl && dir.indexOf("w") > -1) {
        newRect.width -= offsetX;
        newRect.left += offsetX;
        moveLeft = true;
      } else if (isRtl && dir.indexOf("e") > -1) {
        newRect.width += offsetX;
        newRect.right += offsetX;
        moveLeft = true;
      }
      if (dir.indexOf("s") > -1) {
        newRect.height += offsetY;
      } else if (dir.indexOf("n") > -1) {
        newRect.height -= offsetY;
        newRect.top += offsetY;
        moveUp = true;
      }
      const constrain = this._constrainSize(newRect.width, newRect.height, moveLeft, moveUp);
      if (Math.round(newRect.width) !== Math.round(constrain.width)) {
        if (!isRtl && dir.indexOf("w") > -1) {
          newRect.left += newRect.width - constrain.width;
        } else if (isRtl && dir.indexOf("e") > -1) {
          newRect.right -= newRect.width - constrain.width;
        }
        newRect.width = constrain.width;
      }
      if (Math.round(newRect.height) !== Math.round(constrain.height)) {
        if (dir.indexOf("n") > -1) {
          newRect.top += newRect.height - constrain.height;
        }
        newRect.height = constrain.height;
      }
      return newRect;
    }
    /** @internal constrain the size to the set min/max values */
    _constrainSize(oWidth, oHeight, moveLeft, moveUp) {
      const o = this.option;
      const maxWidth = (moveLeft ? o.maxWidthMoveLeft : o.maxWidth) || Number.MAX_SAFE_INTEGER;
      const minWidth = (o.minWidth ?? 0) / this.rectScale.x || oWidth;
      const maxHeight = (moveUp ? o.maxHeightMoveUp : o.maxHeight) || Number.MAX_SAFE_INTEGER;
      const minHeight = (o.minHeight ?? 0) / this.rectScale.y || oHeight;
      const width = Math.min(maxWidth, Math.max(minWidth, oWidth));
      const height = Math.min(maxHeight, Math.max(minHeight, oHeight));
      return { width, height };
    }
    /** @internal */
    _applyChange() {
      let containmentRect = { left: 0, right: 0, top: 0, width: 0, height: 0 };
      if (this.el.style.position === "absolute") {
        const containmentEl = this.el.parentElement;
        const { left, right, top } = containmentEl.getBoundingClientRect();
        containmentRect = { left, right, top, width: 0, height: 0 };
      }
      if (!this.temporalRect)
        return this;
      const cRect = containmentRect;
      Object.entries(this.temporalRect).forEach(([key, value]) => {
        if (this.option.rtl ? key === "left" : key === "right")
          return;
        const scaleReciprocal = key === "width" || key === "left" || key === "right" ? this.rectScale.x : key === "height" || key === "top" ? this.rectScale.y : 1;
        let finalValue;
        if (key === "right") {
          finalValue = (containmentRect.right - value) * this.rectScale.x + "px";
        } else {
          finalValue = (value - cRect[key]) * scaleReciprocal + "px";
        }
        this.el.style[key] = finalValue;
      });
      return this;
    }
    /** @internal */
    _removeHandlers() {
      this.handlers.forEach((handle) => handle.destroy());
      delete this.handlers;
      return this;
    }
  };
  DDResizable._originStyleProp = ["width", "height", "position", "left", "right", "top", "opacity", "zIndex"];

  // dsh-runtime/node_modules/gridstack/dist/dd-draggable.js
  var skipMouseDown = 'input,textarea,button,select,option,[contenteditable="true"],.ui-resizable-handle';
  var DDDraggable = class _DDDraggable extends DDBaseImplement {
    constructor(el, option = {}) {
      super();
      this.el = el;
      this.option = option;
      this.dragTransform = {
        xScale: 1,
        yScale: 1,
        xOffset: 0,
        yOffset: 0
      };
      this._autoScrollTick = () => {
        const el2 = this.helper;
        const scrollCont = this._autoScrollContainer;
        if (!el2 || !scrollCont) {
          this._stopScrolling();
          return;
        }
        const clipping = this._getClipping(el2, scrollCont);
        if (clipping === 0) {
          this._stopScrolling();
          return;
        }
        if (!this._autoScrollMaxSpeed) {
          const viewportH = window.innerHeight || document.documentElement.clientHeight;
          this._autoScrollMaxSpeed = Math.max(viewportH / 150, 4);
        }
        const absPx = Math.abs(clipping);
        const speed = Math.min(absPx * 0.5, this._autoScrollMaxSpeed);
        const scrollAmount = clipping > 0 ? speed : -speed;
        const prevScroll = scrollCont.scrollTop;
        scrollCont.scrollTop += scrollAmount;
        if (scrollCont.scrollTop === prevScroll) {
          this._stopScrolling();
          return;
        }
        if (this.dragging && this.lastDrag) {
          this._dragFollow(this.lastDrag);
          this._callDrag(this.lastDrag);
        }
        this._autoScrollAnimId = requestAnimationFrame(this._autoScrollTick);
      };
      const handleName = option?.handle?.substring(1);
      const n = el.gridstackNode;
      this.dragEls = !handleName || el.classList.contains(handleName) ? [el] : n?.subGrid ? [el.querySelector(option.handle) || el] : this.getAllHandles();
      if (this.dragEls.length === 0) {
        this.dragEls = [el];
      }
      this._mouseDown = this._mouseDown.bind(this);
      this._mouseMove = this._mouseMove.bind(this);
      this._mouseUp = this._mouseUp.bind(this);
      this._keyEvent = this._keyEvent.bind(this);
      this.enable();
    }
    /** return all handles omitting other nested `.grid-stack-item` children (in case node.subGrid isn't set for some reason) */
    getAllHandles() {
      return Array.from(this.el.querySelectorAll(this.option.handle)).filter((node) => {
        if (!(node instanceof HTMLElement))
          return false;
        const owner = node.closest(".grid-stack-item");
        return owner === this.el || !owner;
      });
    }
    on(event, callback) {
      super.on(event, callback);
    }
    off(event) {
      super.off(event);
    }
    enable() {
      if (this.disabled === false)
        return;
      super.enable();
      this.dragEls.forEach((dragEl) => {
        dragEl.addEventListener("mousedown", this._mouseDown);
        if (isTouch) {
          dragEl.addEventListener("touchstart", touchstart);
          dragEl.addEventListener("pointerdown", pointerdown);
        }
      });
      this.el.classList.remove("ui-draggable-disabled");
    }
    disable(forDestroy = false) {
      if (this.disabled === true)
        return;
      super.disable();
      this.dragEls.forEach((dragEl) => {
        dragEl.removeEventListener("mousedown", this._mouseDown);
        if (isTouch) {
          dragEl.removeEventListener("touchstart", touchstart);
          dragEl.removeEventListener("pointerdown", pointerdown);
        }
      });
      if (!forDestroy)
        this.el.classList.add("ui-draggable-disabled");
    }
    destroy() {
      if (this.dragTimeout)
        window.clearTimeout(this.dragTimeout);
      delete this.dragTimeout;
      if (this.mouseDownEvent)
        this._mouseUp(this.mouseDownEvent);
      this.disable(true);
      delete this.el;
      delete this.option;
      super.destroy();
    }
    updateOption(opts) {
      Object.assign(this.option, opts);
      return this;
    }
    /**
     * Re-scans the item element for drag-handle elements after delayed content (React portal,
     * Angular component, etc.) has been rendered into the item.  Removes listeners from the
     * previous handle set, re-queries, then re-attaches.
     * Not needed for the default `.grid-stack-item-content` handle which is always present.
     */
    refreshHandles() {
      const wasDisabled = this.disabled;
      if (!wasDisabled)
        this.disable(true);
      const handleName = this.option?.handle?.substring(1);
      const n = this.el.gridstackNode;
      this.dragEls = !handleName || this.el.classList.contains(handleName) ? [this.el] : n?.subGrid ? [this.el.querySelector(this.option.handle) || this.el] : this.getAllHandles();
      if (this.dragEls.length === 0)
        this.dragEls = [this.el];
      if (!wasDisabled)
        this.enable();
    }
    /** @internal call when mouse goes down before a dragstart happens */
    _mouseDown(e) {
      if (e.isTrusted) {
        if (DDTouch.touchHandled)
          DDTouch.touchHandled = false;
        if (DDManager.mouseHandled && e.timeStamp !== DDManager.mouseHandledTimeStamp)
          delete DDManager.mouseHandled;
      }
      if (DDManager.mouseHandled)
        return true;
      if (e.button !== 0)
        return true;
      if (!this.dragEls.find((el) => el === e.target) && e.target.closest(skipMouseDown))
        return true;
      if (this.option.cancel) {
        if (e.target.closest(this.option.cancel))
          return true;
      }
      this.mouseDownEvent = e;
      delete this.dragging;
      delete DDManager.dragElement;
      delete DDManager.dropElement;
      delete this._autoScrollMaxSpeed;
      delete this._autoScrollContainer;
      document.addEventListener("mousemove", this._mouseMove, { capture: true, passive: true });
      document.addEventListener("mouseup", this._mouseUp, true);
      if (isTouch && e.currentTarget) {
        e.currentTarget.addEventListener("touchmove", touchmove);
        e.currentTarget.addEventListener("touchend", touchend);
      }
      e.preventDefault();
      if (document.activeElement)
        document.activeElement.blur();
      DDManager.mouseHandled = true;
      DDManager.mouseHandledTimeStamp = e.timeStamp;
      return true;
    }
    /** @internal method to call actual drag event */
    _callDrag(e) {
      if (!this.dragging)
        return;
      const ev = Utils.initEvent(e, { target: this.el, type: "drag" });
      if (this.option.drag) {
        this.option.drag(ev, this.ui());
      }
      this.triggerEvent("drag", ev);
    }
    /** @internal called when the main page (after successful mousedown) receives a move event to drag the item around the screen */
    _mouseMove(e) {
      const s = this.mouseDownEvent;
      this.lastDrag = e;
      if (this.dragging) {
        this._dragFollow(e);
        if (DDManager.pauseDrag) {
          const pause = Number.isInteger(DDManager.pauseDrag) ? DDManager.pauseDrag : 100;
          if (this.dragTimeout)
            window.clearTimeout(this.dragTimeout);
          this.dragTimeout = window.setTimeout(() => this._callDrag(e), pause);
        } else {
          this._callDrag(e);
        }
      } else if (Math.abs(e.x - s.x) + Math.abs(e.y - s.y) > 3) {
        this.dragging = true;
        DDManager.dragElement = this;
        const grid = this.el.gridstackNode?.grid;
        if (grid) {
          DDManager.dropElement = grid.el.ddElement?.ddDroppable;
        } else {
          delete DDManager.dropElement;
        }
        this.helper = this._createHelper();
        this._setupHelperContainmentStyle();
        this.dragTransform = Utils.getValuesFromTransformedElement(this.helperContainment);
        this.dragOffset = this._getDragOffset(e, this.el, this.helperContainment);
        this._setupHelperStyle(e);
        const ev = Utils.initEvent(e, { target: this.el, type: "dragstart" });
        if (this.option.start) {
          this.option.start(ev, this.ui());
        }
        this.triggerEvent("dragstart", ev);
        document.addEventListener("keydown", this._keyEvent);
      }
      return true;
    }
    /** @internal call when the mouse gets released to drop the item at current location */
    _mouseUp(e) {
      this._stopScrolling();
      document.removeEventListener("mousemove", this._mouseMove, true);
      document.removeEventListener("mouseup", this._mouseUp, true);
      if (isTouch && e.currentTarget) {
        e.currentTarget.removeEventListener("touchmove", touchmove, true);
        e.currentTarget.removeEventListener("touchend", touchend, true);
      }
      if (this.dragging) {
        delete this.dragging;
        delete this.el.gridstackNode?._origRotate;
        document.removeEventListener("keydown", this._keyEvent);
        if (DDManager.dropElement?.el === this.el.parentElement) {
          delete DDManager.dropElement;
        }
        this.helperContainment.style.position = this.parentOriginStylePosition || null;
        if (this.helper && this.helper !== this.el)
          this.helper.remove();
        this._removeHelperStyle();
        const ev = Utils.initEvent(e, { target: this.el, type: "dragstop" });
        if (this.option.stop) {
          this.option.stop(ev);
        }
        this.triggerEvent("dragstop", ev);
        if (DDManager.dropElement) {
          DDManager.dropElement.drop(e);
        }
      }
      delete this.helper;
      delete this.mouseDownEvent;
      delete DDManager.dragElement;
      delete DDManager.dropElement;
      delete DDManager.mouseHandled;
      delete DDManager.mouseHandledTimeStamp;
      e.preventDefault();
    }
    /** @internal call when keys are being pressed - use Esc to cancel, R to rotate */
    _keyEvent(e) {
      const n = this.el.gridstackNode;
      const grid = n?.grid || DDManager.dropElement?.el?.gridstack;
      if (e.key === "Escape") {
        if (n && n._origRotate) {
          n._orig = n._origRotate;
          delete n._origRotate;
        }
        grid?.cancelDrag();
        this._mouseUp(this.mouseDownEvent);
      } else if (n && grid && (e.key === "r" || e.key === "R")) {
        if (!Utils.canBeRotated(n))
          return;
        n._origRotate = n._origRotate || { ...n._orig };
        delete n._moving;
        grid.setAnimation(false).rotate(n.el, {
          top: -this.dragOffset.offsetTop,
          left: -this.dragOffset.offsetX
        }).setAnimation();
        n._moving = true;
        this.dragOffset = this._getDragOffset(this.lastDrag, n.el, this.helperContainment);
        this.helper.style.width = this.dragOffset.width + "px";
        this.helper.style.height = this.dragOffset.height + "px";
        Utils.swap(n._orig, "w", "h");
        delete n._rect;
        this._mouseMove(this.lastDrag);
      }
    }
    /** @internal create a clone copy (or user defined method) of the original drag item if set */
    _createHelper() {
      let helper = this.el;
      if (typeof this.option.helper === "function") {
        helper = this.option.helper(this.el);
      } else if (this.option.helper === "clone") {
        helper = Utils.cloneNode(this.el);
      }
      if (!helper.parentElement) {
        Utils.appendTo(helper, this.option.appendTo === "parent" ? this.el.parentElement : this.option.appendTo ?? "body");
      }
      this.dragElementOriginStyle = _DDDraggable.originStyleProp.map((prop) => this.el.style[prop]);
      return helper;
    }
    /** @internal set the fix position of the dragged item */
    _setupHelperStyle(e) {
      this.helper.classList.add("ui-draggable-dragging");
      this.el.gridstackNode?.grid?.el.classList.add("grid-stack-dragging");
      const style = this.helper.style;
      style.pointerEvents = "none";
      style.width = this.dragOffset.width + "px";
      style.height = this.dragOffset.height + "px";
      style.willChange = "left, right, top";
      style.position = "fixed";
      this._dragFollow(e);
      style.transition = "none";
      setTimeout(() => {
        if (this.helper) {
          style.transition = null;
        }
      }, 0);
      return this;
    }
    /** @internal restore back the original style before dragging */
    _removeHelperStyle() {
      this.helper.classList.remove("ui-draggable-dragging");
      (this.el._gridstackNodeOrig || this.el.gridstackNode)?.grid?.el.classList.remove("grid-stack-dragging");
      const node = this.helper?.gridstackNode;
      if (!node?._isAboutToRemove && this.dragElementOriginStyle) {
        const helper = this.helper;
        const originStyle = this.dragElementOriginStyle;
        const idxOf = _DDDraggable.originStyleProp.indexOf("transition");
        const transition = originStyle[idxOf] || null;
        helper.style.transition = originStyle[idxOf] = "none";
        const hStyle = helper.style;
        _DDDraggable.originStyleProp.forEach((prop, i) => hStyle[prop] = originStyle[i] || null);
        setTimeout(() => helper.style.transition = transition || "", 50);
      }
      delete this.dragElementOriginStyle;
      return this;
    }
    /** @internal updates the top/left position to follow the mouse */
    _dragFollow(e) {
      const style = this.helper.style;
      const offset = this.dragOffset;
      if (this.option.rtl) {
        style.right = (window.innerWidth - e.clientX + offset.offsetX) * this.dragTransform.xScale + "px";
        if (style.left)
          style.left = "";
      } else {
        style.left = (e.clientX + offset.offsetX) * this.dragTransform.xScale + "px";
        if (style.right)
          style.right = "";
      }
      style.top = (e.clientY + offset.offsetTop) * this.dragTransform.yScale + "px";
    }
    /** @internal */
    _setupHelperContainmentStyle() {
      this.helperContainment = this.helper.parentElement;
      if (this.helper.style.position !== "fixed") {
        this.parentOriginStylePosition = this.helperContainment.style.position;
        if (getComputedStyle(this.helperContainment).position.match(/static/)) {
          this.helperContainment.style.position = "relative";
        }
      }
      return this;
    }
    /** @internal */
    _getDragOffset(event, el, parent) {
      let xformOffsetX = 0;
      let xformOffsetY = 0;
      if (parent) {
        xformOffsetX = this.dragTransform.xOffset;
        xformOffsetY = this.dragTransform.yOffset;
      }
      const targetOffset = el.getBoundingClientRect();
      let x = this.option.rtl ? targetOffset.right : targetOffset.left;
      let offsetX = this.option.rtl ? event.clientX - targetOffset.right + xformOffsetX : -event.clientX + targetOffset.left - xformOffsetX;
      return {
        x,
        top: targetOffset.top,
        offsetX,
        offsetTop: -event.clientY + targetOffset.top - xformOffsetY,
        width: targetOffset.width * this.dragTransform.xScale,
        height: targetOffset.height * this.dragTransform.yScale
      };
    }
    /** @internal starts or continues auto-scroll when the dragged helper is clipped by the scroll container.
     * Takes the grid's own element to find the scroll container so external/sidebar drags work too (#2074). */
    updateScrollPosition(gridEl) {
      this._autoScrollContainer = Utils.getScrollElement(gridEl);
      const clipping = this._getClipping(this.helper, this._autoScrollContainer);
      if (clipping === 0) {
        this._stopScrolling();
      } else if (!this._autoScrollAnimId) {
        this._autoScrollAnimId = requestAnimationFrame(this._autoScrollTick);
      }
    }
    /** @internal compute how many pixels the element is clipped: negative = above, positive = below, 0 = fully inside OR outside (stop scrolling) */
    _getClipping(el, scrollEl) {
      const elRect = el.getBoundingClientRect();
      const scrollRect = scrollEl.getBoundingClientRect();
      const viewportH = window.innerHeight || document.documentElement.clientHeight;
      if (elRect.bottom < scrollRect.top || elRect.top > scrollRect.bottom)
        return 0;
      const clippedBelow = elRect.bottom - Math.min(scrollRect.bottom, viewportH);
      const clippedAbove = elRect.top - Math.max(scrollRect.top, 0);
      if (clippedAbove < 0)
        return clippedAbove;
      if (clippedBelow > 0)
        return clippedBelow;
      return 0;
    }
    /** @internal stop any active auto-scroll animation */
    _stopScrolling() {
      if (this._autoScrollAnimId) {
        cancelAnimationFrame(this._autoScrollAnimId);
        delete this._autoScrollAnimId;
      }
    }
    /** @internal TODO: set to public as called by DDDroppable! */
    ui() {
      const containmentEl = this.el.parentElement;
      const containmentRect = containmentEl.getBoundingClientRect();
      const offset = this.helper.getBoundingClientRect();
      const leftPos = this.option.rtl ? (containmentRect.right - offset.right) * this.dragTransform.xScale : (offset.left - containmentRect.left) * this.dragTransform.xScale;
      return {
        position: {
          top: (offset.top - containmentRect.top) * this.dragTransform.yScale,
          left: leftPos
        }
        /* not used by GridStack for now...
        helper: [this.helper], //The object arr representing the helper that's being dragged.
        offset: { top: offset.top, left: offset.left } // Current offset position of the helper as { top, left } object.
        */
      };
    }
  };
  DDDraggable.originStyleProp = ["width", "height", "transform", "transform-origin", "transition", "pointerEvents", "position", "left", "right", "top", "minWidth", "willChange"];

  // dsh-runtime/node_modules/gridstack/dist/dd-droppable.js
  var DDDroppable = class extends DDBaseImplement {
    constructor(el, option = {}) {
      super();
      this.el = el;
      this.option = option;
      this._mouseEnter = this._mouseEnter.bind(this);
      this._mouseLeave = this._mouseLeave.bind(this);
      this.eventEl = this.el.closest(".grid-stack-item") || this.el;
      this.enable();
      this._setupAccept();
    }
    on(event, callback) {
      super.on(event, callback);
    }
    off(event) {
      super.off(event);
    }
    enable() {
      if (this.disabled === false)
        return;
      super.enable();
      this.el.classList.add("ui-droppable");
      this.el.classList.remove("ui-droppable-disabled");
      this.eventEl.addEventListener("mouseenter", this._mouseEnter);
      this.eventEl.addEventListener("mouseleave", this._mouseLeave);
      if (isTouch) {
        this.eventEl.addEventListener("pointerenter", pointerenter);
        this.eventEl.addEventListener("pointerleave", pointerleave);
      }
    }
    disable(forDestroy = false) {
      if (this.disabled === true)
        return;
      super.disable();
      this.el.classList.remove("ui-droppable");
      if (!forDestroy)
        this.el.classList.add("ui-droppable-disabled");
      this.eventEl.removeEventListener("mouseenter", this._mouseEnter);
      this.eventEl.removeEventListener("mouseleave", this._mouseLeave);
      if (isTouch) {
        this.eventEl.removeEventListener("pointerenter", pointerenter);
        this.eventEl.removeEventListener("pointerleave", pointerleave);
      }
    }
    destroy() {
      this.disable(true);
      this.el.classList.remove("ui-droppable");
      this.el.classList.remove("ui-droppable-disabled");
      super.destroy();
    }
    updateOption(opts) {
      Object.assign(this.option, opts);
      this._setupAccept();
      return this;
    }
    /** @internal called when the cursor enters our area - prepare for a possible drop and track leaving */
    _mouseEnter(e) {
      if (!DDManager.dragElement)
        return;
      if (DDTouch.touchHandled && e.isTrusted)
        return;
      if (!this._canDrop(DDManager.dragElement.el))
        return;
      e.preventDefault();
      e.stopPropagation();
      DDManager.dragElement._stopScrolling();
      if (DDManager.dropElement && DDManager.dropElement !== this) {
        DDManager.dropElement._mouseLeave(e, true);
      }
      DDManager.dropElement = this;
      const ev = Utils.initEvent(e, { target: this.el, type: "dropover" });
      if (this.option.over) {
        this.option.over(ev, this._ui(DDManager.dragElement));
      }
      this.triggerEvent("dropover", ev);
      this.el.classList.add("ui-droppable-over");
    }
    /** @internal called when the item is leaving our area, stop tracking if we had moving item */
    _mouseLeave(e, calledByEnter = false) {
      if (!DDManager.dragElement || DDManager.dropElement !== this)
        return;
      e.preventDefault();
      e.stopPropagation();
      if (calledByEnter)
        DDManager.dragElement._stopScrolling();
      const ev = Utils.initEvent(e, { target: this.el, type: "dropout" });
      if (this.option.out) {
        this.option.out(ev, this._ui(DDManager.dragElement));
      }
      this.triggerEvent("dropout", ev);
      if (DDManager.dropElement === this) {
        delete DDManager.dropElement;
        if (!calledByEnter) {
          let parentDrop;
          let parent = this.el.parentElement;
          while (!parentDrop && parent) {
            parentDrop = parent.ddElement?.ddDroppable;
            parent = parent.parentElement;
          }
          if (parentDrop) {
            parentDrop._mouseEnter(e);
          }
        }
      }
    }
    /** item is being dropped on us - called by the drag mouseup handler - this calls the client drop event */
    drop(e) {
      e.preventDefault();
      const ev = Utils.initEvent(e, { target: this.el, type: "drop" });
      if (this.option.drop) {
        this.option.drop(ev, this._ui(DDManager.dragElement));
      }
      this.triggerEvent("drop", ev);
    }
    /** @internal true if element matches the string/method accept option */
    _canDrop(el) {
      return el && (!this.accept || this.accept(el));
    }
    /** @internal */
    _setupAccept() {
      if (!this.option.accept)
        return this;
      if (typeof this.option.accept === "string") {
        this.accept = (el) => el.classList.contains(this.option.accept) || el.matches(this.option.accept);
      } else {
        this.accept = this.option.accept;
      }
      return this;
    }
    /** @internal */
    _ui(drag) {
      return {
        draggable: drag.el,
        ...drag.ui()
      };
    }
  };

  // dsh-runtime/node_modules/gridstack/dist/dd-element.js
  var DDElement = class _DDElement {
    static init(el) {
      if (!el.ddElement) {
        el.ddElement = new _DDElement(el);
      }
      return el.ddElement;
    }
    constructor(el) {
      this.el = el;
    }
    on(eventName, callback) {
      if (this.ddDraggable && ["drag", "dragstart", "dragstop"].indexOf(eventName) > -1) {
        this.ddDraggable.on(eventName, callback);
      } else if (this.ddDroppable && ["drop", "dropover", "dropout"].indexOf(eventName) > -1) {
        this.ddDroppable.on(eventName, callback);
      } else if (this.ddResizable && ["resizestart", "resize", "resizestop"].indexOf(eventName) > -1) {
        this.ddResizable.on(eventName, callback);
      }
      return this;
    }
    off(eventName) {
      if (this.ddDraggable && ["drag", "dragstart", "dragstop"].indexOf(eventName) > -1) {
        this.ddDraggable.off(eventName);
      } else if (this.ddDroppable && ["drop", "dropover", "dropout"].indexOf(eventName) > -1) {
        this.ddDroppable.off(eventName);
      } else if (this.ddResizable && ["resizestart", "resize", "resizestop"].indexOf(eventName) > -1) {
        this.ddResizable.off(eventName);
      }
      return this;
    }
    setupDraggable(opts) {
      if (!this.ddDraggable) {
        this.ddDraggable = new DDDraggable(this.el, opts);
      } else {
        this.ddDraggable.updateOption(opts);
      }
      return this;
    }
    cleanDraggable() {
      if (this.ddDraggable) {
        this.ddDraggable.destroy();
        delete this.ddDraggable;
      }
      return this;
    }
    setupResizable(opts) {
      if (!this.ddResizable) {
        this.ddResizable = new DDResizable(this.el, opts);
      } else {
        this.ddResizable.updateOption(opts);
      }
      return this;
    }
    cleanResizable() {
      if (this.ddResizable) {
        this.ddResizable.destroy();
        delete this.ddResizable;
      }
      return this;
    }
    setupDroppable(opts) {
      if (!this.ddDroppable) {
        this.ddDroppable = new DDDroppable(this.el, opts);
      } else {
        this.ddDroppable.updateOption(opts);
      }
      return this;
    }
    cleanDroppable() {
      if (this.ddDroppable) {
        this.ddDroppable.destroy();
        delete this.ddDroppable;
      }
      return this;
    }
  };

  // dsh-runtime/node_modules/gridstack/dist/dd-gridstack.js
  var DDGridStack = class {
    /**
     * Enable/disable/configure resizing for grid elements.
     *
     * @param el - Grid item element(s) to configure
     * @param opts - Resize options or command ('enable', 'disable', 'destroy', 'option', or config object)
     * @param key - Option key when using 'option' command
     * @param value - Option value when using 'option' command
     * @returns this instance for chaining
     *
     * @example
     * dd.resizable(element, 'enable');  // Enable resizing
     * dd.resizable(element, 'option', 'minWidth', 100);  // Set minimum width
     */
    resizable(el, opts, key, value) {
      this._getDDElements(el, typeof opts === "string" ? opts : void 0).forEach((dEl) => {
        if (opts === "disable" || opts === "enable") {
          dEl.ddResizable && dEl.ddResizable[opts]();
        } else if (opts === "destroy") {
          dEl.ddResizable && dEl.cleanResizable();
        } else if (opts === "option") {
          dEl.setupResizable({ [key]: value });
        } else {
          const n = dEl.el.gridstackNode;
          const grid = n.grid;
          let handles = dEl.el.getAttribute("gs-resize-handles") || grid.opts.resizable.handles || "e,s,se";
          if (handles === "all")
            handles = "n,e,s,w,se,sw,ne,nw";
          const autoHide = !grid.opts.alwaysShowResizeHandle;
          const resOpts = opts;
          dEl.setupResizable({
            ...grid.opts.resizable,
            ...{ handles, autoHide },
            ...{
              start: resOpts.start,
              stop: resOpts.stop,
              resize: resOpts.resize,
              rtl: resOpts.rtl
            }
          });
        }
      });
      return this;
    }
    /**
     * Enable/disable/configure dragging for grid elements.
     *
     * @param el - Grid item element(s) to configure
     * @param opts - Drag options or command ('enable', 'disable', 'destroy', 'option', or config object)
     * @param key - Option key when using 'option' command
     * @param value - Option value when using 'option' command
     * @param rtl - Are we in rtl mode?
     * @returns this instance for chaining
     *
     * @example
     * dd.draggable(element, 'enable');  // Enable dragging
     * dd.draggable(element, {handle: '.drag-handle'});  // Configure drag handle
     */
    draggable(el, opts, key, value) {
      this._getDDElements(el, typeof opts === "string" ? opts : void 0).forEach((dEl) => {
        if (opts === "disable" || opts === "enable") {
          dEl.ddDraggable && dEl.ddDraggable[opts]();
        } else if (opts === "destroy") {
          dEl.ddDraggable && dEl.cleanDraggable();
        } else if (opts === "option") {
          dEl.setupDraggable({ [key]: value });
        } else {
          const grid = dEl.el.gridstackNode.grid;
          const dragOpts = opts;
          dEl.setupDraggable({
            ...grid.opts.draggable,
            ...{
              // containment: (grid.parentGridNode && grid.opts.dragOut === false) ? grid.el.parentElement : (grid.opts.draggable.containment || null),
              start: dragOpts.start,
              stop: dragOpts.stop,
              drag: dragOpts.drag,
              rtl: dragOpts.rtl
            }
          });
        }
      });
      return this;
    }
    dragIn(el, opts) {
      this._getDDElements(el).forEach((dEl) => dEl.setupDraggable(opts));
      return this;
    }
    droppable(el, opts, key, value) {
      if (typeof opts !== "string") {
        const o = opts;
        if (typeof o.accept === "function" && !o._accept) {
          o._accept = o.accept;
          o.accept = (el2) => o._accept(el2);
        }
      }
      const ddOpts = typeof opts === "string" ? opts : void 0;
      this._getDDElements(el, ddOpts).forEach((dEl) => {
        if (opts === "disable" || opts === "enable") {
          dEl.ddDroppable && dEl.ddDroppable[opts]();
        } else if (opts === "destroy") {
          dEl.ddDroppable && dEl.cleanDroppable();
        } else if (opts === "option") {
          dEl.setupDroppable({ [key]: value });
        } else {
          dEl.setupDroppable(opts);
        }
      });
      return this;
    }
    /** true if element is droppable */
    isDroppable(el) {
      return !!(el?.ddElement?.ddDroppable && !el.ddElement.ddDroppable.disabled);
    }
    /** true if element is draggable */
    isDraggable(el) {
      return !!(el?.ddElement?.ddDraggable && !el.ddElement.ddDraggable.disabled);
    }
    /** true if element is draggable */
    isResizable(el) {
      return !!(el?.ddElement?.ddResizable && !el.ddElement.ddResizable.disabled);
    }
    on(el, name, callback) {
      this._getDDElements(el).forEach((dEl) => dEl.on(name, (event) => {
        callback(event, DDManager.dragElement ? DDManager.dragElement.el : event.target, DDManager.dragElement ? DDManager.dragElement.helper : void 0);
      }));
      return this;
    }
    off(el, name) {
      this._getDDElements(el).forEach((dEl) => dEl.off(name));
      return this;
    }
    /** @internal returns a list of DD elements, creating them on the fly by default unless option is to destroy or disable */
    _getDDElements(els, opts) {
      const create = els.gridstack || opts !== "destroy" && opts !== "disable";
      const hosts = Utils.getElements(els);
      if (!hosts.length)
        return [];
      const list = hosts.map((e) => e.ddElement || (create ? DDElement.init(e) : null)).filter((d) => !!d);
      return list;
    }
  };

  // dsh-runtime/node_modules/gridstack/dist/gridstack.js
  var dd = new DDGridStack();
  var GridStack = class _GridStack {
    /**
     * initializing the HTML element, or selector string, into a grid will return the grid. Calling it again will
     * simply return the existing instance (ignore any passed options). There is also an initAll() version that support
     * multiple grids initialization at once. Or you can use addGrid() to create the entire grid from JSON.
     * @param options grid options (optional)
     * @param elOrString element or CSS selector (first one used) to convert to a grid (default to '.grid-stack' class selector)
     *
     * @example
     * const grid = GridStack.init();
     *
     * Note: the HTMLElement (of type GridHTMLElement) will store a `gridstack: GridStack` value that can be retrieve later
     * const grid = document.querySelector('.grid-stack').gridstack;
     */
    static init(options = {}, elOrString = ".grid-stack") {
      if (typeof document === "undefined")
        return null;
      const el = _GridStack.getGridElement(elOrString);
      if (!el) {
        if (typeof elOrString === "string") {
          console.error('GridStack.initAll() no grid was found with selector "' + elOrString + '" - element missing or wrong selector ?\nNote: ".grid-stack" is required for proper CSS styling and drag/drop, and is the default selector.');
        } else {
          console.error("GridStack.init() no grid element was passed.");
        }
        return null;
      }
      if (!el.gridstack) {
        el.gridstack = new _GridStack(el, Utils.cloneDeep(options));
      }
      return el.gridstack;
    }
    /**
     * Will initialize a list of elements (given a selector) and return an array of grids.
     * @param options grid options (optional)
     * @param selector elements selector to convert to grids (default to '.grid-stack' class selector)
     *
     * @example
     * const grids = GridStack.initAll();
     * grids.forEach(...)
     */
    static initAll(options = {}, selector = ".grid-stack") {
      const grids = [];
      if (typeof document === "undefined")
        return grids;
      _GridStack.getGridElements(selector).forEach((el) => {
        if (!el.gridstack) {
          el.gridstack = new _GridStack(el, Utils.cloneDeep(options));
        }
        grids.push(el.gridstack);
      });
      if (grids.length === 0) {
        console.error('GridStack.initAll() no grid was found with selector "' + selector + '" - element missing or wrong selector ?\nNote: ".grid-stack" is required for proper CSS styling and drag/drop, and is the default selector.');
      }
      return grids;
    }
    /**
     * call to create a grid with the given options, including loading any children from JSON structure. This will call GridStack.init(), then
     * grid.load() on any passed children (recursively). Great alternative to calling init() if you want entire grid to come from
     * JSON serialized data, including options.
     * @param parent HTML element parent to the grid
     * @param opt grids options used to initialize the grid, and list of children
     */
    static addGrid(parent, opt = {}) {
      if (!parent)
        return null;
      let el = parent;
      if (el.gridstack) {
        const grid2 = el.gridstack;
        if (opt)
          grid2.opts = { ...grid2.opts, ...opt };
        if (opt.children !== void 0)
          grid2.load(opt.children);
        return grid2;
      }
      const parentIsGrid = parent.classList.contains("grid-stack");
      if (!parentIsGrid || _GridStack.addRemoveCB) {
        if (_GridStack.addRemoveCB) {
          el = _GridStack.addRemoveCB(parent, opt, true, true);
        } else {
          el = Utils.createDiv(["grid-stack", opt.class], parent);
        }
      }
      const grid = _GridStack.init(opt, el);
      return grid;
    }
    /** call this method to register your engine instead of the default one.
     * See instead `GridStackOptions.engineClass` if you only need to
     * replace just one instance.
     */
    static registerEngine(engineClass) {
      _GridStack.engineClass = engineClass;
    }
    /**
     * @internal create placeholder DIV as needed
     * @returns the placeholder element for indicating drop zones during drag operations
     */
    get placeholder() {
      if (!this._placeholder) {
        this._placeholder = Utils.createDiv([this.opts.placeholderClass, gridDefaults.itemClass, this.opts.itemClass]);
        const placeholderChild = Utils.createDiv(["placeholder-content"], this._placeholder);
        if (this.opts.placeholderText) {
          placeholderChild.textContent = this.opts.placeholderText;
        }
      }
      return this._placeholder;
    }
    /**
     * Construct a grid item from the given element and options
     * @param el the HTML element tied to this grid after it's been initialized
     * @param opts grid options - public for classes to access, but use methods to modify!
     */
    constructor(el, opts = {}) {
      this.el = el;
      this.opts = opts;
      this.animationDelay = 300 + 10;
      this._gsEventHandler = {};
      this._extraDragRow = 0;
      this.dragTransform = { xScale: 1, yScale: 1, xOffset: 0, yOffset: 0 };
      el.gridstack = this;
      this.opts = opts = opts || {};
      if (!el.classList.contains("grid-stack")) {
        this.el.classList.add("grid-stack");
      }
      if (opts.row) {
        opts.minRow = opts.maxRow = opts.row;
        delete opts.row;
      }
      const rowAttr = Utils.toNumber(el.getAttribute("gs-row"));
      if (opts.column === "auto") {
        delete opts.column;
      }
      if (opts.alwaysShowResizeHandle !== void 0) {
        opts._alwaysShowResizeHandle = opts.alwaysShowResizeHandle;
      }
      const resp = opts.columnOpts;
      if (resp) {
        const bk = resp.breakpoints;
        if (!resp.columnWidth && !bk?.length) {
          delete opts.columnOpts;
        } else {
          if (bk && bk.length > 1) {
            bk.sort((a, b) => (b.w || 0) - (a.w || 0));
            delete resp.columnWidth;
          } else {
            resp.columnMax = resp.columnMax || 12;
          }
        }
      }
      const defaults = {
        ...Utils.cloneDeep(gridDefaults),
        column: Utils.toNumber(el.getAttribute("gs-column")) || gridDefaults.column,
        minRow: rowAttr ? rowAttr : Utils.toNumber(el.getAttribute("gs-min-row")) || gridDefaults.minRow,
        maxRow: rowAttr ? rowAttr : Utils.toNumber(el.getAttribute("gs-max-row")) || gridDefaults.maxRow,
        staticGrid: Utils.toBool(el.getAttribute("gs-static")) || gridDefaults.staticGrid,
        sizeToContent: Utils.toBool(el.getAttribute("gs-size-to-content")) || void 0,
        draggable: {
          handle: (opts.handleClass ? "." + opts.handleClass : opts.handle ? opts.handle : "") || gridDefaults.draggable.handle
        },
        removableOptions: {
          accept: opts.itemClass || gridDefaults.removableOptions.accept,
          decline: gridDefaults.removableOptions.decline
        }
      };
      if (el.getAttribute("gs-animate")) {
        defaults.animate = Utils.toBool(el.getAttribute("gs-animate"));
      }
      opts = Utils.defaults(opts, defaults);
      this._initMargin();
      this.checkDynamicColumn();
      this._updateColumnVar(opts);
      if (opts.rtl === "auto") {
        opts.rtl = el.style.direction === "rtl";
      }
      if (opts.rtl) {
        this.el.classList.add("grid-stack-rtl");
      }
      const parentGridItem = this.el.closest("." + gridDefaults.itemClass);
      const parentNode = parentGridItem?.gridstackNode;
      if (parentNode) {
        parentNode.subGrid = this;
        this.parentGridNode = parentNode;
        this.el.classList.add("grid-stack-nested");
        parentNode.el.classList.add("grid-stack-sub-grid");
      }
      this._isAutoCellHeight = opts.cellHeight === "auto";
      if (this._isAutoCellHeight || opts.cellHeight === "initial") {
        this.cellHeight(void 0);
      } else {
        if (typeof opts.cellHeight == "number" && opts.cellHeightUnit && opts.cellHeightUnit !== gridDefaults.cellHeightUnit) {
          opts.cellHeight = opts.cellHeight + opts.cellHeightUnit;
          delete opts.cellHeightUnit;
        }
        const val = opts.cellHeight;
        delete opts.cellHeight;
        this.cellHeight(val);
      }
      if (opts.alwaysShowResizeHandle === "mobile") {
        opts.alwaysShowResizeHandle = isTouch;
      }
      this._setStaticClass();
      const engineClass = opts.engineClass || _GridStack.engineClass || GridStackEngine;
      this.engine = new engineClass({
        column: this.getColumn(),
        float: opts.float,
        maxRow: opts.maxRow,
        onChange: (cbNodes) => {
          cbNodes.forEach((n) => {
            const el2 = n.el;
            if (!el2)
              return;
            if (n._removeDOM) {
              if (el2)
                el2.remove();
              delete n._removeDOM;
            } else {
              this._writePosAttr(el2, n);
            }
          });
          this._updateContainerHeight();
        }
      });
      if (opts.auto) {
        this.batchUpdate();
        this.engine._loading = true;
        this.getGridItems().forEach((el2) => this._prepareElement(el2));
        delete this.engine._loading;
        this.batchUpdate(false);
      }
      if (opts.children) {
        const children = opts.children;
        delete opts.children;
        if (children.length)
          this.load(children);
      }
      this.setAnimation();
      if (opts.subGridDynamic && !DDManager.pauseDrag)
        DDManager.pauseDrag = true;
      if (opts.draggable?.pause !== void 0)
        DDManager.pauseDrag = opts.draggable.pause;
      this._setupRemoveDrop();
      this._setupAcceptWidget();
      this._updateResizeEvent();
    }
    _updateColumnVar(opts = this.opts) {
      this.el.classList.add("gs-" + opts.column);
      if (typeof opts.column === "number") {
        this.el.style.setProperty("--gs-column-width", `${100 / opts.column}%`);
        this.el.style.setProperty("--gs-columns", String(opts.column));
      }
    }
    /**
     * add a new widget and returns it.
     *
     * Widget will be always placed even if result height is more than actual grid height.
     * You need to use `willItFit()` before calling addWidget for additional check.
     * See also `makeWidget(el)` for DOM element.
     *
     * @example
     * const grid = GridStack.init();
     * grid.addWidget({w: 3, content: 'hello'});
     *
     * @param w GridStackWidget definition. used MakeWidget(el) if you have dom element instead.
     */
    addWidget(w) {
      if (!w)
        return;
      if (typeof w === "string") {
        console.error("V11: GridStack.addWidget() does not support string anymore. see #2736");
        return;
      }
      if (w.ELEMENT_NODE) {
        console.error("V11: GridStack.addWidget() does not support HTMLElement anymore. use makeWidget()");
        return this.makeWidget(w);
      }
      let el;
      let node = w;
      node.grid = this;
      if (node.el) {
        el = node.el;
      } else if (_GridStack.addRemoveCB) {
        el = _GridStack.addRemoveCB(this.el, w, true, false);
      } else {
        el = this.createWidgetDivs(node);
      }
      if (!el)
        return;
      node = el.gridstackNode;
      if (node && el.parentElement === this.el && this.engine.nodes.find((n) => n._id === node._id))
        return el;
      const domAttr = this._readAttr(el);
      Utils.defaults(w, domAttr);
      this.engine.prepareNode(w);
      this.el.appendChild(el);
      this.makeWidget(el, w);
      return el;
    }
    /**
     * Create the default grid item divs and content (possibly lazy loaded) by using GridStack.renderCB().
     *
     * @param n GridStackNode definition containing widget configuration
     * @returns the created HTML element with proper grid item structure
     *
     * @example
     * const element = grid.createWidgetDivs({ w: 2, h: 1, content: 'Hello World' });
     */
    createWidgetDivs(n) {
      const el = Utils.createDiv(["grid-stack-item", this.opts.itemClass]);
      const cont = Utils.createDiv(["grid-stack-item-content"], el);
      if (Utils.lazyLoad(n)) {
        if (!n.visibleObservable) {
          n.visibleObservable = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
              n.visibleObservable?.disconnect();
              delete n.visibleObservable;
              _GridStack.renderCB(cont, n);
              n.grid?.prepareDragDrop(n.el);
            }
          });
          window.setTimeout(() => n.visibleObservable?.observe(el));
        }
      } else
        _GridStack.renderCB(cont, n);
      return el;
    }
    /**
     * Convert an existing gridItem element into a sub-grid with the given (optional) options, else inherit them
     * from the parent's subGrid options.
     * @param el gridItem element to convert
     * @param ops (optional) sub-grid options, else default to node, then parent settings, else defaults
     * @param nodeToAdd (optional) node to add to the newly created sub grid (used when dragging over existing regular item)
     * @param saveContent if true (default) the html inside .grid-stack-content will be saved to child widget
     * @returns newly created grid
     */
    makeSubGrid(el, ops, nodeToAdd, saveContent = true) {
      let node = el.gridstackNode;
      if (!node) {
        node = this.makeWidget(el).gridstackNode;
      }
      if (node.subGrid?.el)
        return node.subGrid;
      let subGridTemplate;
      let grid = this;
      while (grid && !subGridTemplate) {
        subGridTemplate = grid.opts?.subGridOpts;
        grid = grid.parentGridNode?.grid;
      }
      ops = Utils.cloneDeep({
        // by default sub-grid inherit from us | parent, other than id, children, etc...
        ...this.opts,
        id: void 0,
        children: void 0,
        column: "auto",
        columnOpts: void 0,
        layout: "list",
        subGridOpts: void 0,
        ...subGridTemplate || {},
        ...ops || node.subGridOpts || {}
      });
      node.subGridOpts = ops;
      let autoColumn = false;
      if (ops.column === "auto") {
        autoColumn = true;
        ops.column = Math.max(node.w || 1, nodeToAdd?.w || 1);
        delete ops.columnOpts;
      }
      let content = node.el.querySelector(".grid-stack-item-content");
      let newItem;
      let newItemOpt;
      if (saveContent) {
        this._removeDD(node.el);
        newItemOpt = { ...node, x: 0, y: 0 };
        Utils.removeInternalForSave(newItemOpt);
        delete newItemOpt.subGridOpts;
        if (node.content) {
          newItemOpt.content = node.content;
          delete node.content;
        }
        if (_GridStack.addRemoveCB) {
          newItem = _GridStack.addRemoveCB(this.el, newItemOpt, true, false) || void 0;
        } else {
          newItem = Utils.createDiv(["grid-stack-item"]);
          newItem.appendChild(content);
          content = Utils.createDiv(["grid-stack-item-content"], node.el);
        }
        this.prepareDragDrop(node.el);
      }
      if (nodeToAdd) {
        const w = autoColumn ? ops.column : node.w;
        const h2 = node.h + nodeToAdd.h;
        const style = node.el.style;
        style.transition = "none";
        this.update(node.el, { w, h: h2 });
        setTimeout(() => style.transition = "");
      }
      const subGrid = node.subGrid = _GridStack.addGrid(content, ops) || void 0;
      if (nodeToAdd?._moving)
        subGrid._isTemp = true;
      if (autoColumn)
        subGrid._autoColumn = true;
      if (saveContent) {
        subGrid.makeWidget(newItem, newItemOpt);
      }
      if (nodeToAdd) {
        if (nodeToAdd._moving) {
          window.setTimeout(() => Utils.simulateMouseEvent(nodeToAdd._event, "mouseenter", subGrid.el), 0);
        } else {
          subGrid.makeWidget(node.el, node);
        }
      }
      this.resizeToContentCheck(false, node);
      return subGrid;
    }
    /**
     * called when an item was converted into a nested grid to accommodate a dragged over item, but then item leaves - return back
     * to the original grid-item. Also called to remove empty sub-grids when last item is dragged out (since re-creating is simple)
     */
    removeAsSubGrid(nodeThatRemoved) {
      const pGrid = this.parentGridNode?.grid;
      if (!pGrid)
        return;
      pGrid.batchUpdate();
      pGrid.removeWidget(this.parentGridNode.el, true, true);
      this.engine.nodes.forEach((n) => {
        n.x = (n.x ?? 0) + (this.parentGridNode.x ?? 0);
        n.y = (n.y ?? 0) + (this.parentGridNode.y ?? 0);
        this._removeDD(n.el);
        n.el.remove();
        delete n.el.gridstackNode;
        pGrid.makeWidget(n.el, n);
      });
      pGrid.batchUpdate(false);
      if (this.parentGridNode)
        delete this.parentGridNode.subGrid;
      delete this.parentGridNode;
      if (nodeThatRemoved) {
        const origNode = nodeThatRemoved.el?.gridstackNode;
        if (origNode && origNode !== nodeThatRemoved)
          origNode._temporaryRemoved = true;
        window.setTimeout(() => {
          const dragEvent = DDManager.dragElement?.lastDrag || nodeThatRemoved._event;
          if (dragEvent)
            Utils.simulateMouseEvent(dragEvent, "mouseenter", pGrid.el);
        }, 0);
      }
    }
    /**
     * saves the current layout returning a list of widgets for serialization which might include any nested grids.
     * @param saveContent if true (default) the latest html inside .grid-stack-content will be saved to GridStackWidget.content field, else it will
     * be removed.
     * @param saveGridOpt if true (default false), save the grid options itself, so you can call the new GridStack.addGrid()
     * to recreate everything from scratch. GridStackOptions.children would then contain the widget list instead.
     * @param saveCB callback for each node -> widget, so application can insert additional data to be saved into the widget data structure.
     * @param column if provided, the grid will be saved for the given column size (IFF we have matching internal saved layout, or current layout).
     * Otherwise it will use the largest possible layout (say 12 even if rendering at 1 column) so we can restore to all layouts.
     * NOTE: if you want to save to currently display layout, pass this.getColumn() as column.
     * NOTE2: nested grids will ALWAYS save to the container size to be in sync with parent.
     * @returns list of widgets or full grid option, including .children list of widgets
     */
    save(saveContent = true, saveGridOpt = false, saveCB = _GridStack.saveCB, column) {
      const list = this.engine.save(saveContent, saveCB, column);
      list.forEach((n) => {
        if (saveContent && n.el && !n.subGrid && !saveCB) {
          const itemContent = n.el.querySelector(".grid-stack-item-content");
          n.content = itemContent?.innerHTML;
          if (!n.content)
            delete n.content;
        } else {
          if (!saveContent && !saveCB) {
            delete n.content;
          }
          if (n.subGrid?.el) {
            const column2 = n.w || n.subGrid.getColumn();
            const listOrOpt = n.subGrid.save(saveContent, saveGridOpt, saveCB, column2);
            n.subGridOpts = saveGridOpt ? listOrOpt : { children: listOrOpt };
            delete n.subGrid;
          }
        }
        delete n.el;
      });
      if (saveGridOpt) {
        const o = Utils.cloneDeep(this.opts);
        if (o.marginBottom === o.marginTop && o.marginRight === o.marginLeft && o.marginTop === o.marginRight) {
          o.margin = o.marginTop;
          delete o.marginTop;
          delete o.marginRight;
          delete o.marginBottom;
          delete o.marginLeft;
        }
        if (o.rtl === (this.el.style.direction === "rtl")) {
          o.rtl = "auto";
        }
        if (this._isAutoCellHeight) {
          o.cellHeight = "auto";
        }
        if (this._autoColumn) {
          o.column = "auto";
        }
        const origShow = o._alwaysShowResizeHandle;
        delete o._alwaysShowResizeHandle;
        if (origShow !== void 0) {
          o.alwaysShowResizeHandle = origShow;
        } else {
          delete o.alwaysShowResizeHandle;
        }
        Utils.removeInternalAndSame(o, gridDefaults);
        o.children = list;
        return o;
      }
      return list;
    }
    /**
     * Load widgets from a list. This will call update() on each (matching by id) or add/remove widgets that are not there.
     * Used to restore a grid layout for a saved layout list (see `save()`).
     *
     * @param items list of widgets definition to update/create
     * @param addRemove boolean (default true) or callback method can be passed to control if and how missing widgets can be added/removed, giving
     * the user control of insertion.
     * @returns the grid instance for chaining
     *
     * @example
     * // Basic usage with saved layout
     * const savedLayout = grid.save(); // Save current layout
     * // ... later restore it
     * grid.load(savedLayout);
     *
     * // Load with custom add/remove callback
     * grid.load(layout, (items, grid, add) => {
     *   if (add) {
     *     // Custom logic for adding new widgets
     *     items.forEach(item => {
     *       const el = document.createElement('div');
     *       el.innerHTML = item.content || '';
     *       grid.addWidget(el, item);
     *     });
     *   } else {
     *     // Custom logic for removing widgets
     *     items.forEach(item => grid.removeWidget(item.el));
     *   }
     * });
     *
     * // Load without adding/removing missing widgets
     * grid.load(layout, false);
     *
     * @see {@link http://gridstackjs.com/demo/serialization.html} for complete example
     */
    load(items, addRemove = _GridStack.addRemoveCB || true) {
      items.forEach((n) => {
        n.w = n.w || n.minW || 1;
        n.h = n.h || n.minH || 1;
      });
      items = Utils.sort(items);
      this.engine.skipCacheUpdate = this._ignoreLayoutsNodeChange = true;
      let maxColumn = 0;
      items.forEach((n) => {
        maxColumn = Math.max(maxColumn, (n.x || 0) + n.w);
      });
      if (maxColumn > this.engine.defaultColumn)
        this.engine.defaultColumn = maxColumn;
      const column = this.getColumn();
      if (maxColumn > column) {
        if (this.engine.nodes.length === 0 && this.responseLayout) {
          this.engine.nodes = items;
          this.engine.columnChanged(maxColumn, column, this.responseLayout);
          items = this.engine.nodes;
          this.engine.nodes = [];
          delete this.responseLayout;
        } else
          this.engine.cacheLayout(items, maxColumn, true);
      }
      const prevCB = _GridStack.addRemoveCB;
      if (typeof addRemove === "function")
        _GridStack.addRemoveCB = addRemove;
      const removed = [];
      this.batchUpdate();
      const blank = !this.engine.nodes.length;
      const noAnim = blank && this.opts.animate;
      if (noAnim)
        this.setAnimation(false);
      if (!blank && addRemove) {
        const copyNodes = [...this.engine.nodes];
        copyNodes.forEach((n) => {
          if (!n.id)
            return;
          const item = Utils.find(items, n.id);
          if (!item) {
            if (_GridStack.addRemoveCB)
              _GridStack.addRemoveCB(this.el, n, false, false);
            removed.push(n);
            this.removeWidget(n.el, true, false);
          }
        });
      }
      this.engine._loading = true;
      const updateNodes = [];
      this.engine.nodes = this.engine.nodes.filter((n) => {
        if (n.id && Utils.find(items, n.id)) {
          updateNodes.push(n);
          return false;
        }
        return true;
      });
      items.forEach((w) => {
        const item = w.id ? Utils.find(updateNodes, w.id) : void 0;
        if (item) {
          if (Utils.shouldSizeToContent(item))
            w.h = item.h;
          this.engine.nodeBoundFix(w);
          if (w.autoPosition || w.x === void 0 || w.y === void 0) {
            w.w = w.w || item.w;
            w.h = w.h || item.h;
            this.engine.findEmptyPosition(w);
          }
          this.engine.nodes.push(item);
          if (Utils.samePos(item, w) && this.engine.nodes.length > 1) {
            this.moveNode(item, { ...w, forceCollide: true });
            Utils.copyPos(w, item);
          }
          this.update(item.el, w);
          if (w.subGridOpts?.children) {
            const sub = item.el.querySelector(".grid-stack");
            if (sub && sub.gridstack) {
              sub.gridstack.load(w.subGridOpts.children);
            }
          }
        } else if (addRemove) {
          this.addWidget(w);
        }
      });
      delete this.engine._loading;
      this.engine.removedNodes = removed;
      this.batchUpdate(false);
      delete this._ignoreLayoutsNodeChange;
      delete this.engine.skipCacheUpdate;
      prevCB ? _GridStack.addRemoveCB = prevCB : delete _GridStack.addRemoveCB;
      if (noAnim)
        this.setAnimation(true, true);
      return this;
    }
    /**
     * use before calling a bunch of `addWidget()` to prevent un-necessary relayouts in between (more efficient)
     * and get a single event callback. You will see no changes until `batchUpdate(false)` is called.
     */
    batchUpdate(flag = true) {
      this.engine.batchUpdate(flag);
      if (!flag) {
        this._updateContainerHeight();
        this._triggerRemoveEvent();
        this._triggerAddEvent();
        this._triggerChangeEvent();
      }
      return this;
    }
    /**
     * Gets the current cell height in pixels. This takes into account the unit type and converts to pixels if necessary.
     *
     * @param forcePixel if true, forces conversion to pixels even when cellHeight is specified in other units
     * @returns the cell height in pixels
     *
     * @example
     * const height = grid.getCellHeight();
     * console.log('Cell height:', height, 'px');
     *
     * // Force pixel conversion
     * const pixelHeight = grid.getCellHeight(true);
     */
    getCellHeight(forcePixel = false) {
      if (this.opts.cellHeight && this.opts.cellHeight !== "auto" && (!forcePixel || !this.opts.cellHeightUnit || this.opts.cellHeightUnit === "px")) {
        return this.opts.cellHeight;
      }
      if (this.opts.cellHeightUnit === "rem") {
        return this.opts.cellHeight * parseFloat(getComputedStyle(document.documentElement).fontSize);
      }
      if (this.opts.cellHeightUnit === "em") {
        return this.opts.cellHeight * parseFloat(getComputedStyle(this.el).fontSize);
      }
      if (this.opts.cellHeightUnit === "cm") {
        return this.opts.cellHeight * (96 / 2.54);
      }
      if (this.opts.cellHeightUnit === "mm") {
        return this.opts.cellHeight * (96 / 2.54) / 10;
      }
      const el = this.el.querySelector("." + this.opts.itemClass);
      if (el) {
        const h2 = Utils.toNumber(el.getAttribute("gs-h")) || 1;
        return Math.round(el.offsetHeight / h2);
      }
      const rows = parseInt(this.el.getAttribute("gs-current-row") || "0");
      return rows ? Math.round(this.el.getBoundingClientRect().height / rows) : this.opts.cellHeight;
    }
    /**
     * Update current cell height - see `GridStackOptions.cellHeight` for format by updating eh Browser CSS variable.
     *
     * @param val the cell height. Options:
     *   - `undefined`: cells content will be made square (match width minus margin)
     *   - `0`: the CSS will be generated by the application instead
     *   - number: height in pixels
     *   - string: height with units (e.g., '70px', '5rem', '2em')
     * @returns the grid instance for chaining
     *
     * @example
     * grid.cellHeight(100);     // 100px height
     * grid.cellHeight('70px');  // explicit pixel height
     * grid.cellHeight('5rem');  // relative to root font size
     * grid.cellHeight(grid.cellWidth() * 1.2); // aspect ratio
     * grid.cellHeight('auto');  // auto-size based on content
     */
    cellHeight(val) {
      if (val !== void 0) {
        if (this._isAutoCellHeight !== (val === "auto")) {
          this._isAutoCellHeight = val === "auto";
          this._updateResizeEvent();
        }
      }
      if (val === "initial" || val === "auto") {
        val = void 0;
      }
      if (val === void 0) {
        const marginDiff = -this.opts.marginRight - this.opts.marginLeft + this.opts.marginTop + this.opts.marginBottom;
        val = this.cellWidth() + marginDiff;
      }
      const data = Utils.parseHeight(val);
      if (this.opts.cellHeightUnit === data.unit && this.opts.cellHeight === data.h) {
        return this;
      }
      this.opts.cellHeightUnit = data.unit;
      this.opts.cellHeight = data.h;
      this.el.style.setProperty("--gs-cell-height", `${this.opts.cellHeight}${this.opts.cellHeightUnit}`);
      this._updateContainerHeight();
      this.resizeToContentCheck();
      return this;
    }
    /** Gets current cell width. */
    /**
     * Gets the current cell width in pixels. This is calculated based on the grid container width divided by the number of columns.
     *
     * @returns the cell width in pixels
     *
     * @example
     * const width = grid.cellWidth();
     * console.log('Cell width:', width, 'px');
     *
     * // Use cell width to calculate widget dimensions
     * const widgetWidth = width * 3; // For a 3-column wide widget
     */
    cellWidth() {
      return this._widthOrContainer() / this.getColumn();
    }
    /** return our expected width (or parent) , and optionally of window for dynamic column check */
    _widthOrContainer(forBreakpoint = false) {
      return forBreakpoint && this.opts.columnOpts?.breakpointForWindow ? window.innerWidth : this.el.clientWidth || this.el.parentElement.clientWidth || window.innerWidth;
    }
    /** checks for dynamic column count for our current size, returning true if changed */
    checkDynamicColumn() {
      const resp = this.opts.columnOpts;
      if (!resp || !resp.columnWidth && !resp.breakpoints?.length)
        return false;
      const column = this.getColumn();
      let newColumn = column;
      const w = this._widthOrContainer(true);
      if (resp.columnWidth) {
        newColumn = Math.min(Math.round(w / resp.columnWidth) || 1, resp.columnMax);
      } else {
        newColumn = resp.columnMax;
        let i = 0;
        while (i < resp.breakpoints.length && w <= resp.breakpoints[i].w) {
          newColumn = resp.breakpoints[i++].c || column;
        }
      }
      if (newColumn !== column) {
        const bk = resp.breakpoints?.find((b) => b.c === newColumn);
        this.column(newColumn, bk?.layout || resp.layout);
        return true;
      }
      return false;
    }
    /**
     * Re-layout grid items to reclaim any empty space. This is useful after removing widgets
     * or when you want to optimize the layout.
     *
     * @param layout layout type. Options:
     *   - 'compact' (default): might re-order items to fill any empty space
     *   - 'list': keep the widget left->right order the same, even if that means leaving an empty slot if things don't fit
     * @param doSort re-sort items first based on x,y position. Set to false to do your own sorting ahead (default: true)
     * @returns the grid instance for chaining
     *
     * @example
     * // Compact layout after removing widgets
     * grid.removeWidget('.widget-to-remove');
     * grid.compact();
     *
     * // Use list layout (preserve order)
     * grid.compact('list');
     *
     * // Compact without sorting first
     * grid.compact('compact', false);
     */
    compact(layout = "compact", doSort = true) {
      this.engine.compact(layout, doSort);
      this._triggerChangeEvent();
      return this;
    }
    /**
     * Set the number of columns in the grid. Will update existing widgets to conform to new number of columns,
     * as well as cache the original layout so you can revert back to previous positions without loss.
     *
     * Requires `gridstack-extra.css` or `gridstack-extra.min.css` for [2-11] columns,
     * else you will need to generate correct CSS.
     * See: https://github.com/gridstack/gridstack.js#change-grid-columns
     *
     * @param column Integer > 0 (default 12)
     * @param layout specify the type of re-layout that will happen. Options:
     *   - 'moveScale' (default): scale widget positions and sizes
     *   - 'move': keep widget sizes, only move positions
     *   - 'scale': keep widget positions, only scale sizes
     *   - 'none': don't change widget positions or sizes
     *   Note: items will never be outside of the current column boundaries.
     *   Ignored for `column=1` as we always want to vertically stack.
     * @returns the grid instance for chaining
     *
     * @example
     * // Change to 6 columns with default scaling
     * grid.column(6);
     *
     * // Change to 4 columns, only move positions
     * grid.column(4, 'move');
     *
     * // Single column layout (vertical stack)
     * grid.column(1);
     */
    column(column, layout = "moveScale") {
      if (!column || column < 1 || this.opts.column === column)
        return this;
      const oldColumn = this.getColumn();
      this.opts.column = column;
      if (!this.engine) {
        this.responseLayout = layout;
        return this;
      }
      this.engine.column = column;
      this.el.classList.remove("gs-" + oldColumn);
      this._updateColumnVar();
      this.engine.columnChanged(oldColumn, column, layout);
      if (this._isAutoCellHeight)
        this.cellHeight();
      this.resizeToContentCheck(true);
      this._ignoreLayoutsNodeChange = true;
      this._triggerChangeEvent();
      delete this._ignoreLayoutsNodeChange;
      return this;
    }
    /**
     * Get the number of columns in the grid (default 12).
     *
     * @returns the current number of columns in the grid
     *
     * @example
     * const columnCount = grid.getColumn(); // returns 12 by default
     */
    getColumn() {
      return this.opts.column;
    }
    /**
     * Returns an array of grid HTML elements (no placeholder) - used to iterate through our children in DOM order.
     * This method excludes placeholder elements and returns only actual grid items.
     *
     * @returns array of GridItemHTMLElement instances representing all grid items
     *
     * @example
     * const items = grid.getGridItems();
     * items.forEach(item => {
     *   console.log('Item ID:', item.gridstackNode.id);
     * });
     */
    getGridItems() {
      return Array.from(this.el.children).filter((el) => el.matches("." + this.opts.itemClass) && !el.matches("." + this.opts.placeholderClass));
    }
    /**
     * Returns true if change callbacks should be ignored due to column change, sizeToContent, loading, etc.
     * This is useful for callers who want to implement dirty flag functionality.
     *
     * @returns true if change callbacks are currently being ignored
     *
     * @example
     * if (!grid.isIgnoreChangeCB()) {
     *   // Process the change event
     *   console.log('Grid layout changed');
     * }
     */
    isIgnoreChangeCB() {
      return !!this._ignoreLayoutsNodeChange;
    }
    /**
     * Destroys a grid instance. DO NOT CALL any methods or access any vars after this as it will free up members.
     * @param removeDOM if `false` grid and items HTML elements will not be removed from the DOM (Optional. Default `true`).
     */
    destroy(removeDOM = true) {
      if (!this.el)
        return this;
      this.offAll();
      this._updateResizeEvent(true);
      this.setStatic(true, false);
      this.setAnimation(false);
      if (!removeDOM) {
        this.removeAll(removeDOM);
        this.el.removeAttribute("gs-current-row");
      } else {
        this.el.parentNode.removeChild(this.el);
      }
      if (this.parentGridNode)
        delete this.parentGridNode.subGrid;
      delete this.parentGridNode;
      delete this.opts;
      delete this._placeholder?.gridstackNode;
      delete this._placeholder;
      delete this.engine;
      delete this.el.gridstack;
      delete this.el;
      return this;
    }
    /**
     * Enable/disable floating widgets (default: `false`). When enabled, widgets can float up to fill empty spaces.
     * See [example](http://gridstackjs.com/demo/float.html)
     *
     * @param val true to enable floating, false to disable
     * @returns the grid instance for chaining
     *
     * @example
     * grid.float(true);  // Enable floating
     * grid.float(false); // Disable floating (default)
     */
    float(val) {
      if (this.opts.float !== val) {
        this.opts.float = this.engine.float = val;
        this._triggerChangeEvent();
      }
      return this;
    }
    /**
     * Get the current float mode setting.
     *
     * @returns true if floating is enabled, false otherwise
     *
     * @example
     * const isFloating = grid.getFloat();
     * console.log('Floating enabled:', isFloating);
     */
    getFloat() {
      return this.engine.float;
    }
    /**
     * Get the position of the cell under a pixel on screen.
     * @param position the position of the pixel to resolve in
     * absolute coordinates, as an object with top and left properties
     * @param useDocRelative if true, value will be based on document position vs parent position (Optional. Default false).
     * Useful when grid is within `position: relative` element
     *
     * Returns an object with properties `x` and `y` i.e. the column and row in the grid.
     */
    getCellFromPixel(position, useDocRelative = false) {
      const box = this.el.getBoundingClientRect();
      let containerPos;
      if (useDocRelative) {
        containerPos = { top: box.top + document.documentElement.scrollTop, left: box.left };
      } else {
        containerPos = { top: this.el.offsetTop, left: this.el.offsetLeft };
      }
      const relativeLeft = position.left - containerPos.left;
      const relativeTop = position.top - containerPos.top;
      const columnWidth = box.width / this.getColumn();
      const rowHeight = box.height / parseInt(this.el.getAttribute("gs-current-row") || "0");
      return { x: Math.floor(relativeLeft / columnWidth), y: Math.floor(relativeTop / rowHeight) };
    }
    /**
     * Returns the current number of rows, which will be at least `minRow` if set.
     * The row count is based on the highest positioned widget in the grid.
     *
     * @returns the current number of rows in the grid
     *
     * @example
     * const rowCount = grid.getRow();
     * console.log('Grid has', rowCount, 'rows');
     */
    getRow() {
      return Math.max(this.engine.getRow(), this.opts.minRow || 0);
    }
    /**
     * Checks if the specified rectangular area is empty (no widgets occupy any part of it).
     *
     * @param x the x coordinate (column) of the area to check
     * @param y the y coordinate (row) of the area to check
     * @param w the width in columns of the area to check
     * @param h the height in rows of the area to check
     * @returns true if the area is completely empty, false if any widget overlaps
     *
     * @example
     * // Check if a 2x2 area at position (1,1) is empty
     * if (grid.isAreaEmpty(1, 1, 2, 2)) {
     *   console.log('Area is available for placement');
     * }
     */
    isAreaEmpty(x, y, w, h2) {
      return this.engine.isAreaEmpty(x, y, w, h2);
    }
    /**
     * If you add elements to your grid by hand (or have some framework creating DOM), you have to tell gridstack afterwards to make them widgets.
     * If you want gridstack to add the elements for you, use `addWidget()` instead.
     * Makes the given element a widget and returns it.
     *
     * @param els widget or single selector to convert.
     * @param options widget definition to use instead of reading attributes or using default sizing values
     * @returns the converted GridItemHTMLElement
     *
     * @example
     * const grid = GridStack.init();
     *
     * // Create HTML content manually, possibly looking like:
     * // <div id="item-1" gs-x="0" gs-y="0" gs-w="3" gs-h="2"></div>
     * grid.el.innerHTML = '<div id="item-1" gs-w="3"></div><div id="item-2"></div>';
     *
     * // Convert existing elements to widgets
     * grid.makeWidget('#item-1'); // Uses gs-* attributes from DOM
     * grid.makeWidget('#item-2', {w: 2, h: 1, content: 'Hello World'});
     *
     * // Or pass DOM element directly
     * const element = document.getElementById('item-3');
     * grid.makeWidget(element, {x: 0, y: 1, w: 4, h: 2});
     */
    makeWidget(els, options) {
      const el = _GridStack.getElement(els);
      if (!el || el.gridstackNode)
        return el;
      if (!el.parentElement)
        this.el.appendChild(el);
      this._prepareElement(el, true, options);
      const node = el.gridstackNode;
      this._updateContainerHeight();
      if (node.subGridOpts) {
        this.makeSubGrid(el, node.subGridOpts, void 0, false);
      }
      let resetIgnoreLayoutsNodeChange = false;
      if (this.opts.column === 1 && !this._ignoreLayoutsNodeChange) {
        resetIgnoreLayoutsNodeChange = this._ignoreLayoutsNodeChange = true;
      }
      this._triggerAddEvent();
      this._triggerChangeEvent();
      if (resetIgnoreLayoutsNodeChange)
        delete this._ignoreLayoutsNodeChange;
      return el;
    }
    on(name, callback) {
      if (name.indexOf(" ") !== -1) {
        const names = name.split(" ");
        names.forEach((name2) => this.on(name2, callback));
        return this;
      }
      if (name === "change" || name === "added" || name === "removed" || name === "enable" || name === "disable") {
        const noData = name === "enable" || name === "disable";
        if (noData) {
          this._gsEventHandler[name] = (event) => callback(event);
        } else {
          this._gsEventHandler[name] = ((event) => {
            if (event.detail)
              callback(event, event.detail);
          });
        }
        this.el.addEventListener(name, this._gsEventHandler[name]);
      } else if (name === "drag" || name === "dragstart" || name === "dragstop" || name === "resizestart" || name === "resize" || name === "resizestop" || name === "dropped" || name === "resizecontent") {
        this._gsEventHandler[name] = callback;
      } else {
        console.error("GridStack.on(" + name + ") event not supported");
      }
      return this;
    }
    /**
     * unsubscribe from the 'on' event GridStackEvent
     * @param name of the event (see possible values) or list of names space separated
     */
    off(name) {
      if (name.indexOf(" ") !== -1) {
        const names = name.split(" ");
        names.forEach((name2) => this.off(name2));
        return this;
      }
      if (name === "change" || name === "added" || name === "removed" || name === "enable" || name === "disable") {
        if (this._gsEventHandler[name]) {
          this.el.removeEventListener(name, this._gsEventHandler[name]);
        }
      }
      delete this._gsEventHandler[name];
      return this;
    }
    /**
     * Remove all event handlers from the grid. This is useful for cleanup when destroying a grid.
     *
     * @returns the grid instance for chaining
     *
     * @example
     * grid.offAll(); // Remove all event listeners
     */
    offAll() {
      Object.keys(this._gsEventHandler).forEach((key) => this.off(key));
      return this;
    }
    /**
     * Removes widget from the grid.
     * @param el  widget or selector to modify
     * @param removeDOM if `false` DOM element won't be removed from the tree (Default? true).
     * @param triggerEvent if `false` (quiet mode) element will not be added to removed list and no 'removed' callbacks will be called (Default? true).
     */
    removeWidget(els, removeDOM = true, triggerEvent = true) {
      if (!els) {
        console.error("Error: GridStack.removeWidget(undefined) called");
        return this;
      }
      _GridStack.getElements(els).forEach((el) => {
        if (el.parentElement && el.parentElement !== this.el)
          return;
        let node = el.gridstackNode;
        if (!node) {
          node = this.engine.nodes.find((n) => el === n.el);
        }
        if (!node)
          return;
        if (removeDOM && _GridStack.addRemoveCB) {
          _GridStack.addRemoveCB(this.el, node, false, false);
        }
        delete el.gridstackNode;
        this._removeDD(el);
        this.engine.removeNode(node, removeDOM, triggerEvent);
        if (removeDOM && el.parentElement) {
          el.remove();
        }
      });
      if (triggerEvent) {
        this._triggerRemoveEvent();
        this._triggerChangeEvent();
      }
      return this;
    }
    /**
     * Removes all widgets from the grid.
     * @param removeDOM if `false` DOM elements won't be removed from the tree (Default? `true`).
     * @param triggerEvent if `false` (quiet mode) element will not be added to removed list and no 'removed' callbacks will be called (Default? true).
     */
    removeAll(removeDOM = true, triggerEvent = true) {
      this.engine.nodes.forEach((n) => {
        if (removeDOM && _GridStack.addRemoveCB) {
          _GridStack.addRemoveCB(this.el, n, false, false);
        }
        delete n.el.gridstackNode;
        if (!this.opts.staticGrid)
          this._removeDD(n.el);
      });
      this.engine.removeAll(removeDOM, triggerEvent);
      if (triggerEvent)
        this._triggerRemoveEvent();
      return this;
    }
    /**
     * Toggle the grid animation state.  Toggles the `grid-stack-animate` class.
     * @param doAnimate if true the grid will animate.
     * @param delay if true setting will be set on next event loop.
     */
    setAnimation(doAnimate = this.opts.animate, delay) {
      if (delay) {
        setTimeout(() => {
          if (this.opts)
            this.setAnimation(doAnimate);
        });
      } else if (doAnimate) {
        this.el.classList.add("grid-stack-animate");
      } else {
        this.el.classList.remove("grid-stack-animate");
      }
      this.opts.animate = doAnimate;
      return this;
    }
    /** @internal */
    hasAnimationCSS() {
      return this.el.classList.contains("grid-stack-animate");
    }
    /**
     * Toggle the grid static state, which permanently removes/add Drag&Drop support, unlike disable()/enable() that just turns it off/on.
     * Also toggle the grid-stack-static class.
     * @param val if true the grid become static.
     * @param updateClass true (default) if css class gets updated
     * @param recurse true (default) if sub-grids also get updated
     */
    setStatic(val, updateClass = true, recurse = true) {
      if (!!this.opts.staticGrid === val)
        return this;
      val ? this.opts.staticGrid = true : delete this.opts.staticGrid;
      this._setupRemoveDrop();
      this._setupAcceptWidget();
      this.engine.nodes.forEach((n) => {
        this.prepareDragDrop(n.el);
        if (n.subGrid && recurse)
          n.subGrid.setStatic(val, updateClass, recurse);
      });
      if (updateClass) {
        this._setStaticClass();
      }
      return this;
    }
    /**
     * Updates the passed in options on the grid (similar to update(widget) for for the grid options).
     * @param options PARTIAL grid options to update - only items specified will be updated.
     * NOTE: not all options updating are currently supported (lot of code, unlikely to change)
     */
    updateOptions(o) {
      const opts = this.opts;
      if (o === opts)
        return this;
      if (o.acceptWidgets !== void 0) {
        opts.acceptWidgets = o.acceptWidgets;
        this._setupAcceptWidget();
      }
      if (o.animate !== void 0)
        this.setAnimation(o.animate);
      if (o.cellHeight)
        this.cellHeight(o.cellHeight);
      if (o.class !== void 0 && o.class !== opts.class) {
        if (opts.class)
          this.el.classList.remove(opts.class);
        if (o.class)
          this.el.classList.add(o.class);
      }
      if (o.columnOpts) {
        const hadColumnOpts = !!this.opts.columnOpts;
        this.opts.columnOpts = o.columnOpts;
        if (hadColumnOpts !== !!this.opts.columnOpts)
          this._updateResizeEvent();
        this.checkDynamicColumn();
      } else if (o.columnOpts === null && this.opts.columnOpts) {
        delete this.opts.columnOpts;
        this._updateResizeEvent();
      } else if (typeof o.column === "number")
        this.column(o.column);
      if (o.margin !== void 0)
        this.margin(o.margin);
      if (o.staticGrid !== void 0)
        this.setStatic(o.staticGrid);
      if (o.disableDrag !== void 0 && !o.staticGrid)
        this.enableMove(!o.disableDrag);
      if (o.disableResize !== void 0 && !o.staticGrid)
        this.enableResize(!o.disableResize);
      if (o.float !== void 0)
        this.float(o.float);
      if (o.row !== void 0) {
        opts.minRow = opts.maxRow = this.engine.maxRow = opts.row = o.row;
        this._updateContainerHeight();
        if (this.engine.getRow() > o.row)
          this.compact();
      } else {
        if (o.minRow !== void 0) {
          opts.minRow = o.minRow;
          this._updateContainerHeight();
        }
        if (o.maxRow !== void 0) {
          opts.maxRow = this.engine.maxRow = o.maxRow;
          if (this.engine.getRow() > o.maxRow)
            this.compact();
        }
      }
      if (o.lazyLoad !== void 0)
        opts.lazyLoad = o.lazyLoad;
      if (o.children?.length)
        this.load(o.children);
      return this;
    }
    /**
     * Updates widget position/size and other info. This is used to change widget properties after creation.
     * Can update position, size, content, and other widget properties.
     *
     * Note: If you need to call this on all nodes, use load() instead which will update what changed.
     * Setting the same x,y for multiple items will be indeterministic and likely unwanted.
     *
     * @param els widget element(s) or selector to modify
     * @param opt new widget options (x,y,w,h, etc.). Only those set will be updated.
     * @returns the grid instance for chaining
     *
     * @example
     * // Update widget size and position
     * grid.update('.my-widget', { x: 2, y: 1, w: 3, h: 2 });
     *
     * // Update widget content
     * grid.update(widget, { content: '<p>New content</p>' });
     *
     * // Update multiple properties
     * grid.update('#my-widget', {
     *   w: 4,
     *   h: 3,
     *   noResize: true,
     *   locked: true
     * });
     */
    update(els, opt) {
      _GridStack.getElements(els).forEach((el) => {
        const n = el?.gridstackNode;
        if (!n)
          return;
        const w = { ...Utils.copyPos({}, n), ...Utils.cloneDeep(opt) };
        this.engine.nodeBoundFix(w);
        delete w.autoPosition;
        const keys = ["x", "y", "w", "h"];
        let m;
        const wRec = w;
        const nRec = n;
        if (keys.some((k) => wRec[k] !== void 0 && wRec[k] !== nRec[k])) {
          m = {};
          const mRec = m;
          keys.forEach((k) => {
            mRec[k] = wRec[k] !== void 0 ? wRec[k] : nRec[k];
            delete wRec[k];
          });
        }
        if (!m && (w.minW || w.minH || w.maxW || w.maxH)) {
          m = {};
        }
        if (w.content !== void 0) {
          const itemContent = el.querySelector(".grid-stack-item-content");
          if (itemContent && itemContent.textContent !== w.content) {
            n.content = w.content;
            _GridStack.renderCB(itemContent, w);
            if (n.subGrid?.el) {
              itemContent.appendChild(n.subGrid.el);
              n.subGrid._updateContainerHeight();
            }
          }
          delete w.content;
        }
        let changed = false;
        let ddChanged = false;
        for (const key in wRec) {
          if (key[0] !== "_" && nRec[key] !== wRec[key]) {
            nRec[key] = wRec[key];
            changed = true;
            ddChanged = ddChanged || !this.opts.staticGrid && (key === "noResize" || key === "noMove" || key === "locked");
          }
        }
        Utils.sanitizeMinMax(n);
        if (m) {
          const widthChanged = m.w !== void 0 && m.w !== n.w;
          this.moveNode(n, m);
          if (widthChanged && n.subGrid) {
            n.subGrid.onResize(this.hasAnimationCSS() ? n.w : void 0);
          } else {
            this.resizeToContentCheck(widthChanged, n);
          }
          delete n._orig;
        }
        if (m || changed) {
          this._writeAttr(el, n);
        }
        if (ddChanged) {
          this.prepareDragDrop(n.el);
        }
        if (_GridStack.updateCB)
          _GridStack.updateCB(n);
      });
      return this;
    }
    moveNode(n, m) {
      const wasUpdating = n._updating;
      if (!wasUpdating)
        this.engine.cleanNodes().beginUpdate(n);
      this.engine.moveNode(n, m);
      this._updateContainerHeight();
      if (!wasUpdating) {
        this._triggerChangeEvent();
        this.engine.endUpdate();
      }
    }
    /**
     * Updates widget height to match the content height to avoid vertical scrollbars or dead space.
     * This automatically adjusts the widget height based on its content size.
     *
     * Note: This assumes only 1 child under resizeToContentParent='.grid-stack-item-content'
     * (sized to gridItem minus padding) that represents the entire content size.
     *
     * @param el the grid item element to resize
     *
     * @example
     * // Resize a widget to fit its content
     * const widget = document.querySelector('.grid-stack-item');
     * grid.resizeToContent(widget);
     *
     * // This is commonly used with dynamic content:
     * widget.querySelector('.content').innerHTML = 'New longer content...';
     * grid.resizeToContent(widget);
     */
    resizeToContent(el) {
      if (!el)
        return;
      el.classList.remove("size-to-content-max");
      if (!el.clientHeight)
        return;
      const n = el.gridstackNode;
      if (!n)
        return;
      const grid = n.grid;
      if (!grid || el.parentElement !== grid.el)
        return;
      const cell = grid.getCellHeight(true);
      if (!cell)
        return;
      let height = n.h ? n.h * cell : el.clientHeight;
      let item = null;
      if (n.resizeToContentParent)
        item = el.querySelector(n.resizeToContentParent);
      if (!item)
        item = el.querySelector(_GridStack.resizeToContentParent);
      if (!item)
        return;
      const padding = el.clientHeight - item.clientHeight;
      const itemH = n.h ? n.h * cell - padding : item.clientHeight;
      let wantedH;
      if (n.subGrid) {
        wantedH = n.subGrid.getRow() * n.subGrid.getCellHeight(true);
        const subRec = n.subGrid.el.getBoundingClientRect();
        const parentRec = el.getBoundingClientRect();
        wantedH += subRec.top - parentRec.top;
      } else if (n.subGridOpts?.children?.length) {
        return;
      } else {
        const child = item.firstElementChild;
        if (!child) {
          console.error(`Error: GridStack.resizeToContent() widget id:${n.id} '${_GridStack.resizeToContentParent}'.firstElementChild is null, make sure to have a div like container. Skipping sizing.`);
          return;
        }
        wantedH = child.getBoundingClientRect().height || itemH;
      }
      if (itemH === wantedH)
        return;
      height += wantedH - itemH;
      let h2 = Math.ceil(height / cell);
      const softMax = Number.isInteger(n.sizeToContent) ? n.sizeToContent : 0;
      if (softMax && h2 > softMax) {
        h2 = softMax;
        el.classList.add("size-to-content-max");
      }
      if (n.minH && h2 < n.minH)
        h2 = n.minH;
      else if (n.maxH && h2 > n.maxH)
        h2 = n.maxH;
      if (h2 !== n.h) {
        grid._ignoreLayoutsNodeChange = true;
        grid.moveNode(n, { h: h2 });
        delete grid._ignoreLayoutsNodeChange;
      }
    }
    /** call the user resize (so they can do extra work) else our build in version */
    resizeToContentCBCheck(el) {
      if (_GridStack.resizeToContentCB)
        _GridStack.resizeToContentCB(el);
      else
        this.resizeToContent(el);
    }
    /**
     * Rotate widgets by swapping their width and height. This is typically called when the user presses 'r' during dragging.
     * The rotation swaps the w/h dimensions and adjusts min/max constraints accordingly.
     *
     * @param els widget element(s) or selector to rotate
     * @param relative optional pixel coordinate relative to upper/left corner to rotate around (keeps that cell under cursor)
     * @returns the grid instance for chaining
     *
     * @example
     * // Rotate a specific widget
     * grid.rotate('.my-widget');
     *
     * // Rotate with relative positioning during drag
     * grid.rotate(widget, { left: 50, top: 30 });
     */
    rotate(els, relative) {
      _GridStack.getElements(els).forEach((el) => {
        const n = el.gridstackNode;
        if (!n || !Utils.canBeRotated(n))
          return;
        const rot = { w: n.h, h: n.w, minH: n.minW, minW: n.minH, maxH: n.maxW, maxW: n.maxH };
        if (relative) {
          const pivotX = relative.left > 0 ? Math.floor(relative.left / this.cellWidth()) : 0;
          const pivotY = relative.top > 0 ? Math.floor(relative.top / this.opts.cellHeight) : 0;
          rot.x = n.x + pivotX - (n.h - (pivotY + 1));
          rot.y = n.y + pivotY - pivotX;
        }
        const rotRec = rot;
        Object.keys(rotRec).forEach((k) => {
          if (rotRec[k] === void 0)
            delete rotRec[k];
        });
        const _orig = n._orig;
        this.update(el, rot);
        n._orig = _orig;
      });
      return this;
    }
    /**
     * Updates the margins which will set all 4 sides at once - see `GridStackOptions.margin` for format options.
     * Supports CSS string format of 1, 2, or 4 values or a single number.
     *
     * @param value margin value - can be:
     *   - Single number: `10` (applies to all sides)
     *   - Two values: `'10px 20px'` (top/bottom, left/right)
     *   - Four values: `'10px 20px 5px 15px'` (top, right, bottom, left)
     * @returns the grid instance for chaining
     *
     * @example
     * grid.margin(10);           // 10px all sides
     * grid.margin('10px 20px');  // 10px top/bottom, 20px left/right
     * grid.margin('5px 10px 15px 20px'); // Different for each side
     */
    margin(value) {
      const isMultiValue = typeof value === "string" && value.split(" ").length > 1;
      if (!isMultiValue) {
        const data = Utils.parseHeight(value);
        if (this.opts.marginUnit === data.unit && this.opts.margin === data.h)
          return this;
      }
      this.opts.margin = value;
      this.opts.marginTop = this.opts.marginBottom = this.opts.marginLeft = this.opts.marginRight = void 0;
      this._initMargin();
      return this;
    }
    /**
     * Returns the current margin value as a number (undefined if the 4 sides don't match).
     * This only returns a number if all sides have the same margin value.
     *
     * @returns the margin value in pixels, or undefined if sides have different values
     *
     * @example
     * const margin = grid.getMargin();
     * if (margin !== undefined) {
     *   console.log('Uniform margin:', margin, 'px');
     * } else {
     *   console.log('Margins are different on different sides');
     * }
     */
    getMargin() {
      return this.opts.margin;
    }
    /**
     * Returns true if the height of the grid will be less than the vertical
     * constraint. Always returns true if grid doesn't have height constraint.
     * @param node contains x,y,w,h,auto-position options
     *
     * @example
     * if (grid.willItFit(newWidget)) {
     *   grid.addWidget(newWidget);
     * } else {
     *   alert('Not enough free space to place the widget');
     * }
     */
    willItFit(node) {
      return this.engine.willItFit(node);
    }
    /** @internal */
    _triggerChangeEvent() {
      if (this.engine.batchMode)
        return this;
      const elements = this.engine.getDirtyNodes(true);
      if (elements && elements.length) {
        if (!this._ignoreLayoutsNodeChange) {
          this.engine.layoutsNodesChange(elements);
        }
        this._triggerEvent("change", elements);
      }
      this.engine.saveInitial();
      this._sortDom();
      return this;
    }
    /** @internal Re-orders the HTML DOM nodes to match the visual layout for accessibility (Tab navigation) and printing (when not using CSS grids). */
    _sortDom() {
      let nodes = this.engine.nodes;
      nodes.forEach((n) => {
        if (n.subGrid)
          n.subGrid._sortDom();
      });
      if (nodes.length < 2)
        return this;
      this.engine.sortNodes();
      nodes = this.engine.nodes;
      const children = this.el.children;
      if (nodes.some((n, i) => n.el !== children[i])) {
        nodes.forEach((n) => {
          if (n.el && n.el.parentElement === this.el) {
            this.el.appendChild(n.el);
          }
        });
      }
      return this;
    }
    /** @internal */
    _triggerAddEvent() {
      if (this.engine.batchMode)
        return this;
      if (this.engine.addedNodes?.length) {
        if (!this._ignoreLayoutsNodeChange) {
          this.engine.layoutsNodesChange(this.engine.addedNodes);
        }
        this.engine.addedNodes.forEach((n) => {
          delete n._dirty;
        });
        const addedNodes = [...this.engine.addedNodes];
        this.engine.addedNodes = [];
        this._triggerEvent("added", addedNodes);
      }
      return this;
    }
    /** @internal */
    _triggerRemoveEvent() {
      if (this.engine.batchMode)
        return this;
      if (this.engine.removedNodes?.length) {
        const removedNodes = [...this.engine.removedNodes];
        this.engine.removedNodes = [];
        this._triggerEvent("removed", removedNodes);
      }
      return this;
    }
    /** @internal */
    _triggerEvent(type, data) {
      const event = data ? new CustomEvent(type, { bubbles: false, detail: data }) : new Event(type);
      let grid = this;
      while (grid.parentGridNode)
        grid = grid.parentGridNode.grid;
      grid.el.dispatchEvent(event);
      return this;
    }
    /** @internal */
    _updateContainerHeight() {
      if (!this.engine || this.engine.batchMode)
        return this;
      const parent = this.parentGridNode;
      let row = this.getRow() + this._extraDragRow;
      const cellHeight = this.opts.cellHeight;
      const unit = this.opts.cellHeightUnit;
      if (!cellHeight)
        return this;
      if (!parent && !this.opts.minRow) {
        const cssMinHeight = Utils.parseHeight(getComputedStyle(this.el)["minHeight"]);
        if (cssMinHeight.h > 0 && cssMinHeight.unit === unit) {
          const minRow = Math.floor(cssMinHeight.h / cellHeight);
          if (row < minRow) {
            row = minRow;
          }
        }
      }
      this.el.setAttribute("gs-current-row", String(row));
      this.el.style.removeProperty("min-height");
      this.el.style.removeProperty("height");
      if (row) {
        this.el.style[parent ? "minHeight" : "height"] = row * cellHeight + unit;
      }
      if (parent && Utils.shouldSizeToContent(parent)) {
        parent.grid.resizeToContentCBCheck(parent.el);
      }
      return this;
    }
    /** @internal */
    _prepareElement(el, triggerAddEvent = false, node) {
      node = node || this._readAttr(el);
      el.gridstackNode = node;
      node.el = el;
      node.grid = this;
      node = this.engine.addNode(node, triggerAddEvent);
      this._writeAttr(el, node);
      el.classList.add(gridDefaults.itemClass, this.opts.itemClass);
      const sizeToContent = Utils.shouldSizeToContent(node);
      sizeToContent ? el.classList.add("size-to-content") : el.classList.remove("size-to-content");
      if (sizeToContent)
        this.resizeToContentCheck(false, node);
      if (!Utils.lazyLoad(node) || !node.visibleObservable) {
        this.prepareDragDrop(node.el);
      }
      return this;
    }
    /** @internal write position CSS vars and x,y,w,h attributes (not used for CSS but by users) back to element */
    _writePosAttr(el, n) {
      if (!n._moving && !n._resizing || this._placeholder === el) {
        const xProp = this.opts.rtl ? "right" : "left";
        const elStyle = el.style;
        elStyle.top = n.y ? n.y === 1 ? `var(--gs-cell-height)` : `calc(${n.y} * var(--gs-cell-height))` : null;
        elStyle[xProp] = n.x ? n.x === 1 ? `var(--gs-column-width)` : `calc(${n.x} * var(--gs-column-width))` : null;
        elStyle.width = n.w > 1 ? `calc(${n.w} * var(--gs-column-width))` : null;
        elStyle.height = n.h > 1 ? `calc(${n.h} * var(--gs-cell-height))` : null;
      }
      el.style.setProperty("--gs-x", String(n.x || 0));
      el.style.setProperty("--gs-y", String(n.y || 0));
      el.style.setProperty("--gs-w", String(n.w || 1));
      el.style.setProperty("--gs-h", String(n.h || 1));
      el.setAttribute("gs-x", String(n.x ?? 0));
      el.setAttribute("gs-y", String(n.y ?? 0));
      n.w > 1 ? el.setAttribute("gs-w", String(n.w)) : el.removeAttribute("gs-w");
      n.h > 1 ? el.setAttribute("gs-h", String(n.h)) : el.removeAttribute("gs-h");
      return this;
    }
    /** @internal call to write any default attributes back to element */
    _writeAttr(el, node) {
      if (!node)
        return this;
      this._writePosAttr(el, node);
      const attrs = {
        // autoPosition: 'gs-auto-position', // no need to write out as already in node and doesn't affect CSS
        noResize: "gs-no-resize",
        noMove: "gs-no-move",
        locked: "gs-locked",
        id: "gs-id",
        sizeToContent: "gs-size-to-content"
      };
      const nodeRec = node;
      const attrsRec = attrs;
      for (const key in attrsRec) {
        if (nodeRec[key] !== void 0 && nodeRec[key] !== null && nodeRec[key] !== false) {
          el.setAttribute(attrsRec[key], String(nodeRec[key]));
        } else {
          el.removeAttribute(attrsRec[key]);
        }
      }
      if (node.print) {
        if (node.print.pageBreak)
          el.setAttribute("gs-page-break", String(node.print.pageBreak));
        else
          el.removeAttribute("gs-page-break");
        if (node.print.hide)
          el.classList.add("gs-print-hide");
        else
          el.classList.remove("gs-print-hide");
        if (node.print.orientation)
          el.setAttribute("gs-print-orientation", String(node.print.orientation));
        else
          el.removeAttribute("gs-print-orientation");
      } else {
        el.removeAttribute("gs-page-break");
        el.classList.remove("gs-print-hide");
        el.removeAttribute("gs-print-orientation");
      }
      return this;
    }
    /** @internal call to read any default attributes from element */
    _readAttr(el, clearDefaultAttr = true) {
      const n = {};
      n.x = Utils.toNumber(el.getAttribute("gs-x"));
      n.y = Utils.toNumber(el.getAttribute("gs-y"));
      n.w = Utils.toNumber(el.getAttribute("gs-w"));
      n.h = Utils.toNumber(el.getAttribute("gs-h"));
      n.autoPosition = Utils.toBool(el.getAttribute("gs-auto-position"));
      n.noResize = Utils.toBool(el.getAttribute("gs-no-resize"));
      n.noMove = Utils.toBool(el.getAttribute("gs-no-move"));
      n.locked = Utils.toBool(el.getAttribute("gs-locked"));
      let pageBreak = el.getAttribute("gs-page-break");
      let hide = el.classList.contains("gs-print-hide");
      let orientation = el.getAttribute("gs-print-orientation");
      if (pageBreak || hide || orientation) {
        n.print = {};
        if (pageBreak)
          n.print.pageBreak = Utils.toBool(pageBreak);
        if (hide)
          n.print.hide = true;
        if (orientation)
          n.print.orientation = orientation;
      }
      const attr = el.getAttribute("gs-size-to-content");
      if (attr) {
        if (attr === "true" || attr === "false")
          n.sizeToContent = Utils.toBool(attr);
        else
          n.sizeToContent = parseInt(attr, 10);
      }
      n.id = el.getAttribute("gs-id") ?? void 0;
      n.maxW = Utils.toNumber(el.getAttribute("gs-max-w"));
      n.minW = Utils.toNumber(el.getAttribute("gs-min-w"));
      n.maxH = Utils.toNumber(el.getAttribute("gs-max-h"));
      n.minH = Utils.toNumber(el.getAttribute("gs-min-h"));
      if (clearDefaultAttr) {
        if (n.w === 1)
          el.removeAttribute("gs-w");
        if (n.h === 1)
          el.removeAttribute("gs-h");
        if (n.maxW)
          el.removeAttribute("gs-max-w");
        if (n.minW)
          el.removeAttribute("gs-min-w");
        if (n.maxH)
          el.removeAttribute("gs-max-h");
        if (n.minH)
          el.removeAttribute("gs-min-h");
      }
      const nRec = n;
      for (const key in nRec) {
        if (!n.hasOwnProperty(key))
          continue;
        if (!nRec[key] && nRec[key] !== 0 && key !== "sizeToContent") {
          delete nRec[key];
        }
      }
      return n;
    }
    /** @internal */
    _setStaticClass() {
      const classes = ["grid-stack-static"];
      if (this.opts.staticGrid) {
        this.el.classList.add(...classes);
        this.el.setAttribute("gs-static", "true");
      } else {
        this.el.classList.remove(...classes);
        this.el.removeAttribute("gs-static");
      }
      return this;
    }
    /**
     * called when we are being resized - check if the one Column Mode needs to be turned on/off
     * and remember the prev columns we used, or get our count from parent, as well as check for cellHeight==='auto' (square)
     * or `sizeToContent` gridItem options.
     */
    onResize(clientWidth = this.el?.clientWidth) {
      if (!clientWidth)
        return this;
      if (this.prevWidth === clientWidth)
        return this;
      this.prevWidth = clientWidth;
      this.batchUpdate();
      let columnChanged = false;
      if (this._autoColumn && this.parentGridNode) {
        if (this.opts.column !== this.parentGridNode.w) {
          this.column(this.parentGridNode.w, this.opts.layout || "list");
          columnChanged = true;
        }
      } else {
        columnChanged = this.checkDynamicColumn();
      }
      if (this._isAutoCellHeight)
        this.cellHeight();
      this.engine.nodes.forEach((n) => {
        if (n.subGrid)
          n.subGrid.onResize();
      });
      if (!this._skipInitialResize)
        this.resizeToContentCheck(columnChanged);
      delete this._skipInitialResize;
      this.batchUpdate(false);
      return this;
    }
    /** resizes content for given node (or all) if shouldSizeToContent() is true */
    resizeToContentCheck(delay = false, n) {
      if (!this.engine)
        return;
      if (delay && this.hasAnimationCSS()) {
        setTimeout(() => this.resizeToContentCheck(false, n), this.animationDelay);
        return;
      }
      if (n) {
        if (Utils.shouldSizeToContent(n))
          this.resizeToContentCBCheck(n.el);
      } else if (this.engine.nodes.some((n2) => Utils.shouldSizeToContent(n2))) {
        const nodes = [...this.engine.nodes];
        this.batchUpdate();
        nodes.forEach((n2) => {
          if (Utils.shouldSizeToContent(n2))
            this.resizeToContentCBCheck(n2.el);
        });
        this._ignoreLayoutsNodeChange = true;
        this.batchUpdate(false);
        this._ignoreLayoutsNodeChange = false;
      }
      const rcHandler = this._gsEventHandler["resizecontent"];
      if (rcHandler)
        rcHandler(new Event("resizecontent"), n ? [n] : this.engine.nodes);
    }
    /** add or remove the grid element size event handler */
    _updateResizeEvent(forceRemove = false) {
      const trackSize = !this.parentGridNode && (this._isAutoCellHeight || this.opts.sizeToContent || this.opts.columnOpts || this.engine.nodes.find((n) => n.sizeToContent));
      if (!forceRemove && trackSize && !this.resizeObserver) {
        this._sizeThrottle = Utils.throttle(() => this.onResize(), this.opts.cellHeightThrottle);
        this.resizeObserver = new ResizeObserver(() => this._sizeThrottle());
        this.resizeObserver.observe(this.el);
        this._skipInitialResize = true;
      } else if ((forceRemove || !trackSize) && this.resizeObserver) {
        this.resizeObserver.disconnect();
        delete this.resizeObserver;
        delete this._sizeThrottle;
      }
      return this;
    }
    /** @internal convert a potential selector into actual element */
    static getElement(els = ".grid-stack-item") {
      return Utils.getElement(els);
    }
    /** @internal */
    static getElements(els = ".grid-stack-item") {
      return Utils.getElements(els);
    }
    /** @internal */
    static getGridElement(els) {
      return _GridStack.getElement(els);
    }
    /** @internal */
    static getGridElements(els) {
      return Utils.getElements(els);
    }
    /** @internal initialize margin top/bottom/left/right and units */
    _initMargin() {
      let data = { h: 0, unit: "px" };
      let margin = 0;
      let margins = [];
      if (typeof this.opts.margin === "string") {
        margins = this.opts.margin.split(" ");
      }
      if (margins.length === 2) {
        this.opts.marginTop = this.opts.marginBottom = margins[0];
        this.opts.marginLeft = this.opts.marginRight = margins[1];
      } else if (margins.length === 4) {
        this.opts.marginTop = margins[0];
        this.opts.marginRight = margins[1];
        this.opts.marginBottom = margins[2];
        this.opts.marginLeft = margins[3];
      } else {
        data = Utils.parseHeight(this.opts.margin);
        this.opts.marginUnit = data.unit;
        margin = this.opts.margin = data.h;
      }
      const keys = ["marginTop", "marginRight", "marginBottom", "marginLeft"];
      const optsRec = this.opts;
      keys.forEach((k) => {
        if (optsRec[k] === void 0) {
          optsRec[k] = margin;
        } else {
          data = Utils.parseHeight(optsRec[k]);
          optsRec[k] = data.h;
          delete this.opts.margin;
        }
      });
      this.opts.marginUnit = data.unit;
      if (this.opts.marginTop === this.opts.marginBottom && this.opts.marginLeft === this.opts.marginRight && this.opts.marginTop === this.opts.marginRight) {
        this.opts.margin = this.opts.marginTop;
      }
      const style = this.el.style;
      style.setProperty("--gs-item-margin-top", `${this.opts.marginTop}${this.opts.marginUnit}`);
      style.setProperty("--gs-item-margin-bottom", `${this.opts.marginBottom}${this.opts.marginUnit}`);
      style.setProperty("--gs-item-margin-right", `${this.opts.marginRight}${this.opts.marginUnit}`);
      style.setProperty("--gs-item-margin-left", `${this.opts.marginLeft}${this.opts.marginUnit}`);
      return this;
    }
    /* ===========================================================================================
     * drag&drop methods that used to be stubbed out and implemented in dd-gridstack.ts
     * but caused loading issues in prod - see https://github.com/gridstack/gridstack.js/issues/2039
     * ===========================================================================================
     */
    /**
     * Get the global drag & drop implementation instance.
     * This provides access to the underlying drag & drop functionality.
     *
     * @returns the DDGridStack instance used for drag & drop operations
     *
     * @example
     * const dd = GridStack.getDD();
     * // Access drag & drop functionality
     */
    static getDD() {
      return dd;
    }
    /**
     * call to setup dragging in from the outside (say toolbar), by specifying the class selection and options.
     * Called during GridStack.init() as options, but can also be called directly (last param are used) in case the toolbar
     * is dynamically create and needs to be set later.
     * @param dragIn string selector (ex: '.sidebar-item') or list of dom elements
     * @param dragInOptions options - see DDDragOpt. (default: {handle: '.grid-stack-item-content', appendTo: 'body'}
     * @param widgets GridStackWidget def to assign to each element which defines what to create on drop
     * @param root optional root which defaults to document (for shadow dom pass the parent HTMLDocument)
     */
    static setupDragIn(dragIn, dragInOptions, widgets, root = document) {
      if (dragInOptions?.pause !== void 0) {
        DDManager.pauseDrag = dragInOptions.pause;
      }
      dragInOptions = { appendTo: "body", helper: "clone", ...dragInOptions || {} };
      const els = typeof dragIn === "string" ? Utils.getElements(dragIn, root) : dragIn;
      els.forEach((el, i) => {
        if (!dd.isDraggable(el))
          dd.dragIn(el, dragInOptions);
        if (widgets?.[i])
          el.gridstackNode = widgets[i];
      });
    }
    /**
     * Enables/Disables dragging by the user for specific grid elements.
     * For all items and future items, use enableMove() instead. No-op for static grids.
     *
     * Note: If you want to prevent an item from moving due to being pushed around by another
     * during collision, use the 'locked' property instead.
     *
     * @param els widget element(s) or selector to modify
     * @param val if true widget will be draggable, assuming the parent grid isn't noMove or static
     * @returns the grid instance for chaining
     *
     * @example
     * // Make specific widgets draggable
     * grid.movable('.my-widget', true);
     *
     * // Disable dragging for specific widgets
     * grid.movable('#fixed-widget', false);
     */
    movable(els, val) {
      if (this.opts.staticGrid)
        return this;
      _GridStack.getElements(els).forEach((el) => {
        const n = el.gridstackNode;
        if (!n)
          return;
        val ? delete n.noMove : n.noMove = true;
        this.prepareDragDrop(n.el);
      });
      return this;
    }
    /**
     * Enables/Disables user resizing for specific grid elements.
     * For all items and future items, use enableResize() instead. No-op for static grids.
     *
     * @param els widget element(s) or selector to modify
     * @param val if true widget will be resizable, assuming the parent grid isn't noResize or static
     * @returns the grid instance for chaining
     *
     * @example
     * // Make specific widgets resizable
     * grid.resizable('.my-widget', true);
     *
     * // Disable resizing for specific widgets
     * grid.resizable('#fixed-size-widget', false);
     */
    resizable(els, val) {
      if (this.opts.staticGrid)
        return this;
      _GridStack.getElements(els).forEach((el) => {
        const n = el.gridstackNode;
        if (!n)
          return;
        val ? delete n.noResize : n.noResize = true;
        this.prepareDragDrop(n.el);
      });
      return this;
    }
    /**
     * Temporarily disables widgets moving/resizing.
     * If you want a more permanent way (which freezes up resources) use `setStatic(true)` instead.
     *
     * Note: This is a no-op for static grids.
     *
     * This is a shortcut for:
     * ```typescript
     * grid.enableMove(false);
     * grid.enableResize(false);
     * ```
     *
     * @param recurse if true (default), sub-grids also get updated
     * @returns the grid instance for chaining
     *
     * @example
     * // Disable all interactions
     * grid.disable();
     *
     * // Disable only this grid, not sub-grids
     * grid.disable(false);
     */
    disable(recurse = true) {
      if (this.opts.staticGrid)
        return this;
      this.enableMove(false, recurse);
      this.enableResize(false, recurse);
      this._triggerEvent("disable");
      return this;
    }
    /**
     * Re-enables widgets moving/resizing - see disable().
     * Note: This is a no-op for static grids.
     *
     * This is a shortcut for:
     * ```typescript
     * grid.enableMove(true);
     * grid.enableResize(true);
     * ```
     *
     * @param recurse if true (default), sub-grids also get updated
     * @returns the grid instance for chaining
     *
     * @example
     * // Re-enable all interactions
     * grid.enable();
     *
     * // Enable only this grid, not sub-grids
     * grid.enable(false);
     */
    enable(recurse = true) {
      if (this.opts.staticGrid)
        return this;
      this.enableMove(true, recurse);
      this.enableResize(true, recurse);
      this._triggerEvent("enable");
      return this;
    }
    /**
     * Enables/disables widget moving for all widgets. No-op for static grids.
     * Note: locally defined items (with noMove property) still override this setting.
     *
     * @param doEnable if true widgets will be movable, if false moving is disabled
     * @param recurse if true (default), sub-grids also get updated
     * @returns the grid instance for chaining
     *
     * @example
     * // Enable moving for all widgets
     * grid.enableMove(true);
     *
     * // Disable moving for all widgets
     * grid.enableMove(false);
     *
     * // Enable only this grid, not sub-grids
     * grid.enableMove(true, false);
     */
    enableMove(doEnable, recurse = true) {
      if (this.opts.staticGrid)
        return this;
      doEnable ? delete this.opts.disableDrag : this.opts.disableDrag = true;
      this.engine.nodes.forEach((n) => {
        this.prepareDragDrop(n.el);
        if (n.subGrid && recurse)
          n.subGrid.enableMove(doEnable, recurse);
      });
      return this;
    }
    /**
     * Enables/disables widget resizing for all widgets. No-op for static grids.
     * Note: locally defined items (with noResize property) still override this setting.
     *
     * @param doEnable if true widgets will be resizable, if false resizing is disabled
     * @param recurse if true (default), sub-grids also get updated
     * @returns the grid instance for chaining
     *
     * @example
     * // Enable resizing for all widgets
     * grid.enableResize(true);
     *
     * // Disable resizing for all widgets
     * grid.enableResize(false);
     *
     * // Enable only this grid, not sub-grids
     * grid.enableResize(true, false);
     */
    enableResize(doEnable, recurse = true) {
      if (this.opts.staticGrid)
        return this;
      doEnable ? delete this.opts.disableResize : this.opts.disableResize = true;
      this.engine.nodes.forEach((n) => {
        this.prepareDragDrop(n.el);
        if (n.subGrid && recurse)
          n.subGrid.enableResize(doEnable, recurse);
      });
      return this;
    }
    /** @internal call when drag (and drop) needs to be cancelled (Esc key) */
    cancelDrag() {
      const dragEl = DDManager.dragElement?.el;
      if (dragEl?._gridstackNodeOrig) {
        const origNode = dragEl._gridstackNodeOrig;
        const origGrid = origNode.grid;
        const n2 = this._placeholder?.gridstackNode;
        if (n2) {
          n2._isAboutToRemove = true;
          this.engine.removeNode(n2);
        }
        this.engine.restoreInitial();
        dragEl.gridstackNode = origNode;
        delete dragEl._gridstackNodeOrig;
        delete DDManager.dropElement;
        if (origGrid) {
          origGrid.engine.addNode(origNode, false);
          origGrid.engine.restoreInitial();
        }
        return;
      }
      const n = this._placeholder?.gridstackNode;
      if (!n)
        return;
      if (n._isExternal) {
        n._isAboutToRemove = true;
        this.engine.removeNode(n);
      } else if (n._isAboutToRemove) {
        _GridStack._itemRemoving(n.el, false);
      }
      this.engine.restoreInitial();
    }
    /** @internal removes any drag&drop present (called during destroy) */
    _removeDD(el) {
      dd.draggable(el, "destroy").resizable(el, "destroy");
      if (el.gridstackNode) {
        delete el.gridstackNode._initDD;
      }
      delete el.ddElement;
      return this;
    }
    /** @internal called to add drag over to support widgets being added externally */
    _setupAcceptWidget() {
      if (this.opts.staticGrid || !this.opts.acceptWidgets && !this.opts.removable) {
        dd.droppable(this.el, "destroy");
        return this;
      }
      let cellHeight, cellWidth;
      const onDrag = (event, el, helper) => {
        helper = helper || el;
        const node = helper.gridstackNode;
        if (!node)
          return;
        if (!node.grid?.el) {
          helper.style.transform = `scale(${1 / this.dragTransform.xScale},${1 / this.dragTransform.yScale})`;
          const helperRect = helper.getBoundingClientRect();
          helper.style.left = helperRect.x + (this.dragTransform.xScale - 1) * (event.clientX - helperRect.x) / this.dragTransform.xScale + "px";
          helper.style.top = helperRect.y + (this.dragTransform.yScale - 1) * (event.clientY - helperRect.y) / this.dragTransform.yScale + "px";
          helper.style.transformOrigin = `0px 0px`;
        }
        let { top, left } = helper.getBoundingClientRect();
        const rect = this.el.getBoundingClientRect();
        left -= rect.left;
        top -= rect.top;
        const ui = {
          position: {
            top: top * this.dragTransform.xScale,
            left: left * this.dragTransform.yScale
          }
        };
        if (node._temporaryRemoved) {
          node.x = Math.max(0, Math.round(left / cellWidth));
          node.y = Math.max(0, Math.round(top / cellHeight));
          delete node.autoPosition;
          this.engine.nodeBoundFix(node);
          if (!this.engine.willItFit(node)) {
            node.autoPosition = true;
            if (!this.engine.willItFit(node)) {
              dd.off(el, "drag");
              return;
            }
            if (node._willFitPos) {
              Utils.copyPos(node, node._willFitPos);
              delete node._willFitPos;
            }
          }
          this._onStartMoving(helper, event, ui, node, cellWidth, cellHeight);
        } else {
          this._dragOrResize(helper, event, ui, node, cellWidth, cellHeight);
        }
      };
      dd.droppable(this.el, {
        accept: (el) => {
          const node = el.gridstackNode || this._readAttr(el, false);
          if (node?.grid === this)
            return true;
          if (!this.opts.acceptWidgets)
            return false;
          let canAccept = true;
          if (typeof this.opts.acceptWidgets === "function") {
            canAccept = this.opts.acceptWidgets(el);
          } else {
            const selector = this.opts.acceptWidgets === true ? ".grid-stack-item" : this.opts.acceptWidgets;
            canAccept = el.matches(selector);
          }
          if (canAccept && node && this.opts.maxRow) {
            const n = { w: node.w, h: node.h, minW: node.minW, minH: node.minH };
            canAccept = this.engine.willItFit(n);
          }
          return canAccept;
        }
      }).on(this.el, "dropover", (event, el, helper) => {
        let node = helper?.gridstackNode || el.gridstackNode;
        if (node?.grid === this && !node._temporaryRemoved) {
          return false;
        }
        if (node?._sidebarOrig) {
          node.w = node._sidebarOrig.w;
          node.h = node._sidebarOrig.h;
        }
        if (node?.grid && node.grid !== this && !node._temporaryRemoved) {
          const otherGrid = node.grid;
          otherGrid._leave(el, helper);
        }
        helper = helper || el;
        cellWidth = this.cellWidth();
        cellHeight = this.getCellHeight(true);
        if (!node) {
          const attr = helper.getAttribute("data-gs-widget") || helper.getAttribute("gridstacknode");
          if (attr) {
            try {
              node = JSON.parse(attr);
            } catch (error) {
              console.error("Gridstack dropover: Bad JSON format: ", attr);
            }
            helper.removeAttribute("data-gs-widget");
            helper.removeAttribute("gridstacknode");
          }
          if (!node)
            node = this._readAttr(helper);
          node._sidebarOrig = { w: node.w, h: node.h };
        }
        if (!node.grid) {
          if (!node.el)
            node = { ...node };
          node._isExternal = true;
          helper.gridstackNode = node;
        }
        const w = node.w || Math.round(helper.offsetWidth / cellWidth) || 1;
        const h2 = node.h || Math.round(helper.offsetHeight / cellHeight) || 1;
        if (node.grid && node.grid !== this) {
          if (!el._gridstackNodeOrig)
            el._gridstackNodeOrig = node;
          el.gridstackNode = node = { ...node, w, h: h2, grid: this };
          delete node.x;
          delete node.y;
          this.engine.cleanupNode(node).nodeBoundFix(node);
          node._initDD = node._isExternal = // DOM needs to be re-parented on a drop
          node._temporaryRemoved = true;
        } else {
          node.w = w;
          node.h = h2;
          node._temporaryRemoved = true;
        }
        _GridStack._itemRemoving(node.el, false);
        dd.on(el, "drag", onDrag);
        onDrag(event, el, helper);
        return false;
      }).on(this.el, "dropout", (event, el, helper) => {
        const node = helper?.gridstackNode || el.gridstackNode;
        if (!node)
          return false;
        if (!node.grid || node.grid === this) {
          this._leave(el, helper);
          if (this._isTemp) {
            this.removeAsSubGrid(node);
          }
        }
        return false;
      }).on(this.el, "drop", (event, el, helper) => {
        const node = helper?.gridstackNode || el.gridstackNode;
        if (node?.grid === this && !node._isExternal)
          return false;
        const wasAdded = !!this.placeholder.parentElement;
        const wasSidebar = el !== helper;
        this.placeholder.remove();
        delete this.placeholder.gridstackNode;
        if (wasAdded && this.opts.animate) {
          this.setAnimation(false);
          this.setAnimation(true, true);
        }
        const origNode = el._gridstackNodeOrig;
        delete el._gridstackNodeOrig;
        if (wasAdded && origNode?.grid && origNode.grid !== this) {
          const oGrid = origNode.grid;
          oGrid.engine.removeNodeFromLayoutCache(origNode);
          oGrid.engine.removedNodes.push(origNode);
          oGrid._triggerRemoveEvent()._triggerChangeEvent();
          if (oGrid.parentGridNode && !oGrid.engine.nodes.length && oGrid.opts.subGridDynamic) {
            oGrid.removeAsSubGrid();
          }
        }
        if (!node)
          return false;
        if (wasAdded) {
          this.engine.cleanupNode(node);
          node.grid = this;
        }
        delete node.grid?._isTemp;
        dd.off(el, "drag");
        if (helper && helper !== el) {
          helper.remove();
          el = helper;
        } else {
          el.remove();
        }
        this._removeDD(el);
        if (!wasAdded)
          return false;
        const subGrid = node.subGrid?.el?.gridstack;
        Utils.copyPos(node, this._readAttr(this.placeholder));
        Utils.removePositioningStyles(el);
        if (wasSidebar && (node.content || node.subGridOpts || _GridStack.addRemoveCB)) {
          delete node.el;
          el = this.addWidget(node) || el;
        } else {
          this._prepareElement(el, true, node);
          this.el.appendChild(el);
          this.resizeToContentCheck(false, node);
          if (subGrid) {
            subGrid.parentGridNode = node;
          }
          this._updateContainerHeight();
        }
        this.engine.addedNodes.push(node);
        this._triggerAddEvent();
        this._triggerChangeEvent();
        this.engine.endUpdate();
        if (this._gsEventHandler["dropped"]) {
          this._gsEventHandler["dropped"]({ ...event, type: "dropped" }, origNode && origNode.grid ? origNode : void 0, node);
        }
        return false;
      });
      return this;
    }
    /** @internal mark item for removal */
    static _itemRemoving(el, remove) {
      if (!el)
        return;
      const node = el ? el.gridstackNode : void 0;
      if (!node?.grid || el.classList.contains(node.grid.opts.removableOptions.decline))
        return;
      remove ? node._isAboutToRemove = true : delete node._isAboutToRemove;
      remove ? el.classList.add("grid-stack-item-removing") : el.classList.remove("grid-stack-item-removing");
    }
    /** @internal called to setup a trash drop zone if the user specifies it */
    _setupRemoveDrop() {
      if (typeof this.opts.removable !== "string")
        return this;
      const trashEl = document.querySelector(this.opts.removable);
      if (!trashEl)
        return this;
      if (!this.opts.staticGrid && !dd.isDroppable(trashEl)) {
        dd.droppable(trashEl, this.opts.removableOptions).on(trashEl, "dropover", (event, el) => _GridStack._itemRemoving(el, true)).on(trashEl, "dropout", (event, el) => _GridStack._itemRemoving(el, false));
      }
      return this;
    }
    /**
     * Re-scans one or more widget elements for drag handle elements after delayed content
     * (React portal, Angular component, etc.) has been rendered inside the item.
     * Only needed when you use a custom `draggable.handle` selector that lives *inside* the
     * item's dynamically-created content. The default `.grid-stack-item-content` handle is
     * created synchronously and never needs this call.
     *
     * @param els widget element(s) or selector
     *
     * @example
     * // React: after portal renders (see GridStackItem useEffect)
     * // Angular: after createComp() inside gsCreateNgComponents
     * grid.refreshDragHandles(itemEl);
     */
    refreshDragHandles(els) {
      _GridStack.getElements(els).forEach((el) => {
        el.ddElement?.ddDraggable?.refreshHandles();
      });
      return this;
    }
    /**
     * prepares the element for drag&drop - this is normally called by makeWidget() unless are are delay loading
     * @param el GridItemHTMLElement of the widget
     * @param [force=false]
     * */
    prepareDragDrop(el, force = false) {
      const node = el?.gridstackNode;
      if (!node)
        return this;
      const noMove = node.noMove || this.opts.disableDrag;
      const noResize = node.noResize || this.opts.disableResize;
      const disable = this.opts.staticGrid || noMove && noResize;
      if (force || disable) {
        if (node._initDD) {
          this._removeDD(el);
          delete node._initDD;
        }
        if (disable) {
          el.classList.add("ui-draggable-disabled", "ui-resizable-disabled");
          return this;
        }
      }
      if (!node._initDD) {
        let cellWidth;
        let cellHeight;
        const onStartMoving = (event, ui) => {
          this.triggerEvent(event, event.target);
          cellWidth = this.cellWidth();
          cellHeight = this.getCellHeight(true);
          this._onStartMoving(el, event, ui, node, cellWidth, cellHeight);
        };
        const dragOrResize = (event, ui) => {
          this._dragOrResize(el, event, ui, node, cellWidth, cellHeight);
        };
        const onEndMoving = (event) => {
          this.placeholder.remove();
          delete this.placeholder.gridstackNode;
          delete node._moving;
          delete node._resizing;
          delete node._event;
          delete node._lastTried;
          const widthChanged = node.w !== node._orig.w;
          const target = event.target;
          if (!target.gridstackNode || target.gridstackNode.grid !== this)
            return;
          node.el = target;
          if (node._isAboutToRemove) {
            const grid = el.gridstackNode.grid;
            if (grid._gsEventHandler[event.type]) {
              grid._gsEventHandler[event.type](event, target);
            }
            grid.engine.nodes.push(node);
            grid.removeWidget(el, true, true);
          } else {
            Utils.removePositioningStyles(target);
            if (node._temporaryRemoved) {
              this._writePosAttr(target, node);
              this.engine.addNode(node);
            } else {
              this._writePosAttr(target, node);
            }
            this.triggerEvent(event, target);
          }
          this._extraDragRow = 0;
          this._updateContainerHeight();
          this._triggerChangeEvent();
          this.engine.endUpdate();
          if (event.type === "resizestop") {
            if (Number.isInteger(node.sizeToContent))
              node.sizeToContent = node.h;
            this.resizeToContentCheck(widthChanged, node);
          }
        };
        dd.draggable(el, {
          start: onStartMoving,
          stop: onEndMoving,
          drag: dragOrResize,
          rtl: this.opts.rtl === "auto" ? void 0 : this.opts.rtl
        }).resizable(el, {
          start: onStartMoving,
          stop: onEndMoving,
          resize: dragOrResize,
          rtl: this.opts.rtl === "auto" ? void 0 : this.opts.rtl
        });
        node._initDD = true;
      }
      dd.draggable(el, noMove ? "disable" : "enable").resizable(el, noResize ? "disable" : "enable");
      return this;
    }
    /** @internal handles actual drag/resize start */
    _onStartMoving(el, event, ui, node, cellWidth, cellHeight) {
      this.engine.cleanNodes().beginUpdate(node);
      this._writePosAttr(this.placeholder, node);
      this.el.appendChild(this.placeholder);
      this.placeholder.gridstackNode = node;
      if (node.grid?.el) {
        this.dragTransform = Utils.getValuesFromTransformedElement(el);
      } else if (this.placeholder && this.placeholder.closest(".grid-stack")) {
        const gridEl = this.placeholder.closest(".grid-stack");
        this.dragTransform = Utils.getValuesFromTransformedElement(gridEl);
      } else {
        this.dragTransform = {
          xScale: 1,
          xOffset: 0,
          yScale: 1,
          yOffset: 0
        };
      }
      node.el = this.placeholder;
      node._lastUiPosition = ui.position;
      node._prevYPix = ui.position.top;
      node._moving = event.type === "dragstart";
      node._resizing = event.type === "resizestart";
      delete node._lastTried;
      if (event.type === "dropover" && node._temporaryRemoved) {
        this.engine.addNode(node);
        node._moving = true;
      }
      this.engine.cacheRects(cellWidth, cellHeight, this.opts.marginTop, this.opts.marginRight, this.opts.marginBottom, this.opts.marginLeft);
      if (event.type === "resizestart") {
        const colLeft = this.getColumn() - node.x;
        const rowLeft = (this.opts.maxRow || Number.MAX_SAFE_INTEGER) - node.y;
        dd.resizable(el, "option", "minWidth", cellWidth * Math.min(node.minW || 1, colLeft)).resizable(el, "option", "minHeight", cellHeight * Math.min(node.minH || 1, rowLeft)).resizable(el, "option", "maxWidth", cellWidth * Math.min(node.maxW || Number.MAX_SAFE_INTEGER, colLeft)).resizable(el, "option", "maxWidthMoveLeft", cellWidth * Math.min(node.maxW || Number.MAX_SAFE_INTEGER, node.x + node.w)).resizable(el, "option", "maxHeight", cellHeight * Math.min(node.maxH || Number.MAX_SAFE_INTEGER, rowLeft)).resizable(el, "option", "maxHeightMoveUp", cellHeight * Math.min(node.maxH || Number.MAX_SAFE_INTEGER, node.y + node.h));
      }
    }
    /** @internal handles actual drag/resize */
    _dragOrResize(el, event, ui, node, cellWidth, cellHeight) {
      const p = { ...node._orig };
      let resizing = false;
      let mLeft = this.opts.marginLeft, mRight = this.opts.marginRight, mTop = this.opts.marginTop, mBottom = this.opts.marginBottom;
      const mHeight = Math.round(cellHeight * 0.1), mWidth = Math.round(cellWidth * 0.1);
      mLeft = Math.min(mLeft, mWidth);
      mRight = Math.min(mRight, mWidth);
      mTop = Math.min(mTop, mHeight);
      mBottom = Math.min(mBottom, mHeight);
      if (event.type === "drag") {
        if (node._temporaryRemoved)
          return;
        node._prevYPix = ui.position.top;
        if (this.opts.draggable.scroll !== false) {
          DDManager.dragElement?.updateScrollPosition(this.el);
        }
        const left = ui.position.left + (ui.position.left > node._lastUiPosition.left ? -mRight : mLeft);
        const top = ui.position.top + (ui.position.top > node._lastUiPosition.top ? -mBottom : mTop);
        p.x = Math.round(left / cellWidth);
        p.y = Math.round(top / cellHeight);
        const prev = this._extraDragRow;
        if (this.engine.collide(node, p)) {
          const row = this.getRow();
          let extra = Math.max(0, p.y + node.h - row);
          if (this.opts.maxRow && row + extra > this.opts.maxRow) {
            extra = Math.max(0, this.opts.maxRow - row);
          }
          this._extraDragRow = extra;
        } else
          this._extraDragRow = 0;
        if (this._extraDragRow !== prev)
          this._updateContainerHeight();
        if (node.x === p.x && node.y === p.y)
          return;
      } else if (event.type === "resize") {
        if ((p.x ?? 0) < 0)
          return;
        Utils.updateScrollResize(event, el, cellHeight);
        p.w = Math.round((ui.size.width - mLeft) / cellWidth);
        p.h = Math.round((ui.size.height - mTop) / cellHeight);
        if (node.w === p.w && node.h === p.h)
          return;
        if (node._lastTried && node._lastTried.w === p.w && node._lastTried.h === p.h)
          return;
        if (event.hasMovedX) {
          const calcPX = node.x - (p.w - node.w);
          p.x = calcPX < 0 ? 0 : calcPX;
        }
        if (event.hasMovedY) {
          const calcPY = node.y - (p.h - node.h);
          p.y = calcPY < 0 ? 0 : calcPY;
        }
        resizing = true;
      }
      node._event = event;
      node._lastTried = p;
      const rect = {
        x: ui.position.left + mLeft,
        y: ui.position.top + mTop,
        w: (ui.size ? ui.size.width : node.w * cellWidth) - mLeft - mRight,
        h: (ui.size ? ui.size.height : node.h * cellHeight) - mTop - mBottom
      };
      if (this.engine.moveNodeCheck(node, { ...p, cellWidth, cellHeight, rect, resizing })) {
        node._lastUiPosition = ui.position;
        this.engine.cacheRects(cellWidth, cellHeight, mTop, mRight, mBottom, mLeft);
        delete node._skipDown;
        if (resizing && node.subGrid)
          node.subGrid.onResize();
        this._extraDragRow = 0;
        this._updateContainerHeight();
        const target = event.target;
        if (!node._sidebarOrig) {
          this._writePosAttr(target, node);
        }
        this.triggerEvent(event, target);
      }
    }
    /** call given event callback on our main top-most grid (if we're nested) */
    triggerEvent(event, target) {
      let grid = this;
      while (grid.parentGridNode)
        grid = grid.parentGridNode.grid;
      if (grid._gsEventHandler[event.type]) {
        grid._gsEventHandler[event.type](event, target);
      }
    }
    /** @internal called when item leaving our area by either cursor dropout event
     * or shape is outside our boundaries. remove it from us, and mark temporary if this was
     * our item to start with else restore prev node values from prev grid it came from.
     */
    _leave(el, helper) {
      helper = helper || el;
      const node = helper.gridstackNode;
      if (!node)
        return;
      helper.style.transform = helper.style.transformOrigin = "";
      dd.off(el, "drag");
      if (node._temporaryRemoved)
        return;
      node._temporaryRemoved = true;
      this.engine.removeNode(node);
      node.el = node._isExternal && helper ? helper : el;
      const sidebarOrig = node._sidebarOrig;
      if (node._isExternal)
        this.engine.cleanupNode(node);
      node._sidebarOrig = sidebarOrig;
      if (this.opts.removable === true) {
        _GridStack._itemRemoving(el, true);
      }
      if (el._gridstackNodeOrig) {
        el.gridstackNode = el._gridstackNodeOrig;
        delete el._gridstackNodeOrig;
      } else if (node._isExternal) {
        this.engine.restoreInitial();
      }
    }
  };
  GridStack.renderCB = (el, w) => {
    if (el && w?.content)
      el.textContent = w.content;
  };
  GridStack.resizeToContentParent = ".grid-stack-item-content";
  GridStack.Utils = Utils;
  GridStack.Engine = GridStackEngine;
  GridStack.GDRev = "13.2.0";

  // dsh-runtime/plugin/client/dashboard-model.js
  var COLUMNS = 12;
  var DEFAULT_WIDGETS = [
    { kind: "outcome", x: 0, y: 0, w: 8, h: 5 },
    { kind: "templates", x: 8, y: 0, w: 4, h: 5 },
    { kind: "waiting", x: 0, y: 5, w: 6, h: 4 },
    { kind: "recent-work", x: 6, y: 5, w: 6, h: 4 }
  ];
  var number = (value, fallback, min, max) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
  };
  function normalizeWidget(value) {
    const kind = typeof value?.kind === "string" ? value.kind.trim().slice(0, 80) : "";
    if (!kind) return null;
    const w = number(value.w, 4, 1, COLUMNS);
    return {
      kind,
      x: Math.min(number(value.x, 0, 0, COLUMNS - 1), COLUMNS - w),
      y: number(value.y, 0, 0, 1e3),
      w,
      h: number(value.h, 4, 2, 20)
    };
  }
  var defaultDashboard = () => ({
    id: "home",
    name: "Home",
    widgets: DEFAULT_WIDGETS.map((widget) => ({ ...widget }))
  });
  function dashboardsFrom(value) {
    const dashboards = [];
    const dashboardIds = /* @__PURE__ */ new Set();
    for (const candidate of Array.isArray(value) ? value : []) {
      const id = typeof candidate?.id === "string" ? candidate.id.trim().slice(0, 120) : "";
      if (!id || dashboardIds.has(id) || dashboards.length >= 20) continue;
      const widgets = [];
      const widgetKinds = /* @__PURE__ */ new Set();
      for (const candidateWidget of Array.isArray(candidate.widgets) ? candidate.widgets : []) {
        const widget = normalizeWidget(candidateWidget);
        if (!widget || widgetKinds.has(widget.kind) || widgets.length >= 30) continue;
        widgetKinds.add(widget.kind);
        widgets.push(widget);
      }
      dashboardIds.add(id);
      dashboards.push({
        id,
        name: String(candidate.name ?? "Untitled dashboard").trim().slice(0, 80) || "Untitled dashboard",
        widgets
      });
    }
    if (!dashboardIds.has("home")) dashboards.unshift(defaultDashboard());
    return dashboards.slice(0, 20);
  }
  function addDashboardWidget(dashboard, definition) {
    if (dashboard.widgets.some(({ kind }) => kind === definition.kind)) return dashboard;
    const y = dashboard.widgets.reduce((bottom, widget2) => Math.max(bottom, widget2.y + widget2.h), 0);
    const widget = normalizeWidget({ kind: definition.kind, x: 0, y, w: definition.w, h: definition.h });
    return widget ? { ...dashboard, widgets: [...dashboard.widgets, widget] } : dashboard;
  }
  function applyDashboardLayout(dashboard, layout) {
    const positions = new Map((Array.isArray(layout) ? layout : []).map((item) => [String(item.id ?? ""), item]));
    return {
      ...dashboard,
      widgets: dashboard.widgets.map((widget) => normalizeWidget({ ...widget, ...positions.get(widget.kind), kind: widget.kind }) ?? widget)
    };
  }

  // dsh-runtime/plugin/client/home.js
  function OutcomeWidget({ workspaceId, act, openWorkItem }) {
    const [outcome, setOutcome] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const submit = async () => {
      if (!workspaceId || !outcome.trim()) return;
      setBusy(true);
      setError("");
      try {
        const text = outcome.trim();
        const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
        const title = lines[0].length > 60 ? `${lines[0].substring(0, 57)}...` : lines[0];
        const created = await act({ action: "create_goal", workspaceId, title, description: text, priority: "normal" });
        if (created?.id) openWorkItem(created.id);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusy(false);
      }
    };
    return h(
      "form",
      {
        className: "bees-composer bees-dashboard-composer",
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
        onInput: (event) => setOutcome(event.target.value),
        onKeyDown: (event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
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
    );
  }
  function TemplatesWidget({ data, workspaceId, act, openWorkItem }) {
    const [showAllTemplates, setShowAllTemplates] = useState(false);
    const processes = data.processes.filter((row) => row.workspaceId === workspaceId && row.kind === "standard");
    const templates = (data.templates ?? []).filter((row) => row.workspaceId === workspaceId);
    const cards = [...templates.map((row) => ({ ...row, isTemplate: true })), ...processes.map((row) => ({ ...row, isTemplate: false }))];
    const visibleCards = showAllTemplates ? cards : cards.slice(0, 10);
    if (!cards.length) return h(Empty, null, workspaceId ? "No templates available." : "Choose a workspace to see templates.");
    return h(
      "div",
      { className: "bees-home-templates" },
      ...visibleCards.map((card) => h(
        "button",
        {
          className: "bees-template-card",
          onClick: async () => {
            if (card.isTemplate) {
              const p = await act({ action: "create_process", workspaceId, name: `New from ${card.name}`, templateId: card.id });
              if (p?.id) openWorkItem(null, p.id);
            } else {
              openWorkItem(null, card.id);
            }
          },
          key: card.id
        },
        h("div", { className: "bees-template-card-title" }, card.name),
        h("div", { className: "bees-template-card-meta" }, card.description || (card.isTemplate ? "Template" : "Process"))
      )),
      cards.length > 10 && !showAllTemplates ? h(Button, { onClick: () => setShowAllTemplates(true) }, `Show all ${cards.length} templates`) : null
    );
  }
  function ListWidget({ definition, rowsForRoute, navigate }) {
    const rows = rowsForRoute(definition.route).slice(0, definition.limit ?? 20);
    return h(
      "div",
      { className: "bees-dashboard-list" },
      rows.length ? rows.map((row) => h("button", {
        className: "bees-dashboard-row",
        key: row.id,
        onClick: row.open,
        title: row.label
      }, row.label)) : h(Empty, null, definition.empty ?? "Nothing here yet."),
      h(Button, { className: "bees-dashboard-view-all", onClick: () => navigate(definition.route) }, "View all")
    );
  }
  function MetricsWidget({ rowsForRoute }) {
    const metrics = [
      ["Active work", rowsForRoute("all-work").length],
      ["Needs you", rowsForRoute("waiting").length],
      ["Processes", rowsForRoute("all-processes").length],
      ["Agents", rowsForRoute("all-agents").length]
    ];
    return h("div", { className: "bees-dashboard-metrics" }, ...metrics.map(([label, value]) => h(
      "div",
      { className: "bees-dashboard-metric", key: label },
      h("strong", null, String(value)),
      h("span", null, label)
    )));
  }
  function ProposalsWidget({ data, workspaceIds, act }) {
    const proposals = (data.proposals ?? []).filter((row) => workspaceIds.includes(row.workspaceId) && row.status === "pending");
    if (!proposals.length) return h(Empty, null, "No proposals waiting for review.");
    return h("div", { className: "bees-dashboard-list" }, ...proposals.map((proposal) => h(
      "article",
      { className: "bees-dashboard-proposal", key: proposal.id },
      h("strong", null, proposal.title),
      proposal.summary ? h("p", { className: "bees-muted" }, proposal.summary) : null,
      h(
        "div",
        { className: "bees-card-actions" },
        h(Button, { className: "primary", onClick: () => act({ action: "apply_proposal", proposalId: proposal.id }) }, "Apply"),
        h(Button, { onClick: () => act({ action: "reject_proposal", proposalId: proposal.id }) }, "Dismiss")
      )
    )));
  }
  var WIDGETS = [
    { kind: "outcome", label: "Ask Bees", description: "Create a goal from an outcome", w: 8, h: 5, component: OutcomeWidget },
    { kind: "metrics", label: "Metrics", description: "Key workspace counts", w: 12, h: 3, component: MetricsWidget },
    { kind: "waiting", label: "Needs your attention", description: "Blocked and waiting work", route: "waiting", limit: 8, w: 6, h: 4, component: ListWidget },
    { kind: "recent-work", label: "Recent work", description: "Latest active work items", route: "all-work", limit: 8, w: 6, h: 4, component: ListWidget },
    { kind: "all-work", label: "All work", description: "Active work items", route: "all-work", w: 6, h: 5, component: ListWidget },
    { kind: "goals", label: "Goals", description: "Current goals", route: "goals", w: 6, h: 5, component: ListWidget },
    { kind: "completed", label: "Completed work", description: "Recently completed work", route: "completed", w: 6, h: 5, component: ListWidget },
    { kind: "templates", label: "Templates", description: "Processes and reusable templates", w: 4, h: 5, component: TemplatesWidget },
    { kind: "processes", label: "Processes", description: "Active processes", route: "all-processes", w: 6, h: 5, component: ListWidget },
    { kind: "agents", label: "Agents", description: "Workspace agents", route: "all-agents", w: 6, h: 5, component: ListWidget },
    { kind: "files", label: "Files & folders", description: "Team locations", route: "locations", w: 6, h: 5, component: ListWidget },
    { kind: "runs", label: "Runs", description: "Recent agent runs", route: "runs", w: 6, h: 5, component: ListWidget },
    { kind: "artifacts", label: "Artifacts", description: "Outputs from completed runs", route: "artifacts", w: 6, h: 5, component: ListWidget },
    { kind: "proposals", label: "Proposals", description: "Changes awaiting review", w: 6, h: 5, component: ProposalsWidget }
  ];
  var widgetByKind = new Map(WIDGETS.map((widget) => [widget.kind, widget]));
  function DashboardGrid({ dashboard, editing, onLayout, onRemove, widgetProps }) {
    const root = useRef(null);
    const gridRef = useRef(null);
    const widgetKey = dashboard.widgets.map(({ kind }) => kind).join("|");
    useEffect(() => {
      const grid = GridStack.init({
        column: 12,
        columnOpts: { breakpoints: [{ w: 700, c: 1 }, { w: 1e3, c: 6 }] },
        cellHeight: 72,
        margin: 6,
        animate: true,
        disableDrag: !editing,
        disableResize: !editing,
        draggable: { handle: ".bees-dashboard-widget-handle" },
        resizable: { handles: "e,se,s,sw,w" }
      }, root.current);
      if (!grid) return void 0;
      const save = () => {
        const layout = grid.save(false);
        if (Array.isArray(layout)) onLayout(layout);
      };
      grid.on("dragstop resizestop", save);
      gridRef.current = grid;
      return () => {
        gridRef.current = null;
        grid.offAll().destroy(false);
      };
    }, [dashboard.id, widgetKey]);
    useEffect(() => {
      gridRef.current?.enableMove(editing);
      gridRef.current?.enableResize(editing);
    }, [editing]);
    return h(
      "div",
      { className: `grid-stack bees-dashboard-grid ${editing ? "editing" : ""}`, ref: root },
      ...dashboard.widgets.map((widget) => {
        const definition = widgetByKind.get(widget.kind);
        const Component = definition?.component;
        return h("section", {
          className: "grid-stack-item",
          key: widget.kind,
          "gs-id": widget.kind,
          "gs-x": widget.x,
          "gs-y": widget.y,
          "gs-w": widget.w,
          "gs-h": widget.h
        }, h(
          "div",
          { className: "grid-stack-item-content bees-dashboard-widget" },
          h(
            "header",
            { className: "bees-dashboard-widget-handle" },
            h("strong", null, definition?.label ?? widget.kind),
            editing ? h("button", {
              type: "button",
              className: "bees-dashboard-remove",
              title: `Remove ${definition?.label ?? widget.kind}`,
              "aria-label": `Remove ${definition?.label ?? widget.kind}`,
              onPointerDown: (event) => event.stopPropagation(),
              onClick: () => onRemove(widget.kind)
            }, "×") : null
          ),
          h(
            "div",
            { className: "bees-dashboard-widget-body" },
            Component ? h(Component, { ...widgetProps, definition }) : h(Empty, null, "This widget is no longer available.")
          )
        ));
      })
    );
  }
  var newDashboardId = () => globalThis.crypto?.randomUUID?.() ?? `dashboard-${Date.now()}`;
  function Home({ data, workspaceId, workspaceIds, act, openWorkItem, navigate, rowsForRoute, preference, preferences }) {
    const dashboards = dashboardsFrom(preference.dashboards);
    const activeId = dashboards.some(({ id }) => id === preference.activeDashboardId) ? preference.activeDashboardId : "home";
    const dashboard = dashboards.find(({ id }) => id === activeId) ?? dashboards[0];
    const [editing, setEditing] = useState(false);
    useEffect(() => setEditing(false), [dashboard.id]);
    const saveDashboard = (nextDashboard) => {
      void preferences.set("dashboards", dashboards.map((candidate) => candidate.id === dashboard.id ? nextDashboard : candidate));
    };
    const createDashboard = async () => {
      if (dashboards.length >= 20) return;
      const name = await ask("Dashboard name", "New dashboard");
      if (!name) return;
      const created = { id: newDashboardId(), name, widgets: [] };
      await preferences.set("dashboards", [...dashboards, created]);
      await preferences.set("activeDashboardId", created.id);
    };
    const renameDashboard = async () => {
      const name = await ask("Dashboard name", dashboard.name);
      if (name) saveDashboard({ ...dashboard, name });
    };
    const deleteDashboard = async () => {
      if (dashboard.id === "home" || !await confirmAction(`Delete “${dashboard.name}”?`)) return;
      await preferences.set("dashboards", dashboards.filter(({ id }) => id !== dashboard.id));
      await preferences.set("activeDashboardId", "home");
    };
    const addWidget = (definition, event) => {
      saveDashboard(addDashboardWidget(dashboard, definition));
      event.currentTarget.closest("details")?.removeAttribute("open");
    };
    const availableWidgets = WIDGETS.filter(({ kind }) => !dashboard.widgets.some((widget) => widget.kind === kind));
    const widgetProps = { data, workspaceId, workspaceIds, act, openWorkItem, navigate, rowsForRoute };
    return h(
      "div",
      { className: "bees-dashboard" },
      h(
        "div",
        { className: "bees-dashboard-toolbar" },
        h("select", {
          className: "bees-select bees-dashboard-select",
          value: dashboard.id,
          "aria-label": "Dashboard",
          onChange: (event) => preferences.set("activeDashboardId", event.target.value)
        }, ...dashboards.map((candidate) => h("option", { key: candidate.id, value: candidate.id }, candidate.name))),
        h(Button, { onClick: createDashboard, disabled: dashboards.length >= 20 }, "+ Dashboard"),
        h("div", { className: "bees-grow" }),
        editing ? h(
          "details",
          { className: "bees-dashboard-add" },
          h("summary", { className: "bees-btn" }, "+ Widget"),
          h(
            "div",
            { className: "bees-dashboard-widget-menu" },
            availableWidgets.length ? availableWidgets.map((definition) => h("button", {
              type: "button",
              key: definition.kind,
              onClick: (event) => addWidget(definition, event)
            }, h("strong", null, definition.label), h("span", null, definition.description))) : h("div", { className: "bees-muted" }, "Every widget is already on this dashboard.")
          )
        ) : null,
        editing ? h(Button, { onClick: renameDashboard }, "Rename") : null,
        editing && dashboard.id !== "home" ? h(Button, { className: "danger", onClick: deleteDashboard }, "Delete") : null,
        h(Button, { className: editing ? "primary" : "", onClick: () => setEditing((value) => !value) }, editing ? "Done" : "Edit")
      ),
      dashboard.widgets.length ? h(DashboardGrid, {
        dashboard,
        editing,
        widgetProps,
        onLayout: (layout) => saveDashboard(applyDashboardLayout(dashboard, layout)),
        onRemove: (kind) => saveDashboard({ ...dashboard, widgets: dashboard.widgets.filter((widget) => widget.kind !== kind) })
      }) : h(Empty, null, editing ? "Add a widget to build this dashboard." : "This dashboard is empty. Choose Edit to add widgets.")
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
      request(`/bees-api/run-history?executionId=${encodeURIComponent(run.id)}`).then((value) => active && setHistory(value.history)).catch((error) => active && setHistory({ error: error instanceof Error ? error.message : String(error) }));
      return () => {
        active = false;
      };
    }, [run?.id]);
    useEffect(() => {
      let active = true;
      request("/bees-api/audit").then(({ events: events2 }) => active && setAudit(events2));
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
      const title = await ask("Delegated work title", "");
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
      if (!await confirmAction(`Archive “${item.title}”? Active work will be cancelled. Its history will be preserved.`)) return;
      if (await act({ action: "archive_item", itemId: item.id })) onArchived?.();
    };
    const answered = (key) => setHandled((current) => new Set(current).add(key));
    const runAudit = new Set(itemRuns.map(({ id }) => id));
    const events = audit.filter(({ executionId, metadata }) => runAudit.has(executionId) || metadata?.itemId === item.id || metadata?.parentId === item.id || metadata?.resultId === item.id);
    const assignAgent = (agentAssignmentId) => act({
      action: "edit_item",
      itemId: item.id,
      title: item.title,
      description: item.description,
      owner: item.owner,
      priority: item.priority,
      parentId: item.parentId,
      agentAssignmentId: agentAssignmentId || null
    });
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
            h("input", { className: "bees-input", placeholder: pendingRun ? "Answer above..." : "Composer available when agent asks...", disabled: true, style: { flex: 1 } })
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
            { className: "bees-tabbar" },
            h(
              "div",
              { className: "bees-tabs", role: "tablist", "aria-label": "Work item details" },
              h("button", { type: "button", role: "tab", id: "bees-tab-details", className: `bees-tab ${activeTab === "details" ? "active" : ""}`, "aria-selected": activeTab === "details", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("details") }, "Details"),
              h("button", { type: "button", role: "tab", id: "bees-tab-files", className: `bees-tab ${activeTab === "files" ? "active" : ""}`, "aria-selected": activeTab === "files", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("files") }, "Files"),
              h("button", { type: "button", role: "tab", id: "bees-tab-runs", className: `bees-tab ${activeTab === "runs" ? "active" : ""}`, "aria-selected": activeTab === "runs", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("runs") }, "Runs"),
              h("button", { type: "button", role: "tab", id: "bees-tab-audit", className: `bees-tab ${activeTab === "audit" ? "active" : ""}`, "aria-selected": activeTab === "audit", "aria-controls": "bees-detail-panel", onClick: () => setActiveTab("audit") }, "Audit")
            ),
            h(
              "div",
              { className: "bees-tab-actions" },
              ["running", "waiting"].includes(item.runtimePhase) ? h(Button, { onClick: () => act({ action: "pause_item", itemId: item.id }) }, "Pause") : null,
              item.runtimePhase === "paused" ? h(Button, { className: "primary", onClick: () => act({ action: "resume_item", itemId: item.id }) }, "Resume") : null,
              item.runtimePhase === "failed" ? h(Button, { className: "primary", onClick: () => act({ action: "retry_item", itemId: item.id }) }, "Retry") : null,
              ["running", "waiting", "paused", "failed"].includes(item.runtimePhase) ? h(Button, { onClick: () => act({ action: "cancel_item", itemId: item.id }) }, "Stop") : null,
              h(Button, { className: "danger", onClick: archive }, "Archive"),
              run?.status === "completed" && run.outputs.length && data.attachments.some(({ workItemId }) => workItemId === item.id) ? h(Button, { className: "primary", onClick: publish }, "Publish outputs") : null
            )
          ),
          h(
            "div",
            { className: "bees-tab-panel", role: "tabpanel", id: "bees-detail-panel", "aria-labelledby": `bees-tab-${activeTab}` },
            activeTab === "details" ? h(
              React.Fragment,
              null,
              h("div", { className: "bees-status" }, `${process?.name ?? "Process"} · ${stage?.name ?? "Stage"}`),
              h("h3", null, "Active Agent"),
              h("p", { className: "bees-muted" }, assignment ? `${assignment.name}${assignment.model ? ` · ${assignment.model}` : ""}` : `Stage route: ${routeLabel}`),
              stage?.driver !== "terminal" ? h(
                "label",
                { className: "bees-form" },
                "Agent for this item",
                h(
                  "select",
                  {
                    className: "bees-select",
                    value: item.agentAssignmentId ?? "",
                    "aria-label": "Agent for this work item",
                    onChange: (event) => void assignAgent(event.target.value)
                  },
                  h("option", { value: "" }, `Use stage route (${routeLabel})`),
                  ...assignments.map((agent) => h(
                    "option",
                    { value: agent.id, key: agent.id, disabled: !agent.enabled },
                    `${agent.name}${agent.enabled ? "" : " (unavailable)"}`
                  ))
                )
              ) : null,
              h("h3", null, "Process"),
              process?.description ? h(MarkdownText, { text: process.description }) : h("p", { className: "bees-muted" }, "No description"),
              h("h3", null, "Description"),
              item.description ? h(MarkdownText, { text: item.description }) : h("p", { className: "bees-muted" }, "No description"),
              h("div", { className: "bees-detail-actions" }, h(Button, { onClick: edit }, "Edit"), h(Button, { onClick: addSubitem }, "Delegate work"))
            ) : activeTab === "files" ? h(
              React.Fragment,
              null,
              h("h3", null, "Inputs"),
              h("div", { className: "bees-detail-actions", style: { marginBottom: "12px" } }, h(Button, { onClick: addFile }, "Add inputs")),
              h("h3", null, "Generated Files"),
              run?.outputs.length ? h("p", null, run.outputs.join(", ")) : h("p", { className: "bees-muted" }, "No outputs generated yet.")
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
  function WorkItemCockpit({ ctx, data, rootId, teamId, act, onBack }) {
    const root = data.items.find(({ id }) => id === rootId);
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
    if (!root) return h(Empty, null, "Work item not found");
    const process = data.processes.find(({ id }) => id === root.processId);
    const stages = data.stages.filter(({ processId }) => processId === root.processId);
    const selected = items.find(({ id }) => id === selectedId) ?? root;
    const latest = /* @__PURE__ */ new Map();
    for (const run of data.runs) if (run.workItemId && !latest.has(run.workItemId)) latest.set(run.workItemId, run);
    const lineage = (item) => {
      const names = [];
      let current = item;
      while (current?.parentId && visibleIds.has(current.parentId)) {
        current = data.items.find(({ id }) => id === current.parentId);
        if (current) names.unshift(current.title);
      }
      return names.join(" → ");
    };
    const completed = items.filter(({ completed: completed2 }) => completed2).length;
    const total = items.length;
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
        return h(
          "section",
          { className: "bees-column", key: stage.id },
          h("header", { className: "bees-column-head" }, stage.name, h("span", { className: "bees-count" }, rows.length)),
          h("div", { className: "bees-cards" }, ...rows.length ? rows.map((item) => {
            const run = latest.get(item.id);
            const parentPath = lineage(item);
            const routedAgent = data.assignments.find(({ id }) => id === (run?.resolvedAgentId ?? item.agentAssignmentId));
            return h(
              "button",
              { className: `bees-hierarchy-card ${selected.id === item.id ? "active" : ""}`, key: item.id, onClick: () => setSelectedId(item.id) },
              h("h3", null, item.title),
              h("div", { className: "bees-lineage bees-muted" }, item.id === root.id ? "Root work item" : parentPath || "Delegated work"),
              h("div", { className: "bees-muted" }, [item.runtimePhase, routedAgent?.name, run?.status].filter(Boolean).join(" · "))
            );
          }) : [h(Empty, { key: "empty" }, "No work in this stage")])
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
      request(`/bees-api/run-file?${query}`).then((value) => {
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
  function AgentInteractionPanel({ run, item, title, summary, session, interaction, handled, onAnswered, onOpen, openLabel }) {
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
          h("h2", null, item?.title ?? title ?? summary?.displayTitle ?? "Agent run")
        ),
        h("div", { className: "bees-grow" }),
        onOpen ? h(Button, { onClick: onOpen }, openLabel) : null
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
  function NeedsYouPage({ ctx, data, workspaceIds, openWorkItem, openRun }) {
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
          const rowTitle = item?.title ?? runTitle(data, run) ?? summary?.displayTitle;
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
          title: runTitle(data, selected.run),
          summary: selected.session,
          session,
          interaction,
          handled,
          onAnswered: answered,
          onOpen: selected.item ? () => openWorkItem(selected.item.id) : () => openRun(selected.run.id),
          openLabel: selected.item ? "Open work" : "Open run"
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
              h("div", { className: "bees-row-title" }, item?.title ?? runTitle(data, run)),
              h("div", { className: "bees-muted" }, run.status === "interrupted" ? "The prior wait was interrupted; retry the work to ask again." : "Reconnect to the agent or open the work item to recover.")
            ),
            h(Button, { onClick: item ? () => openWorkItem(item.id) : () => openRun(run.id) }, item ? "Open work" : "Open run")
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
          if (!await confirmAction(`Archive “${process.name}”? Its work and history will be preserved.`)) return;
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
          h(Button, { className: "danger", onClick: async () => await confirmAction(`Archive template “${template.name}”?`) && act({ action: "archive_process_template", templateId: template.id }) }, "Archive")
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
  function McpAccess({ servers, access, chosen }) {
    const [mode, setMode] = useState(access ?? "all");
    const picked = new Set(chosen ?? []);
    return h(
      React.Fragment,
      null,
      h(
        "label",
        null,
        "MCP servers this agent may use",
        h(
          "select",
          {
            className: "bees-select",
            name: "mcpAccess",
            value: mode,
            onChange: (event) => setMode(event.target.value)
          },
          h("option", { value: "all" }, "Every connected server"),
          h("option", { value: "none" }, "None"),
          h("option", { value: "listed" }, "Only the ones I pick")
        ),
        h("span", { className: "bees-muted" }, servers.length ? "A server's tools reach an agent only if it is allowed here." : "No MCP servers are connected yet; add one under Agents, MCP servers.")
      ),
      mode === "listed" ? h(
        "div",
        { className: "bees-form" },
        h("span", null, "Allowed servers"),
        ...servers.map((server) => h(
          "label",
          { key: server.id, className: "bees-muted" },
          h("input", { type: "checkbox", name: "mcpServers", value: server.id, defaultChecked: picked.has(server.id) }),
          ` ${server.label} (${server.toolCount} tool${server.toolCount === 1 ? "" : "s"})`
        )),
        servers.length ? null : h("span", { className: "bees-muted" }, "Nothing to pick yet.")
      ) : null
    );
  }
  function AgentCreateForm({ ctx, data, servers, workspaceId, act, onCancel, onCreated }) {
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
          mcpAccess: String(form.get("mcpAccess") ?? "all"),
          mcpServers: form.getAll("mcpServers").map(String),
          enabled: form.get("enabled") === "on",
          maxConcurrency: Number(form.get("maxConcurrency") ?? 0)
        });
        if (created?.id) onCreated(created.id);
      } },
      h(
        "div",
        { className: "bees-page-head" },
        h(Button, { onClick: onCancel }, "← Agents"),
        h("div", null, h("h2", null, "New agent"), h("div", { className: "bees-muted" }, "Give it a name, a toolbox, and a model. Everything here can be changed later."))
      ),
      h("label", null, "Name", h("input", { className: "bees-input", name: "name", required: true, autoFocus: true, placeholder: "Research agent" })),
      h("label", null, "Description", h("input", { className: "bees-input", name: "description", placeholder: "What should this agent be used for?" })),
      h(
        "label",
        null,
        "Agent preset, its skills and tools",
        h(
          "select",
          {
            className: "bees-select",
            name: "presetId",
            required: true,
            defaultValue: presets.find(({ id }) => id === "standard")?.id ?? presets[0]?.id
          },
          ...presets.map((preset) => h("option", { value: preset.id, key: preset.id }, preset.name))
        ),
        h("span", { className: "bees-muted" }, "The preset decides which tools this agent can run. Skills & tools lists what each one carries.")
      ),
      h(AgentModelSelect, { ctx, systemDefault: data.systemDefaultModel }),
      h(
        "label",
        null,
        "Capabilities, comma separated",
        h("input", { className: "bees-input", name: "capabilities", placeholder: "research, writing" }),
        h("span", { className: "bees-muted" }, "Optional labels. A process stage can ask for an agent that has one.")
      ),
      h(McpAccess, { servers }),
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
  function AgentsPage({ ctx, data, servers = [], route, workspaceIds, workspaceId, creating, setCreating, act, openDshSettings }) {
    const assignments = data.assignments.filter((row) => workspaceIds.includes(row.workspaceId));
    const pools = data.pools.filter((row) => workspaceIds.includes(row.workspaceId));
    const [selectedId, setSelectedId] = useState("");
    const [selectedPoolId, setSelectedPoolId] = useState("");
    const selected = assignments.find(({ id }) => id === selectedId);
    const selectedPool = pools.find(({ id }) => id === selectedPoolId);
    if (creating === "agent") return h(AgentCreateForm, {
      ctx,
      data,
      servers,
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
    if (route === "presets") return h(
      "div",
      { className: "bees-stack" },
      h(
        "div",
        { className: "bees-callout" },
        h("h3", null, "A preset is an agent's toolbox"),
        h("div", null, "It bundles the prompt, the skills, the tools and the permissions an agent gets. Every agent picks one. What the presets themselves contain is edited in DSH settings.")
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
          mcpAccess: String(form.get("mcpAccess") ?? "all"),
          mcpServers: form.getAll("mcpServers").map(String),
          enabled: form.get("enabled") === "on",
          maxConcurrency: Number(form.get("maxConcurrency") ?? 0)
        });
        if (saved) setSelectedId("");
      } },
      h("div", { className: "bees-row" }, h(Button, { onClick: () => setSelectedId("") }, "← Agents"), h("strong", null, selected.name), h("div", { className: "bees-grow" }), selected.systemRole ? h("span", { className: "bees-badge" }, `Bees ${selected.systemRole}`) : null),
      h("label", null, "Name", h("input", { className: "bees-input", name: "name", defaultValue: selected.name, disabled: Boolean(selected.systemRole) })),
      h("label", null, "Description", h("input", { className: "bees-input", name: "description", defaultValue: selected.description })),
      h(
        "label",
        null,
        "Agent preset, its skills and tools",
        h(
          "select",
          { className: "bees-select", name: "presetId", defaultValue: selected.presetId },
          ...data.presets.filter(({ broken }) => !broken).map((preset) => h("option", { value: preset.id, key: preset.id }, preset.name))
        ),
        h("span", { className: "bees-muted" }, "The preset decides which tools this agent can run. Skills & tools lists what each one carries.")
      ),
      h(AgentModelSelect, {
        ctx,
        value: selected.model ?? "",
        effort: selected.reasoningEffort ?? "",
        systemDefault: data.systemDefaultModel
      }),
      h(
        "label",
        null,
        "Capabilities, comma separated",
        h("input", { className: "bees-input", name: "capabilities", defaultValue: selected.capabilities.join(", "), placeholder: "research, writing" }),
        h("span", { className: "bees-muted" }, "Optional labels. A process stage can ask for an agent that has one.")
      ),
      h(McpAccess, { servers, access: selected.mcpAccess, chosen: selected.mcpServers }),
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

  // dsh-runtime/plugin/client/skills.js
  var STATUS_CLASS = { connected: "bees-running", failed: "bees-failed", starting: "", off: "" };
  var STATUS_LABEL = {
    connected: "Connected",
    failed: "Not running",
    starting: "Starting…",
    off: "Turned off"
  };
  function useCapabilities() {
    const [value, setValue] = useState(null);
    const [error, setError] = useState("");
    const load = async () => {
      try {
        setValue(await request("/bees-api/capabilities"));
        setError("");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    useEffect(() => {
      void load();
      const timer = setInterval(() => void load(), 4e3);
      return () => clearInterval(timer);
    }, []);
    const act = async (command) => {
      try {
        const result = await request("/bees-api/capabilities", { method: "POST", body: JSON.stringify(command) });
        setError("");
        await load();
        return result;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        return null;
      }
    };
    return { data: value, error, act, reload: load };
  }
  function Filter({ value, onChange, placeholder }) {
    return h("div", { className: "bees-search" }, h("input", {
      className: "bees-input",
      value,
      placeholder,
      "aria-label": placeholder,
      onChange: (event) => onChange(event.target.value)
    }));
  }
  function matches(needle, ...fields) {
    if (!needle) return true;
    return fields.some((field) => String(field ?? "").toLocaleLowerCase().includes(needle));
  }
  function SkillPack({ pack, act }) {
    const [state, setState] = useState({ open: false, skills: null, note: "" });
    const open = async () => {
      setState({ open: true, skills: null, note: "Reading what this collection publishes…" });
      const found = await act({ action: "list_skill_pack", repo: pack.repo });
      setState({ open: true, skills: found?.skills ?? [], note: found ? "" : "Could not read that collection." });
    };
    return h(
      "section",
      { className: "bees-box" },
      h(
        "div",
        { className: "bees-row" },
        h(
          "div",
          { className: "bees-row-main" },
          h("div", { className: "bees-row-title" }, pack.label),
          h("div", { className: "bees-muted" }, `${pack.note} · github.com/${pack.repo}`)
        ),
        h(
          Button,
          { onClick: () => state.open ? setState({ open: false, skills: null, note: "" }) : open() },
          state.open ? "Close" : "Browse"
        )
      ),
      state.note ? h("p", { className: "bees-muted" }, state.note) : null,
      ...(state.skills ?? []).map((skill) => h(
        "div",
        { className: "bees-row", key: skill.path },
        h(
          "div",
          { className: "bees-row-main" },
          h("div", { className: "bees-row-title" }, skill.name),
          h("div", { className: "bees-muted" }, skill.directory)
        ),
        h(Button, {
          onClick: async () => await confirmAction(`Install ${skill.name} from ${pack.repo}? It becomes instructions any agent can open.`) && act({ action: "install_skill", repo: pack.repo, directory: skill.directory })
        }, skill.installed ? "Reinstall" : "Install")
      )),
      state.open && state.skills && !state.skills.length ? h(Empty, null, "This collection publishes no skills right now") : null
    );
  }
  function SkillsPage({ capabilities, onAddTools }) {
    const { data, error, act } = capabilities;
    const [query, setQuery] = useState("");
    if (error && !data) return h(Empty, null, error);
    if (!data) return h(Empty, null, "Reading the skill and tool catalog…");
    const needle = query.trim().toLocaleLowerCase();
    const skills = data.skills.filter((skill) => matches(needle, skill.name, skill.description, skill.whenToUse));
    const tools = data.tools.filter((tool) => matches(needle, tool.name, tool.description, tool.serverLabel));
    const builtIn = tools.filter(({ serverName }) => !serverName);
    const fromServers = tools.filter(({ serverName }) => serverName);
    return h(
      "div",
      { className: "bees-stack" },
      h(
        "div",
        { className: "bees-callout" },
        h("h3", null, "What your agents can actually do"),
        h("div", null, "A skill is a written instruction sheet an agent can open when it needs one. A tool is something an agent can run. Both are live here: what this page lists is what a run can reach right now. Add more tools by connecting an MCP server.")
      ),
      h(Filter, { value: query, onChange: setQuery, placeholder: "Filter skills and tools" }),
      h("section", { className: "bees-box" }, h(
        "div",
        { className: "bees-row" },
        h(
          "div",
          { className: "bees-row-main" },
          h("h3", null, "Give your agents a new tool"),
          h("div", { className: "bees-muted" }, "Tools come from MCP servers. Pick one from the catalog, or point Bees at any REST API.")
        ),
        h(Button, { className: "primary", onClick: onAddTools }, "Add an MCP server")
      )),
      h(
        "section",
        { className: "bees-box" },
        h("h3", null, `Skills (${skills.length})`),
        data.skillsComplete ? null : h(
          "p",
          { className: "bees-muted" },
          "No preset could be read, so this list may be short."
        ),
        h("p", { className: "bees-muted" }, "Skills come from your skill folders. Drop a folder containing SKILL.md into one of them and it appears here without restarting Bees."),
        ...skills.length ? skills.map((skill) => h(
          "div",
          { className: "bees-row", key: skill.name },
          h(
            "div",
            { className: "bees-row-main" },
            h("div", { className: "bees-row-title" }, skill.name),
            h("div", { className: "bees-muted" }, skill.description || "No description"),
            skill.whenToUse ? h("div", { className: "bees-muted" }, `When to use: ${skill.whenToUse}`) : null,
            skill.presets?.length ? h("div", { className: "bees-muted" }, `Available to: ${skill.presets.join(", ")}`) : null
          ),
          skill.provider ? h("span", { className: "bees-badge" }, skill.provider) : null,
          skill.removable ? h(Button, {
            className: "danger",
            onClick: async () => await confirmAction(`Remove ${skill.name} from ${data.skillsRoot}?`) && act({ action: "remove_skill", name: skill.name })
          }, "Remove") : null
        )) : [h(Empty, { key: "empty" }, needle ? "No skill matches that" : "No skills installed yet")]
      ),
      h("h3", { className: "bees-section-title" }, "Install skills from a public collection"),
      h("p", { className: "bees-muted" }, `Installed skills land in ${data.skillsRoot} and show up above straight away. A skill is written instructions, so read what it tells an agent to do before you install one.`),
      ...(data.skillPacks ?? []).map((pack) => h(SkillPack, { pack, act, key: pack.repo })),
      h(
        "section",
        { className: "bees-box" },
        h("h3", null, `Tools from MCP servers (${fromServers.length})`),
        ...fromServers.length ? fromServers.map((tool) => h(
          "div",
          { className: "bees-row", key: tool.name },
          h(
            "div",
            { className: "bees-row-main" },
            h("div", { className: "bees-row-title" }, tool.name),
            h("div", { className: "bees-muted" }, tool.description || "No description")
          ),
          h("span", { className: "bees-badge" }, tool.serverLabel)
        )) : [h(
          "div",
          { className: "bees-row", key: "empty" },
          h(
            "div",
            { className: "bees-row-main" },
            h("div", { className: "bees-muted" }, "No MCP server is connected, so there are no extra tools yet.")
          ),
          h(Button, { onClick: onAddTools }, "Add one")
        )]
      ),
      ...(data.presets ?? []).map((preset) => {
        const own = preset.tools.filter((tool) => matches(needle, tool.name, tool.description));
        return h(
          "section",
          { className: "bees-box", key: preset.id },
          h("h3", null, `${preset.name} preset · ${own.length} tools`),
          preset.broken ? h("p", { className: "bees-muted" }, preset.broken) : h("p", { className: "bees-muted" }, "What an agent on this preset can run. Which preset an agent uses is set on the agent; what a preset contains is edited in DSH settings."),
          ...own.length ? own.map((tool) => h(
            "div",
            { className: "bees-row", key: tool.name },
            h(
              "div",
              { className: "bees-row-main" },
              h("div", { className: "bees-row-title" }, tool.name),
              h("div", { className: "bees-muted" }, tool.description || "No description")
            )
          )) : [h(Empty, { key: "empty" }, needle ? "No tool matches that" : "This preset gives an agent no tools")]
        );
      }),
      builtIn.length ? h(
        "section",
        { className: "bees-box" },
        h("h3", null, `Registered outside any preset (${builtIn.length})`),
        ...builtIn.map((tool) => h(
          "div",
          { className: "bees-row", key: tool.name },
          h(
            "div",
            { className: "bees-row-main" },
            h("div", { className: "bees-row-title" }, tool.name),
            h("div", { className: "bees-muted" }, tool.description || "No description")
          )
        ))
      ) : null
    );
  }
  function CatalogReview({ ctx, entry, onCancel, onInstall }) {
    const [directory, setDirectory] = useState("");
    const [secrets, setSecrets] = useState({});
    const [inputs, setInputs] = useState({});
    const [busy, setBusy] = useState(false);
    const blank = (bag) => ({ name, optional }) => !optional && !String(bag[name] ?? "").trim();
    const ready = !busy && (!entry.requiresDirectory || directory) && !entry.secrets.some(blank(secrets)) && !(entry.inputs ?? []).some(blank(inputs));
    const pick = async () => {
      const path = await ctx.workspaces.pickDirectory();
      if (path) setDirectory(path);
    };
    return h(
      "section",
      { className: "bees-box" },
      h(
        "div",
        { className: "bees-page-head" },
        h(Button, { onClick: onCancel }, "← Catalog"),
        h(
          "div",
          null,
          h("h2", null, `Add ${entry.label}`),
          h("div", { className: "bees-muted" }, entry.summary)
        )
      ),
      h(
        "div",
        { className: "bees-callout" },
        h("h3", null, "What this server can reach"),
        h("div", null, entry.access)
      ),
      h(
        "div",
        { className: "bees-row" },
        h(
          "div",
          { className: "bees-row-main" },
          h("div", { className: "bees-row-title" }, "Published by"),
          h("div", { className: "bees-muted" }, entry.publisher)
        ),
        h(Button, { onClick: () => openExternal(entry.homepage) }, "Open source page")
      ),
      h(
        "div",
        { className: "bees-row" },
        h(
          "div",
          { className: "bees-row-main" },
          h("div", { className: "bees-row-title" }, "How it runs"),
          h("div", { className: "bees-muted" }, entry.transport === "stdio" ? `Bees starts \`${entry.command} ${(entry.args ?? []).join(" ")}\` on this machine.` : `Bees calls ${entry.url} over the internet.`),
          entry.prerequisite ? h("div", { className: "bees-muted" }, entry.prerequisite) : null
        )
      ),
      entry.requiresDirectory ? h(
        "div",
        { className: "bees-row" },
        h(
          "div",
          { className: "bees-row-main" },
          h("div", { className: "bees-row-title" }, entry.directoryLabel ?? "Folder"),
          h("div", { className: "bees-muted" }, directory || "No folder chosen yet")
        ),
        h(Button, { onClick: pick }, directory ? "Change" : "Choose folder")
      ) : null,
      ...(entry.inputs ?? []).map((field) => h(
        "label",
        { className: "bees-form", key: field.name },
        h("span", null, field.label),
        h(field.textarea ? "textarea" : "input", {
          className: field.textarea ? "bees-textarea" : "bees-input",
          value: inputs[field.name] ?? "",
          placeholder: field.textarea ? "curl 'https://api.example.com/v1/things' -H 'Authorization: Bearer …'" : "",
          onChange: (event) => setInputs({ ...inputs, [field.name]: event.target.value })
        }),
        field.help ? h("span", { className: "bees-muted" }, field.help) : null
      )),
      ...entry.secrets.map((secret) => h(
        "label",
        { className: "bees-form", key: secret.name },
        h("span", null, secret.label),
        h("input", {
          className: "bees-input",
          type: "password",
          autoComplete: "off",
          value: secrets[secret.name] ?? "",
          onChange: (event) => setSecrets({ ...secrets, [secret.name]: event.target.value })
        }),
        secret.help ? h("span", { className: "bees-muted" }, secret.help) : null
      )),
      entry.secrets.length ? h(
        "p",
        { className: "bees-muted" },
        "Secrets are kept in your DSH credential store, not in the Bees database."
      ) : null,
      h(
        "div",
        { className: "bees-detail-actions" },
        h(Button, {
          className: "primary",
          disabled: !ready,
          onClick: async () => {
            setBusy(true);
            try {
              await onInstall({ directory, secrets, inputs });
            } finally {
              setBusy(false);
            }
          }
        }, busy ? "Adding…" : "Add and turn on"),
        h(Button, { onClick: onCancel }, "Cancel")
      )
    );
  }
  function ManualServerForm({ onCancel, act }) {
    const [transport, setTransport] = useState("stdio");
    return h(
      "form",
      {
        className: "bees-box bees-form",
        onSubmit: async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const secrets = {};
          for (const line of String(form.get("secrets") ?? "").split("\n")) {
            const at = line.indexOf("=");
            if (at > 0) secrets[line.slice(0, at).trim()] = line.slice(at + 1).trim();
          }
          const created = await act({
            action: "add_mcp_server",
            transport,
            serverName: String(form.get("serverName") ?? ""),
            label: String(form.get("label") ?? ""),
            command: String(form.get("command") ?? ""),
            args: String(form.get("args") ?? ""),
            url: String(form.get("url") ?? ""),
            secrets
          });
          if (created?.id) onCancel();
        }
      },
      h(
        "div",
        { className: "bees-page-head" },
        h(Button, { onClick: onCancel }, "← MCP servers"),
        h(
          "div",
          null,
          h("h2", null, "Add a server by hand"),
          h("div", { className: "bees-muted" }, "Only add a server you trust. Its tools go straight to your agents.")
        )
      ),
      h("label", null, "Short name", h("input", {
        className: "bees-input",
        name: "serverName",
        required: true,
        autoFocus: true,
        placeholder: "linear",
        pattern: "[A-Za-z0-9_-]{1,32}",
        title: "Letters, digits, dash and underscore, up to 32 characters"
      }), h("span", { className: "bees-muted" }, "Every tool this server publishes is prefixed with it.")),
      h("label", null, "Display name", h("input", { className: "bees-input", name: "label", placeholder: "Linear" })),
      h("label", null, "How it runs", h(
        "select",
        {
          className: "bees-select",
          value: transport,
          onChange: (event) => setTransport(event.target.value)
        },
        h("option", { value: "stdio" }, "Run a command on this machine"),
        h("option", { value: "streamable-http" }, "Call a URL over HTTP")
      )),
      transport === "stdio" ? h(
        React.Fragment,
        null,
        h("label", null, "Command", h("input", { className: "bees-input", name: "command", required: true, placeholder: "npx" })),
        h("label", null, "Arguments, one per line", h("textarea", {
          className: "bees-textarea",
          name: "args",
          placeholder: "-y\n@modelcontextprotocol/server-memory"
        })),
        h("label", null, "Environment secrets, one NAME=value per line", h("textarea", {
          className: "bees-textarea",
          name: "secrets",
          placeholder: "API_KEY=…"
        }))
      ) : h(
        React.Fragment,
        null,
        h("label", null, "Server URL", h("input", {
          className: "bees-input",
          name: "url",
          required: true,
          type: "url",
          placeholder: "https://example.com/mcp"
        })),
        h("label", null, "Headers, one Name=value per line", h("textarea", {
          className: "bees-textarea",
          name: "secrets",
          placeholder: "Authorization=Bearer …"
        }))
      ),
      h("p", { className: "bees-muted" }, "Values on those last lines are stored in your DSH credential store."),
      h(
        "div",
        { className: "bees-detail-actions" },
        h("button", { className: "bees-btn primary" }, "Add and turn on"),
        h(Button, { onClick: onCancel }, "Cancel")
      )
    );
  }
  function McpPage({ ctx, capabilities }) {
    const { data, error, act } = capabilities;
    const [reviewing, setReviewing] = useState("");
    const [manual, setManual] = useState(false);
    const [query, setQuery] = useState("");
    const [registry, setRegistry] = useState({ query: "", results: null, note: "" });
    const searchRegistry = async (text) => {
      setRegistry({ query: text, results: null, note: "Searching the public registry…" });
      const found = await act({ action: "search_mcp_registry", query: text });
      setRegistry({ query: text, results: found?.results ?? [], note: "" });
    };
    if (error && !data) return h(Empty, null, error);
    if (!data) return h(Empty, null, "Reading connected servers…");
    const entry = data.catalog.find(({ id }) => id === reviewing);
    if (manual) return h(ManualServerForm, { onCancel: () => setManual(false), act });
    if (entry) return h(CatalogReview, {
      ctx,
      entry,
      onCancel: () => setReviewing(""),
      onInstall: async ({ directory, secrets, inputs }) => {
        const created = await act({ action: "install_mcp_server", catalogId: entry.id, directory, secrets, inputs });
        if (created?.id) setReviewing("");
      }
    });
    const needle = query.trim().toLocaleLowerCase();
    const catalog = data.catalog.filter((row) => matches(needle, row.label, row.summary, row.publisher));
    return h(
      "div",
      { className: "bees-stack" },
      error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
      h(
        "div",
        { className: "bees-callout" },
        h("h3", null, "MCP servers give your agents new tools"),
        h("div", null, "An MCP server is a small program Bees runs, or a URL it calls, that publishes tools. Bees does not turn any on for you: pick one below, read what it can reach, and add it. Everything it publishes then shows up under Skills & tools.")
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
            h("h3", null, "Connected servers"),
            h("div", { className: "bees-muted" }, "Turning one off stops its program and removes its tools.")
          ),
          h(Button, { onClick: () => setManual(true) }, "Add by hand")
        ),
        ...data.servers.length ? data.servers.map((server) => h(
          "div",
          { className: "bees-row", key: server.id },
          h(
            "div",
            { className: "bees-row-main" },
            h("div", { className: "bees-row-title" }, server.label),
            h("div", { className: "bees-muted" }, [
              `${server.toolCount} tool${server.toolCount === 1 ? "" : "s"}`,
              server.transport === "stdio" ? `${server.command} ${server.args.join(" ")}`.trim() : server.url,
              server.source === "catalog" ? "from the catalog" : "added by hand"
            ].filter(Boolean).join(" · ")),
            server.error ? h("div", { className: "bees-muted" }, server.error) : null
          ),
          h("span", { className: `bees-status ${STATUS_CLASS[server.status] ?? ""}` }, STATUS_LABEL[server.status] ?? server.status),
          h(Button, {
            onClick: () => act({ action: "set_mcp_server_enabled", serverId: server.id, enabled: !server.enabled })
          }, server.enabled ? "Turn off" : "Turn on"),
          h(Button, {
            className: "danger",
            onClick: async () => await confirmAction(`Remove ${server.label}? Its tools disappear from every agent.`) && act({ action: "remove_mcp_server", serverId: server.id })
          }, "Remove")
        )) : [h(Empty, { key: "empty" }, "No MCP servers connected yet")]
      ),
      h("h3", { className: "bees-section-title" }, "Add a popular server"),
      h(Filter, { value: query, onChange: setQuery, placeholder: "Filter the catalog" }),
      h("div", { className: "bees-grid" }, ...catalog.map((row) => h(
        "section",
        { className: "bees-box", key: row.id },
        h("h3", null, row.label),
        h("p", { className: "bees-muted" }, row.summary),
        h("p", { className: "bees-muted" }, row.publisher),
        h(
          "div",
          { className: "bees-detail-actions" },
          h(Button, {
            className: row.installedAs ? "" : "primary",
            onClick: () => setReviewing(row.id)
          }, row.installedAs ? "Add another" : "Review and add")
        )
      ))),
      catalog.length ? null : h(Empty, null, "No catalog entry matches that"),
      h("h3", { className: "bees-section-title" }, "Search the public MCP registry"),
      h("p", { className: "bees-muted" }, "Everything the community has published. These are not reviewed by Bees, so read what a server does before you add it."),
      h(
        "form",
        {
          className: "bees-search",
          onSubmit: (event) => {
            event.preventDefault();
            void searchRegistry(new FormData(event.currentTarget).get("q"));
          }
        },
        h("input", { className: "bees-input", name: "q", defaultValue: registry.query, placeholder: "Search the registry", "aria-label": "Search the MCP registry" }),
        h("button", { className: "bees-btn primary" }, "Search")
      ),
      registry.note ? h("p", { className: "bees-muted" }, registry.note) : null,
      ...(registry.results ?? []).map((row) => h(
        "div",
        { className: "bees-row", key: row.name },
        h(
          "div",
          { className: "bees-row-main" },
          h("div", { className: "bees-row-title" }, row.title),
          h("div", { className: "bees-muted" }, row.description || row.name),
          h("div", { className: "bees-muted" }, row.url)
        ),
        h(Button, {
          onClick: async () => await confirmAction(`Add ${row.title}? Bees will call ${row.url} and hand its tools to your agents.`) && act({
            action: "add_mcp_server",
            transport: "streamable-http",
            serverName: row.serverName,
            label: row.title,
            url: row.url
          })
        }, "Add")
      )),
      registry.results && !registry.results.length ? h(Empty, null, "The registry returned no remote server for that") : null
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
        h(Button, { className: "danger", disabled: team?.role !== "admin", onClick: async () => await confirmAction(`Archive “${location.name}”? This will not delete the external folder.`) && act({ action: "archive_location", locationId: location.id }) }, "Archive")
      )) : [h(Empty, { key: "empty" }, "No shared team locations yet")]
    );
  }
  function ActivityPage({ data, route, workspaceIds, setRoute, openWorkItem, openProcess, runId, setRunId }) {
    const runs = data.runs.filter((run2) => workspaceIds.includes(run2.workspaceId));
    const [events, setEvents] = useState([]);
    const [history, setHistory] = useState(null);
    useEffect(() => {
      if (route === "audit") void request("/bees-api/audit").then((value) => setEvents(value.events));
    }, [route]);
    useEffect(() => {
      let active = true;
      if (!runId) {
        setHistory(null);
        return () => {
          active = false;
        };
      }
      request(`/bees-api/run-history?executionId=${encodeURIComponent(runId)}`).then((value) => active && setHistory(value.history)).catch((error) => active && setHistory({ error: error instanceof Error ? error.message : String(error) }));
      return () => {
        active = false;
      };
    }, [runId]);
    if (route === "evaluations") return h(Empty, null, "Evaluations are not available in the current Bees profile.");
    if (route === "audit") return h("div", null, ...events.length ? events.map((event) => {
      const run2 = runs.find(({ id }) => id === event.executionId);
      const relatedIds = [event.metadata?.itemId, event.metadata?.parentId, event.metadata?.resultId].filter(Boolean);
      const item = data.items.find(({ id, processId }) => relatedIds.includes(id) && workspaceIds.includes(data.processes.find((process2) => process2.id === processId)?.workspaceId));
      const process = data.processes.find(({ id, workspaceId }) => workspaceIds.includes(workspaceId) && [event.metadata?.processId, event.metadata?.resultId].includes(id));
      const runItem = run2 ? data.items.find(({ id }) => id === run2.workItemId) : null;
      const detail = runItem?.title ?? item?.title ?? process?.name ?? event.metadata?.action ?? event.metadata?.outcome;
      const onOpen = run2 ? () => {
        setRunId(run2.id);
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
    const run = runs.find(({ id }) => id === runId);
    if (run) return h(
      "div",
      null,
      h("div", { className: "bees-row" }, h(Button, { onClick: () => setRunId("") }, "← Runs"), h("strong", null, runTitle(data, run)), h("div", { className: "bees-grow" }), h("span", { className: `bees-status bees-${run.status}` }, run.status)),
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
      { className: "bees-row bees-nav-link", key: row.id, onClick: () => setRunId(row.id) },
      h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, runTitle(data, row)), h("div", { className: "bees-muted" }, [data.assignments.find(({ id }) => id === row.resolvedAgentId)?.name, new Date(row.updatedAt).toLocaleString()].filter(Boolean).join(" · "))),
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
          setResults((await request(`/bees-api/search?q=${encodeURIComponent(query)}&workspaceId=${encodeURIComponent(workspaceId)}`)).results);
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
      h(FreeAiSettings, { ctx, modelSettings, preferences, systemDefault, ask, confirmAction, openExternal, Button }),
      h(LocalAiSettings, { modelSettings, preferences, systemDefault, ask, confirmAction, Button }),
      h(ExternalLocalAiSettings, { modelSettings, preferences, systemDefault, ask, Button }),
      h(CustomAiSettings, { ctx, modelSettings, preferences, systemDefault, ask, confirmAction, openExternal, Button })
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
    const matches2 = ({ name }) => !needle || name.toLocaleLowerCase().includes(needle);
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
    const organizations = data.organizations.filter(matches2);
    const teams = data.teams.filter((row) => row.organizationId === organizationId && matches2(row));
    const workspaces = data.workspaces.filter((row) => row.teamId === teamId && matches2(row));
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
    const [runId, setRunId] = useState("");
    const load = async () => {
      try {
        const value = await request("/bees-api/snapshot");
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
      setRunId("");
      void preferences.set("lastScope", next);
    };
    const parts = data ? scopeParts(data, scope) : { workspaceId: "", teamId: "", organizationId: "" };
    const workspaceIds = data ? parts.workspaceId ? [parts.workspaceId] : data.workspaces.filter(({ teamId }) => teamId === parts.teamId).map(({ id }) => id) : [];
    const act = async (command) => {
      try {
        const result = await request("/bees-api/command", { method: "POST", body: JSON.stringify(command) });
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
      if (result?.executionId) {
        setRunId(result.executionId);
        setRoute("runs");
      }
      return result;
    };
    const navigate = (id) => {
      if (id === "dsh-settings") {
        document.querySelector('button[aria-haspopup="dialog"][aria-expanded]')?.click();
        return;
      }
      if (id === "home") void preferences.set("activeDashboardId", "home");
      const section2 = NAVIGATION.find((row) => row.id === id);
      setRoute(section2 ? section2.defaultChild : id);
      setProcessId("");
      setWorkItemId("");
      setCreating("");
      setProcessDraft(null);
      setWorkProcessId("");
      setRunId("");
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
    const capabilities = useCapabilities();
    const localAi = h(LocalAiController, { modelSettings, preferences, onError: setError });
    const freeAi = h(FreeAiController, { modelSettings, onError: setError });
    if (!data) return h(
      React.Fragment,
      null,
      localAi,
      freeAi,
      h("div", { className: "bees-app bees-loading" }, error || "Opening Bees…")
    );
    const dashboards = dashboardsFrom(preference.dashboards);
    const activeDashboard = dashboards.find(({ id }) => id === preference.activeDashboardId) ?? dashboards[0];
    const section = sectionFor(route);
    const routeLabel = route === "home" ? activeDashboard.name : section.children.find(([id]) => id === route)?.[1] ?? section.label;
    const pins = (preference.pins ?? []).filter((id) => navigationItem(id));
    const setPins = (next) => preferences.set("pins", next);
    const openProcess = (id) => {
      setRoute("all-processes");
      setProcessId(id);
      setWorkItemId("");
      setCreating("");
    };
    const openRun = (id) => {
      setRoute("runs");
      setRunId(id);
      setProcessId("");
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
        if (targetRoute === "presets") return data.presets.map((row) => ({ id: row.id, label: row.name, open: openRoute }));
        if (targetRoute === "mcp") return (capabilities.data?.servers ?? []).map((row) => ({ id: row.id, label: row.label, open: openRoute }));
        if (targetRoute === "pools") return data.pools.filter((row) => workspaceIds.includes(row.workspaceId)).map((row) => ({ id: row.id, label: row.name, open: openRoute }));
        return assignments.map((row) => ({ id: row.id, label: row.name, open: openRoute }));
      }
      if (target.id === "files" || targetRoute === "sources") return data.locations.filter((row) => row.teamId === parts.teamId && !row.archivedAt).map((row) => ({ id: row.id, label: row.name, open: openRoute }));
      if (targetRoute === "runs") return data.runs.filter((row) => workspaceIds.includes(row.workspaceId)).map((row) => ({
        id: row.id,
        label: runTitle(data, row),
        open: () => openRun(row.id)
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
    const page = route === "home" ? h(Home, {
      data,
      workspaceId: parts.workspaceId,
      workspaceIds,
      act,
      openWorkItem,
      navigate,
      rowsForRoute: pinnedRows,
      preference,
      preferences
    }) : route === "guide" ? h(GuidePage) : section.id === "work" ? route === "waiting" ? h(NeedsYouPage, { ctx, data, workspaceIds, openWorkItem, openRun }) : h(WorkPage, { ctx, data, route, workspaceIds, workspaceId: parts.workspaceId, teamId: parts.teamId, workItemId, setWorkItemId, creating, setCreating, defaultProcessId: workProcessId, act }) : section.id === "processes" ? h(ProcessesPage, { data, route, workspaceIds, workspaceId: parts.workspaceId, teamId: parts.teamId, processId, setProcessId, openWorkItem, creating, setCreating, processDraft, setProcessDraft, act }) : route === "skills" ? h(SkillsPage, { capabilities, onAddTools: () => navigate("mcp") }) : route === "mcp" ? h(McpPage, { ctx, capabilities }) : section.id === "agents" ? h(AgentsPage, { ctx, data, servers: capabilities.data?.servers ?? [], route, workspaceIds, workspaceId: parts.workspaceId, creating, setCreating, act, openDshSettings: () => navigate("dsh-settings") }) : section.id === "files" ? h(FilesPage, { ctx, data, route, teamId: parts.teamId, act }) : section.id === "activity" ? h(ActivityPage, { data, route, workspaceIds, setRoute, openWorkItem, openProcess, runId, setRunId }) : section.id === "knowledge" ? h(KnowledgePage, { data, route, workspaceId: parts.workspaceId, teamId: parts.teamId }) : h(SettingsPage, { ctx, data, route, workspaceId: parts.workspaceId, teamId: parts.teamId, organizationId: parts.organizationId, modelSettings, preferences, reload: load });
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
              item.children.length > 0 || item.id === "home" ? h(
                "div",
                { className: "bees-nav-flyout" },
                ...item.id === "home" ? dashboards.map((dashboard) => h(
                  "div",
                  { className: `bees-nav-flyout-item ${route === "home" && activeDashboard.id === dashboard.id ? "active" : ""}`, key: `dashboard:${dashboard.id}` },
                  h("button", {
                    className: `bees-nav-link bees-nav-child ${route === "home" && activeDashboard.id === dashboard.id ? "active" : ""}`,
                    onClick: () => {
                      void preferences.set("activeDashboardId", dashboard.id);
                      setRoute("home");
                    }
                  }, dashboard.name)
                )) : [],
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
        h("main", { className: "bees-content" }, h("div", { className: `bees-panel ${route === "home" || section.id === "work" && workItemId ? "bees-panel-wide" : ""}` }, page))
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
        style.textContent = `${gridstack_min_default}
${css}`;
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
