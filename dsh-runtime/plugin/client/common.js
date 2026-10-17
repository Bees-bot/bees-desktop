import { h } from "./runtime.js";
export const css = `
.bees-widget-tooltip-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  cursor: help;
  color: var(--dsw-alias-label-secondary);
}
.bees-widget-tooltip {
  visibility: hidden;
  position: absolute;
  z-index: 1000;
  top: 100%;
  right: 0;
  width: 280px;
  margin-top: 8px;
  padding: 12px;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.4;
  white-space: normal;
  font-weight: normal;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s, visibility 0.2s;
}
.bees-widget-tooltip-wrapper:hover .bees-widget-tooltip {
  visibility: visible;
  opacity: 1;
}
.bees-widget-tooltip p { margin: 0 0 8px 0; }
.bees-widget-tooltip p:last-child { margin-bottom: 0; }
.bees-widget-tooltip ul { margin: 0; padding-left: 16px; }
.bees-widget-tooltip li { margin-bottom: 4px; }

.bees-native-widgets{display:flex;height:65vh;min-height:320px;min-width:0;overflow:hidden;contain:layout paint;isolation:isolate}
.bees-native-main{flex:1;min-width:0;max-width:100%;height:100%}
.bees-embedded-rightbar{flex:0 1 auto;max-width:40%;min-width:0}
@media(max-width:800px){.bees-native-widgets{flex-direction:column}.bees-native-main{min-height:240px}.bees-embedded-rightbar{width:100%!important;max-width:none;flex:1;min-height:0}}
/* DSH's own conversation screen, hosted inside the Details "Chat" tab. It stays mounted even
   when another Details tab is active (see DshRunPanels); only this display toggle follows it. */
.bees-dsh-tab{min-height:0}
.bees-work-details-toolbar{display:flex;justify-content:flex-end;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
.bees-work-details-toolbar label{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px}
.bees-work-details-toolbar select{width:auto;font-size:12px}
.bees-app [hidden]{display:none!important}
.bees-ask-setup{max-width:none;margin:0;padding:4px 0;min-width:0}
.bees-ask-heading{padding:14px 0 12px}.bees-ask-heading h1{font-size:28px;margin:6px 0 6px}.bees-ask-heading h1:focus{outline:none}
.bees-ask-step{color:var(--bees-accent);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em}
.bees-ask-setup .bees-box{padding:12px}.bees-ask-setup .bees-cockpit-board{padding:4px 0!important}
@media(max-width:760px){.bees-ask-heading h1{font-size:24px}}
.bees-flex-widget-borderless .bees-column {
  border: none !important;
}
.bees-flex-widget-borderless .bees-column-head {
  border-bottom: none !important;
}

.bees-flex-widget-borderless {
  border: none !important;
  background: var(--dsw-alias-bg-base) !important; box-shadow: 0 1px 3px rgba(0,0,0,0.2) !important;
  box-shadow: none !important;
}
.bees-flex-widget-borderless .bees-flex-widget-body {
  padding: 0 !important;
  overflow: visible;
}
.bees-flex-widget-borderless .bees-cockpit-board {
  padding: 12px 14px !important;
}

.bees-dot-typing-container {
  display: inline-block;
  position: relative;
  width: 24px;
  height: 6px;
  margin-right: 8px;
}
.bees-dot-typing-container::before, .bees-dot-typing-container::after {
  content: "";
  position: absolute;
  top: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-label-secondary);
  animation: bees-typing 1.4s infinite ease-in-out both;
}
.bees-dot-typing-container::before { left: 0; animation-delay: -0.32s; }
.bees-dot-typing-container::after { left: 16px; animation-delay: 0s; }
.bees-dot-typing-dot {
  position: absolute;
  top: 0;
  left: 8px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-label-secondary);
  animation: bees-typing 1.4s infinite ease-in-out both;
  animation-delay: -0.16s;
}

@keyframes bees-typing {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

.bees-convo-msg-interactive {
  max-width: 100% !important;
  width: 100%;
  padding: 0 !important;
  background: var(--dsw-alias-bg-base) !important; box-shadow: 0 1px 3px rgba(0,0,0,0.2) !important;
  border: none !important;
}
.bees-convo-msg-interactive > .bees-box, .bees-convo-msg-interactive > .bees-answer-card {
  margin: 0;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
}
.bees-working-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  font-style: italic;
  gap: 4px;
}


.bees-convo-msg-interactive { max-width: 100%; width: 100%; padding: 0; background: var(--dsw-alias-bg-base) !important; box-shadow: 0 1px 3px rgba(0,0,0,0.2) !important; border: none !important; }
.bees-convo-msg-interactive > .bees-box, .bees-convo-msg-interactive > .bees-answer-card { margin: 0; border-radius: 12px; border: 1px solid #8A6B27; background: #3D3014; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
.bees-convo-msg-interactive .bees-answer-card h2 { color: #fff; font-size: 16px; margin: 0; }
.bees-convo-msg-interactive .bees-choice { background: #2A2A2A; border-color: #444; color: #fff; }
.bees-convo-msg-interactive .bees-choice:hover { background: #333; }
.bees-convo-msg { padding: 16px; border-radius: 12px; white-space: pre-wrap; font-size: 14px; line-height: 1.5; max-width: 100%; width: 100%; box-sizing: border-box; }
.bees-convo-msg.user { align-self: stretch; background: var(--dsw-alias-interactive-bg-hover); border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); border-radius: 12px; max-width: 100%; }
.bees-convo-msg.agent { align-self: stretch; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; color: var(--dsw-alias-label-primary); max-width: 100%; }
.bees-convo-msg.system { align-self: stretch; background: transparent; color: #888; font-size: 13px; text-align: left; display: flex; align-items: center; gap: 8px; padding: 4px 16px; border: none; max-width: 100%; }
.bees-convo-msg > strong { display: block; margin-bottom: 4px; font-size: 12px; font-weight: 500; color: #aaa; }
/* the markdown puts a newline between blocks, which pre-wrap shows as a blank line */
.bees-convo-msg [class*="_markdown_"] { white-space: normal; }
.bees-convo-msg [class*="_markdown_"] p { white-space: pre-wrap; }
.bees-working-indicator { display: flex; align-items: center; justify-content: center; padding: 12px; font-style: italic; gap: 4px; }


.bees-panel-wide { max-width: none; }
.bees-panel-full-height { height: 100%; display: flex; flex-direction: column; min-height: 0; flex: 1; }
.bees-cockpit-board { flex-shrink: 0; margin-bottom: 16px; }
.bees-convo-panel { display: flex; flex-direction: column; overflow: hidden; background: transparent; border-radius: 12px; }
.bees-convo-history { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding: 4px; padding-bottom: 20px; align-items: stretch; }
.bees-details-panel { display: flex; flex-direction: column; overflow: hidden; }
.bees-details-panel > .bees-box { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.bees-tab-panel { flex: 1; overflow-y: auto; }
.bees-convo-msg { max-width: 100%; padding: 12px 16px; border-radius: 12px; white-space: pre-wrap; font-size: 14px; line-height: 1.5; box-sizing: border-box; }
.bees-convo-msg.user { align-self: stretch; background: #f2b84b33; border: 1px solid #f2b84b55; color: inherit; border-bottom-right-radius: 4px; max-width: 100%; }
.bees-convo-msg.agent { align-self: stretch; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-bottom-left-radius: 4px; max-width: 100%; }
.bees-convo-msg.system { align-self: stretch; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12px; text-align: left; max-width: 100%; }
.bees-convo-msg > strong { display: block; margin-bottom: 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.7; }


  .bees-dashboard{min-width:0}.bees-dashboard-add{position:relative}.bees-dashboard-add>summary{list-style:none}.bees-dashboard-add>summary::-webkit-details-marker{display:none}.bees-dashboard-widget-menu{position:absolute;right:0;top:42px;z-index:120;width:290px;max-height:min(480px,70vh);overflow:auto;display:grid;gap:3px;padding:7px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-base);box-shadow:0 14px 35px #0004}.bees-dashboard-widget-menu button{display:grid;gap:2px;padding:9px;border:0;border-radius:8px;color:inherit;background:transparent;text-align:left;font:inherit;cursor:pointer}.bees-dashboard-widget-menu button:hover{background:var(--dsw-alias-interactive-bg-hover)}.bees-dashboard-widget-menu span{color:var(--dsw-alias-label-secondary);font-size:11px}
  .bees-dashboard-grid{margin:-6px}.bees-dashboard-grid .bees-flex-widget-body{padding:11px}.bees-dashboard-grid .bees-flex-widget-body>.bees-empty{padding:20px;border:0;border-radius:0;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center}.bees-dashboard-remove{display:grid;place-items:center;width:24px;height:24px;margin-left:auto;border:0;border-radius:7px;color:var(--dsw-alias-label-secondary);background:transparent;font:20px/1 inherit;cursor:pointer}.bees-dashboard-remove:hover{color:#d15353;background:var(--dsw-alias-interactive-bg-hover)}
  .bees-dashboard-composer{height:100%;margin:0 !important;padding:0 !important;border:none !important;box-shadow:none !important;background:transparent !important;position:relative}
  .bees-dashboard-composer .bees-composer-input{min-height:0 !important;flex:1 1 0 !important;resize:none !important;overflow-y:auto !important;padding:12px 12px 48px 12px !important;}
  .bees-dashboard-composer:focus-within{box-shadow:none !important;border-color:transparent !important;}.bees-dashboard-composer .bees-error{margin:0}.bees-dashboard-list{display:grid;gap:3px}.bees-dashboard-row{width:100%;padding:10px 12px;border:1px solid transparent;border-radius:10px;color:inherit;background:transparent;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;font:inherit;cursor:pointer;font-size:13px;transition:background 0.15s, border-color 0.15s}.bees-dashboard-row:hover,.bees-dashboard-row.active{background:var(--dsw-alias-bg-base);border-color:var(--dsw-alias-border-l1);box-shadow:0 2px 6px rgba(0,0,0,0.03)}.bees-dashboard-need-row{display:grid;grid-template-columns:minmax(0,1fr) 30px;gap:3px}.bees-dashboard-need-row .bees-dashboard-row{display:flex;align-items:center;gap:7px}.bees-dashboard-need-copy{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis}.bees-dashboard-launch{display:grid;place-items:center;width:32px;border:0;border-radius:8px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base);font:16px/1 inherit;cursor:pointer}.bees-dashboard-launch:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.bees-dashboard-needs-answer{margin-top:8px}.bees-dashboard-needs .bees-answer-card{min-height:0;padding:12px}.bees-dashboard-needs .bees-answer-head h2{font-size:15px}.bees-dashboard-needs .bees-file-preview{max-height:min(320px,40vh)}/* rows scrolled straight through this button because it had no fill, and under it because the body pads 11px below, so it sits over that padding and paints the widget's own colour */
  .bees-dashboard-view-all{display:block;width:100%;margin-top:4px;padding:10px 0 2px;border:0;border-top:1px solid var(--dsw-alias-border-l1);color:var(--bees-accent);background:transparent;text-align:center;text-decoration:none;font-family:inherit;font-size:13px;font-weight:600;line-height:1.4;cursor:pointer}.bees-dashboard-view-all:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}.bees-dashboard-quick-actions .bees-dashboard-row{white-space:normal;overflow-wrap:anywhere;padding:9px 10px}.bees-dashboard-proposal{padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base)}.bees-dashboard-proposal p{margin:4px 0}.bees-dashboard .bees-home-templates{gap:7px}.bees-dashboard .bees-template-card{padding:10px}
  .bees-composer { display: flex; flex-direction: column; gap: 10px; background: var(--dsw-alias-bg-base); border: 1px solid transparent; border-radius: 16px; padding: 16px; box-shadow: 0 4px 16px rgba(0,0,0,0.04), 0 0 0 1px var(--dsw-alias-border-l1); transition: border-color 0.2s, box-shadow 0.2s; }
  .bees-composer:focus-within { box-shadow: 0 0 0 1px var(--bees-accent), 0 0 0 4px var(--bees-accent-soft), 0 8px 24px rgba(0,0,0,0.06); }
  .bees-composer-input { border: 0; background: transparent; font-size: 16px; min-height: 120px; outline: none; resize: vertical; font-family: inherit; color: inherit; line-height: 1.5; padding: 0; }
  .bees-composer-input::placeholder { color: var(--dsw-alias-label-secondary); }
  .bees-composer-foot { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  .bees-composer-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); }
  
  .bees-home-templates { display: grid; gap: 8px; }
  .bees-template-card { display: flex; flex-direction: column; gap: 5px; padding: 14px 16px; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; cursor: pointer; text-align: left; transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s; color: inherit; font: inherit; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
  .bees-template-card:hover { border-color: var(--bees-accent); box-shadow: 0 4px 12px rgba(0,0,0,0.05); transform: translateY(-1px); }
  .bees-template-card-title { font-weight: 600; font-size: 14px; }
  .bees-template-card-meta { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.4; }
  
  /* Keep host chrome hidden; native conversation/file panels render through Bees' portal targets. */
  :has(>[data-shell-overlay])>:not([data-shell-overlay]){visibility:hidden;pointer-events:none}
  .bees-app{--bees-accent:#10b981;--bees-accent-soft:#10b98120;--bees-accent-contrast:#04130d;position:absolute;inset:0;z-index:90;display:grid;grid-template-columns:280px 1fr;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji";pointer-events:auto}
  .bees-app *{box-sizing:border-box}.bees-sidebar{min-width:0;min-height:0;display:flex;flex-direction:column;border-right:none;box-shadow:1px 0 0 var(--dsw-alias-border-l1);background:var(--dsw-specific-sidebar-fill);overflow:visible}.bees-brand{display:flex;align-items:center;gap:9px;padding:18px 16px 14px;font-size:20px;font-weight:800;letter-spacing:-0.01em}.bees-mark{display:grid;place-items:center;flex:none;width:28px;height:28px;border-radius:9px;background:#f2b84b;color:#21190b}.bees-brand-settings{margin-left:auto}.bees-brand-settings-button,.bees-team-settings,.bees-scope-add,.bees-org-tile,.bees-team-name{border:0;color:inherit;background:transparent;font:inherit;cursor:pointer}.bees-brand-settings-button{display:grid;place-items:center;width:30px;height:30px;padding:0;border-radius:8px;color:var(--dsw-alias-label-secondary)}.bees-brand-settings-button:hover,.bees-brand-settings.active .bees-brand-settings-button{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.bees-brand-settings-button svg{width:17px;height:17px}.bees-brand-settings .bees-nav-flyout{top:calc(100% + 4px);right:0;left:auto;min-width:220px}.bees-org-tile:hover,.bees-scope-add{display:grid;place-items:center;color:var(--dsw-alias-label-secondary);font-size:20px;line-height:1}.bees-scope-add:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.bees-scope-add:disabled{opacity:.4;cursor:not-allowed}.bees-team-heading{display:flex;align-items:center;min-height:26px;margin-top:2px;padding-left:7px;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}.bees-team-heading span{min-width:0;flex:1}.bees-team-heading .bees-scope-add{width:28px;height:26px;border-radius:7px}.bees-team-row:hover{background:var(--dsw-alias-interactive-bg-hover)}.bees-team-name{min-width:0;flex:1;padding:7px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}.bees-team-row.active .bees-team-name{font-weight:700}.bees-team-settings{display:grid;place-items:center;flex:none;width:30px;height:30px;margin-right:3px;border-radius:7px;color:var(--dsw-alias-label-secondary);opacity:1;transition:color 0.15s, background 0.15s}.bees-team-settings:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-floating-hover)}.bees-team-settings svg{width:15px;height:15px}.bees-scope-switcher{display:flex;min-height:0;flex:1;flex-direction:column;gap:9px;margin:0 11px 10px}.bees-org-tiles{display:flex;flex-wrap:wrap;gap:8px;padding:7px 3px;flex:none}.bees-org-tile{display:grid;place-items:center;flex:0 0 34px;width:34px;height:34px;border:2px solid transparent;border-radius:12px;color:white;background:var(--bees-org-color,var(--dsw-alias-bg-base));font-weight:800;font-size:13px;box-shadow:0 1px 3px #0004;transition:filter 0.15s,box-shadow 0.15s}.bees-org-tile.active{border-color:var(--bees-accent);background:var(--bees-org-color);box-shadow:0 0 0 2px var(--dsw-alias-bg-base),0 0 0 4px var(--bees-accent)}.bees-team-list{display:grid;gap:5px;overflow:auto;align-content:start;min-height:0;padding:1px}.bees-team-row{display:flex;align-items:center;border-radius:8px;min-height:38px}
  .bees-org-tile:hover{filter:brightness(1.12)}.bees-org-tile.bees-scope-add{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:transparent;filter:none}.bees-scope-add svg{width:14px;height:14px;transform:rotate(45deg)}.bees-org-summary{display:grid;gap:3px;min-width:0;padding:7px 8px 9px;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-org-summary-title{display:flex;align-items:center;gap:7px;min-width:0}.bees-org-summary-title strong{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-org-summary-title .bees-badge{flex:none}.bees-org-summary-meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:11px}.bees-team-section{overflow:visible;border:none;border-radius:10px}.bees-team-section.active{}.bees-team-section.expanded{}.bees-team-toggle{display:flex;align-items:center;min-width:0;flex:1;gap:8px;padding:7px 6px;border:0;color:inherit;background:transparent;text-align:left;font:inherit;cursor:pointer;border-radius:7px}.bees-team-initial{display:grid;place-items:center;flex:none;width:22px;height:22px;border-radius:6px;background:color-mix(in srgb,var(--bees-accent) 20%,var(--dsw-alias-interactive-bg-hover));font-size:10px;font-weight:800;color:var(--bees-accent)}.bees-team-section.active .bees-team-initial{background:var(--bees-accent);color:var(--bees-accent-contrast)}.bees-team-toggle .bees-team-name{min-width:0;flex:1;padding:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-team-section.active .bees-team-name{font-weight:750}
.bees-team-section.active .bees-team-row{background:var(--bees-accent-soft)}.bees-team-nav{display:grid;gap:3px;padding:5px 4px 8px}.bees-team-nav .bees-nav-link{padding-block:6px;font-size:14px}.bees-team-nav .bees-nav-link>span:first-child{width:18px!important}.bees-team-nav .bees-nav-menu{display:block}.bees-team-nav .bees-nav-flyout{position:static;min-width:0;margin:1px 0 5px 24px;padding:1px 0 1px 7px;border:0;background:transparent;box-shadow:none;pointer-events:auto;opacity:1}
  .bees-nav-menu{display:flex;align-items:center;position:relative;border-radius:8px;transition:background 0.1s}.bees-nav-menu .bees-nav-link{min-width:0;flex:1}.bees-nav-link{min-width:0;display:flex;align-items:center;gap:9px;width:100%;border:0;border-radius:8px;padding:7px 9px;color:inherit;background:transparent;text-align:left;font:inherit;cursor:pointer;transition:background 0.1s, color 0.1s}.bees-nav-link:hover{background:var(--dsw-alias-interactive-bg-hover)}.bees-nav-link:focus-visible{outline:2px solid var(--bees-accent);outline-offset:1px}.bees-nav-link.active{font-weight:750;color:var(--bees-accent);background:color-mix(in srgb,var(--bees-accent) 10%,var(--dsw-alias-interactive-bg-hover))}.bees-nav-link span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}.bees-nav-child{display:flex;padding:6px 8px;font-size:14px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color 0.1s;background:transparent !important;border-radius:6px}.bees-nav-child:hover{color:var(--dsw-alias-label-primary)}
.bees-nav-child.active{color:var(--bees-accent);font-weight:750}.bees-dashboard-item{display:flex;align-items:center;min-width:0;border-radius:8px;transition:background 0.1s}.bees-dashboard-item:hover{background:var(--dsw-alias-interactive-bg-hover)}.bees-dashboard-item.active{background:color-mix(in srgb,var(--bees-accent) 10%,var(--dsw-alias-interactive-bg-hover))}.bees-dashboard-item .bees-dashboard-link{min-width:0;flex:1}.bees-dashboard-item .bees-dashboard-link:hover,.bees-dashboard-item .bees-dashboard-link.active{background:transparent}.bees-dashboard-item .bees-dashboard-action{display:grid;place-items:center;flex:none;width:26px;height:26px;margin-left:0;padding:0;border:0;border-radius:7px;color:var(--dsw-alias-label-secondary);background:transparent;cursor:pointer;opacity:0;transition:opacity 0.15s, color 0.15s, background 0.15s}.bees-dashboard-item:hover .bees-dashboard-action,.bees-dashboard-item:focus-within .bees-dashboard-action{opacity:1}.bees-dashboard-action:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.bees-dashboard-item .bees-dashboard-remove:hover{color:#d15353}.bees-dashboard-action svg{width:13px;height:13px}.bees-sidebar-foot{display:grid;gap:3px;margin-top:auto;padding:11px;border-top:1px solid var(--dsw-alias-border-l1)}.bees-sidebar-foot .bees-nav-link.active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.bees-accounts-link{font-size:15px;font-weight:650;margin-top:3px;padding-block:10px}.bees-account-avatars{display:flex;align-items:center}.bees-account-avatar{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--bees-accent);color:var(--bees-accent-contrast);font-size:11px;font-weight:bold;margin-left:-8px;border:2px solid var(--dsw-specific-sidebar-fill)}.bees-account-avatar:first-child{margin-left:0}@keyframes bees-spin{to{transform:rotate(360deg)}}.bees-spinner{animation:bees-spin 1s linear infinite;color:var(--bees-accent)}
  .bees-nav-flyout{position:absolute;left:calc(100% - 4px);top:0;z-index:100;min-width:180px;display:grid;gap:2px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);box-shadow:0 8px 30px #0003;pointer-events:none;opacity:0;transition:opacity 0.1s}.bees-nav-menu:hover .bees-nav-flyout,.bees-nav-menu:focus-within .bees-nav-flyout{pointer-events:auto;opacity:1}.bees-nav-flyout-item{display:flex;align-items:center;border-radius:8px}.bees-nav-flyout-item .bees-nav-link{padding-left:9px;font-size:15px;color:var(--dsw-alias-label-primary)}
  .bees-basics{max-width:900px;margin:0 auto;line-height:1.65}.bees-basics h1{font-size:28px;line-height:1.2;margin:10px 0}.bees-basics h2{font-size:18px;line-height:1.35}.bees-basics p{margin:10px 0}.bees-basics li{margin:5px 0}.bees-basics summary{cursor:pointer;font-weight:650}.bees-basics summary:focus-visible,.bees-basics-table:focus-visible{outline:2px solid var(--bees-accent);outline-offset:4px}.bees-basics details{margin-top:12px}.bees-basics-flow{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:8px;padding:0;list-style-position:inside}.bees-basics-flow li{padding:10px;border-radius:8px;background:var(--bees-accent-soft);font-weight:600}.bees-basics-table{overflow-x:auto}.bees-basics table{width:100%;border-collapse:collapse;font-size:13px}.bees-basics caption{text-align:left;color:var(--dsw-alias-label-secondary);margin:4px 0 8px}.bees-basics th,.bees-basics td{text-align:left;vertical-align:top;padding:10px 8px;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-basics th[scope="row"]{width:24%}.bees-basics-actions{display:flex;flex-wrap:wrap;gap:10px;padding:8px 0 20px}
  .bees-onboarding{width:100%;max-width:960px;margin:auto}.bees-onboarding h1{font-size:28px;line-height:1.2;margin:0 0 12px}.bees-onboarding-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}.bees-onboarding-steps button{text-align:left;color:inherit;font:inherit;cursor:pointer;display:flex;flex-direction:column;gap:12px;margin:0}.bees-onboarding-steps button.active{border-color:var(--bees-accent);background:var(--bees-accent-soft)}.bees-onboarding-steps button:focus-visible{outline:2px solid var(--bees-accent);outline-offset:2px}.bees-onboarding-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:12px 18px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--bees-accent-soft);flex-shrink:0}.bees-onboarding-bar .bees-muted{font-size:12px}.bees-onboarding .bees-card-actions{flex-wrap:wrap}.bees-onboarding textarea{min-height:120px}@media(max-width:800px){.bees-onboarding-bar{padding:10px}}
  .bees-main{min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}.bees-top{height:auto;min-height:54px;display:flex;align-items:center;gap:8px;padding:0 20px;padding-block:8px;border-bottom:none;box-shadow:0 1px 0 var(--dsw-alias-border-l1)}.bees-title{font-size:17px;font-weight:800;min-width:0;overflow-wrap:break-word}.bees-context{color:var(--dsw-alias-label-secondary);font-size:12px}.bees-grow{flex:1}.bees-top>.bees-btn,.bees-top>.bees-page-actions .bees-btn,.bees-theme-toggle{height:44px;min-height:44px}.bees-top>.bees-page-actions .bees-btn{padding:10px 16px;font-size:14px}.bees-top>.bees-btn:first-child{padding:6px 12px;border:0;color:var(--dsw-alias-label-secondary);background:transparent;box-shadow:none}.bees-top>.bees-btn:first-child:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.bees-theme-toggle{display:grid;place-items:center;flex:none;width:44px;padding:0;border:0;border-radius:10px;color:var(--dsw-alias-label-secondary);background:transparent;box-shadow:none;cursor:pointer}.bees-theme-toggle:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.bees-theme-toggle svg{width:19px;height:19px}.bees-theme-toggle:focus-visible{outline:2px solid var(--bees-accent);outline-offset:1px}.bees-content{min-height:0;flex:1;overflow:auto;padding:24px 28px;display:flex;flex-direction:column}.bees-panel{width:100%;flex:1;min-height:0;display:flex;flex-direction:column}
  .bees-btn,.bees-select,.bees-input,.bees-textarea{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;background:var(--dsw-alias-bg-base);font:inherit;box-shadow:0 1px 2px rgba(0,0,0,0.03);transition:border-color 0.15s, box-shadow 0.15s}.bees-btn{display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;min-height:34px;cursor:pointer;vertical-align:middle}.bees-btn:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l1)}
.bees-select:focus,.bees-input:focus,.bees-textarea:focus{border-color:var(--bees-accent);outline:none;box-shadow:0 0 0 3px var(--bees-accent-soft)}.bees-btn.danger{color:#d15353}.bees-btn:disabled{opacity:.5;cursor:not-allowed}.bees-select,.bees-input{padding:8px 12px;min-height:34px}
.bees-select{appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M5%207.5L10%2012.5L15%207.5%22%20stroke%3D%22%23888%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E");background-repeat:no-repeat;background-position:right 8px center;padding-right:32px}
.bees-textarea{padding:10px 12px}input[type=file]{color:var(--dsw-alias-label-secondary);font:inherit}input[type=file]::file-selector-button{margin-right:10px;padding:6px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;color:inherit;background:var(--dsw-alias-bg-base);font:inherit;cursor:pointer}.bees-input,.bees-textarea{width:100%}.bees-textarea{min-height:88px;resize:vertical}
  .bees-row{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap}.bees-work-item-row{width:100%;padding-inline:8px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);color:inherit;background:transparent;font:inherit;text-align:left;cursor:pointer}.bees-work-item-row:hover{background:var(--dsw-alias-interactive-bg-hover)}.bees-work-item-row .bees-row-title,.bees-work-item-row .bees-muted{display:block}.bees-row-main{min-width:0;flex:1}.bees-row-title{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-muted{color:var(--dsw-alias-label-secondary);font-size:12px}.bees-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px}.bees-box{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;background:var(--dsw-alias-bg-base)}.bees-box h2,.bees-box h3{margin:0 0 9px}.bees-empty{border:none;padding:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:120px;text-align:center;color:var(--dsw-alias-label-secondary);grid-column:1 / -1}.bees-error{margin:10px 18px 0;padding:9px 12px;border-radius:8px;background:#a9363622;color:#d45d5d}.bees-form .bees-error,.bees-modal .bees-error{margin:0}.bees-status{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--dsw-alias-label-secondary)}.bees-running{color:#2e9b61}.bees-failed{color:#cf5b5b}.bees-cancelled{color:#8a8a8a}
  .bees-change{margin:7px 0;padding:9px;border-radius:8px;background:var(--dsw-alias-bg-base)}.bees-proposal-changes{margin:6px 0 0;padding-left:18px;font-size:12px;color:var(--dsw-alias-label-secondary)}
  .bees-board{padding-bottom:12px}.bees-column-head{display:flex;padding:12px 16px;font-weight:750;opacity:0.6;font-size:12px;text-transform:uppercase;letter-spacing:0.05em}.bees-count{margin-left:auto;color:var(--dsw-alias-label-secondary)}.bees-cards{display:grid;gap:8px;padding:8px 16px}.bees-cards .bees-empty{align-items:flex-start;justify-content:flex-start;text-align:left;padding:4px 0;min-height:0;border:none !important}.bees-cards .bees-empty .bees-empty-icon{display:none !important}.bees-card-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.bees-card-actions .bees-btn{padding:4px 7px;font-size:11px}
  .bees-routing-board{padding-bottom:4px}.bees-routing-board .bees-form,.bees-routing-board .bees-row,.bees-routing-board .bees-row-main{min-width:0}.bees-routing-board .bees-row{align-items:flex-start;flex-wrap:wrap}.bees-routing-board .bees-row-main{flex-basis:100%;overflow-wrap:anywhere}.bees-routing-board .bees-row>.bees-select{min-width:0;flex:1 1 130px}.bees-route-card,.bees-route-field{min-width:0}.bees-route-field{display:grid;gap:6px}.bees-route-control,.bees-route-agent{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px}.bees-route-control .bees-select{min-width:0;width:100%}.bees-route-agent{padding:4px 0}.bees-route-agent-link{min-width:0;overflow:hidden;border:0;color:inherit;background:transparent;text-align:left;text-overflow:ellipsis;white-space:nowrap;font:inherit;font-weight:650;cursor:pointer}.bees-route-agent-link:hover{text-decoration:underline}.bees-route-card>.bees-btn{width:100%}
  .bees-capability-row .bees-row-main{overflow:hidden}.bees-capability-description{margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-capability-manage>summary,.bees-capability-group>summary,.bees-capability-custom>summary{cursor:pointer;font-weight:700}.bees-capability-group{border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-capability-group:last-child{border-bottom:0}.bees-capability-group>summary{display:flex;align-items:center;gap:10px;padding:13px 2px;list-style:none}.bees-capability-group>summary::-webkit-details-marker{display:none}.bees-capability-group>summary::before{content:"›";color:var(--dsw-alias-label-secondary);font-size:18px;transition:transform .15s}.bees-capability-group[open]>summary::before{transform:rotate(90deg)}.bees-capability-group>summary>.bees-muted{margin-left:auto;font-weight:400}.bees-capability-group>.bees-row{padding-left:28px}.bees-capability-note{padding-left:28px}.bees-capability-custom{margin-top:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}
  .bees-search{display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap}
  .bees-prompt{width:min(540px,calc(100vw - 32px));color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:0;box-shadow:0 18px 60px #0006}.bees-prompt::backdrop{background:#0008}.bees-prompt form{display:grid;gap:14px;padding:20px}.bees-prompt label{white-space:pre-wrap;font-weight:700}.bees-prompt-checkbox{display:flex;align-items:center;gap:8px;font-weight:500!important;cursor:pointer}.bees-prompt-checkbox input{width:16px;height:16px;margin:0;accent-color:var(--bees-accent)}.bees-prompt-actions{display:flex;justify-content:flex-end;gap:8px}
  .bees-transcript{display:grid;gap:10px;margin-top:14px}.bees-message{padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-specific-sidebar-fill);white-space:pre-wrap}.bees-message strong{display:block;margin-bottom:5px;text-transform:capitalize}.bees-loading{grid-column:1/-1;display:grid;place-items:center;height:100%;color:var(--dsw-alias-label-secondary)}
  .bees-stack{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}.bees-form{display:grid;gap:10px}.bees-form>label{display:grid;gap:5px}.bees-form label:has(>input[type=checkbox]){display:flex;align-items:center;gap:8px}.bees-form-row{display:flex;align-items:end;gap:8px;flex-wrap:wrap}.bees-form-row label{display:grid;gap:5px;min-width:160px;flex:1}.bees-form-row .bees-btn{flex:0 0 auto}.bees-badge{display:inline-flex;padding:2px 7px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:10px;text-transform:uppercase}.bees-segmented{display:flex;gap:7px;flex-wrap:wrap}.bees-section-title{margin:20px 0 8px}.bees-section-title:first-child{margin-top:0}.bees-page-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}.bees-page-head h2{margin:0}.bees-callout{margin-bottom:14px;padding:12px 14px;border-left:3px solid #f2b84b;border-radius:8px;background:#f2b84b12}.bees-callout h3{margin:0 0 4px}.bees-help-grid h3{margin-bottom:4px}.bees-system-default{border:2px solid #f2b84b;background:linear-gradient(135deg,#f2b84b18,transparent 65%)}.bees-system-default .bees-btn{margin-bottom:1px}.bees-danger-zone{margin-top:16px;border-color:#d1535355}
  .bees-process-summary{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;white-space:normal}.bees-process-form{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;width:min(1200px,100%);margin:0 auto;padding-top:8px}.bees-process-name,.bees-process-actions{grid-column:1/-1}.bees-process-description textarea,.bees-process-stages textarea{min-height:140px}.bees-process-files,.bees-process-mcps{display:grid;align-content:start;gap:12px;min-width:0;padding-top:4px}.bees-process-files>.bees-resource-controls,.bees-process-files>.bees-resource-fields{min-width:0}.bees-process-actions{margin-top:0}
  @media(max-width:900px){.bees-process-form{grid-template-columns:1fr}.bees-process-name,.bees-process-actions{grid-column:auto}}
  .bees-resource-fields{display:grid;gap:9px;margin-top:6px}.bees-resource-fields h3{margin:0}.bees-resource-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:7px}.bees-resource-option{display:flex;align-items:flex-start;gap:8px;padding:9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;cursor:pointer}.bees-resource-option>span{display:grid;min-width:0}.bees-resource-option .bees-muted{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-output-field{display:grid;gap:7px;margin-top:6px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}
  .bees-hierarchy-card{display:block;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:11px;color:inherit;background:var(--dsw-alias-bg-base);text-align:left;font:inherit;cursor:pointer}.bees-hierarchy-card:hover,.bees-hierarchy-card.active{border-color:#f2b84b;background:#f2b84b12;box-shadow:0 2px 8px rgba(0,0,0,0.1)}.bees-hierarchy-card h3{margin:0 0 4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;white-space:normal;line-height:1.3}.bees-lineage{white-space:normal;overflow-wrap:anywhere}.bees-tab-actions{display:flex;flex:none;gap:6px;margin-left:auto}.bees-tab-actions .bees-btn{padding:5px 8px;font-size:12px}.bees-tab-panel{min-height:0}.bees-detail-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}dialog .bees-detail-actions, [role="dialog"] .bees-detail-actions{justify-content:flex-end}.bees-run-list{display:grid;gap:6px}.bees-run-row{display:flex;align-items:center;gap:8px;width:100%;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;color:inherit;background:transparent;text-align:left;cursor:pointer}.bees-run-row.active{border-color:#f2b84b}.bees-audit{border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-audit>summary{cursor:pointer;list-style-position:inside}.bees-audit>summary:hover{background:var(--dsw-alias-interactive-bg-hover)}.bees-audit>summary span{display:block}.bees-audit-detail{padding:0 12px 12px 27px}.bees-audit-detail pre{margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.bees-agent-form textarea{min-height:180px}
  .bees-resource-fields{min-width:0}.bees-resource-fields>.bees-resource-list,.bees-resource-input-list{grid-template-columns:minmax(0,1fr)}.bees-resource-fields h3{font-size:13px}.bees-resource-controls{display:flex;flex-wrap:wrap;gap:6px;min-width:0}.bees-resource-controls .bees-select{flex:1 1 180px;min-width:0;width:100%}.bees-resource-fields .bees-btn{padding:5px 8px;font-size:12px}.bees-resource-option{align-items:center;padding:6px;cursor:default}.bees-resource-copy{display:flex;align-items:center;gap:8px;min-width:0;flex:1}.bees-resource-copy>span{display:grid;min-width:0}.bees-resource-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-resource-option>.bees-btn{flex-shrink:0}.bees-resource-output{margin-top:22px;padding-top:18px;border-top:1px solid var(--dsw-alias-border-l1)}.bees-resource-inline-preview{grid-column:1/-1;min-width:0;margin-top:-7px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-left:3px solid var(--bees-accent);border-radius:0 0 10px 10px;background:var(--dsw-specific-sidebar-fill)}.bees-resource-output>.bees-resource-inline-preview{margin-top:3px}.bees-resource-inline-preview>.bees-file-preview{border:0;background:transparent}.bees-file-preview-head{display:flex;align-items:center;gap:8px}.bees-file-preview-head>strong{min-width:0;overflow:hidden;text-overflow:ellipsis;flex:1}.bees-file-preview .bees-resource-list .bees-btn{text-align:left;white-space:normal;overflow-wrap:anywhere}
  .bees-agent-dialog{width:min(860px,calc(100vw - 32px));max-height:calc(100vh - 32px);padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);box-shadow:0 20px 70px #0008}.bees-agent-dialog::backdrop{background:#0009}.bees-agent-dialog>.bees-agent-form{max-height:calc(100vh - 32px);overflow:auto;border:0;background:var(--dsw-specific-sidebar-fill);padding:18px}.bees-agent-dialog .bees-page-head{margin:0}.bees-agent-dialog .bees-row h2{margin:0}.bees-agent-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px}.bees-agent-fields>label{display:grid;align-content:start;gap:5px;min-width:0}.bees-agent-fields .bees-input,.bees-agent-fields .bees-select{width:100%;min-width:0}.bees-agent-toggle{display:flex!important;align-items:center;align-self:end;min-height:36px}.bees-mcp-access{display:grid;gap:12px}.bees-mcp-access>label{display:grid;gap:5px}.bees-mcp-count{padding:9px;border-radius:8px;color:var(--dsw-alias-label-secondary);background:var(--dsw-specific-sidebar-fill)}.bees-mcp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(max(215px,calc((100% - 27px) / 4)),1fr));gap:9px;max-height:300px;overflow:auto}.bees-mcp-page-grid,.bees-process-mcp-form .bees-mcp-grid{max-height:none;overflow:visible}.bees-mcp-card{display:flex;align-items:center;gap:9px;min-width:0;min-height:58px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;color:inherit;background:var(--dsw-specific-sidebar-fill);text-align:left;font:inherit;cursor:pointer}.bees-mcp-card:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover)}.bees-mcp-card.added,.bees-mcp-card.connected{border-color:var(--bees-accent);background:var(--bees-accent-soft)}.bees-mcp-card-copy{display:grid;min-width:0;flex:1;gap:2px}.bees-mcp-card-copy strong,.bees-mcp-card-copy span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-mcp-card-copy span{color:var(--dsw-alias-label-secondary);font-size:11px}.bees-mcp-state{flex:none;font-size:10px;color:var(--dsw-alias-label-secondary)}.bees-mcp-state.added,.bees-mcp-state.connected{color:var(--bees-accent)}.bees-mcp-state.warning{color:#cf8b3a}.bees-mcp-chevron{flex:none;color:var(--dsw-alias-label-secondary);font-size:16px}.bees-mcp-dialog{width:min(500px,calc(100vw - 32px));max-height:calc(100vh - 32px);padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);box-shadow:0 20px 70px #0008}.bees-mcp-dialog::backdrop{background:#0009}.bees-mcp-dialog-head{display:flex;align-items:center;gap:8px;padding:16px 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-mcp-dialog-head h3{min-width:0;flex:1;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-mcp-dialog-body{display:grid;gap:12px;max-height:calc(100vh - 150px);overflow:auto;padding:18px}.bees-mcp-dialog-body>.bees-muted{overflow-wrap:anywhere}.bees-mcp-tools{display:flex;gap:4px;flex-wrap:wrap}.bees-mcp-tools span{max-width:100%;padding:2px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:6px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);font:10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
  .bees-mcp-intro{margin:0;color:var(--dsw-alias-label-secondary)}.bees-mcp-section{display:grid;gap:14px}.bees-mcp-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.bees-mcp-section-head h3{margin:0 0 2px}.bees-mcp-section>.bees-search{margin:0}.bees-mcp-community{background:var(--dsw-specific-sidebar-fill)}.bees-mcp-card:focus-visible{outline:2px solid var(--bees-accent);outline-offset:1px}.bees-mcp-connect-dialog{width:min(620px,calc(100vw - 32px))}.bees-mcp-dialog-head>div{min-width:0}.bees-mcp-dialog-head>div h3{margin:0}.bees-mcp-access-note{padding:10px 12px;border-radius:8px;background:var(--dsw-specific-sidebar-fill)}.bees-mcp-access-note h3{margin:0 0 3px;font-size:12px}.bees-mcp-dialog-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:10px;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-mcp-dialog-meta>div{display:grid;gap:2px;min-width:0}.bees-mcp-dialog-message{padding:9px 11px;border-radius:8px;color:var(--dsw-alias-label-secondary);background:var(--dsw-specific-sidebar-fill);font-size:12px}.bees-mcp-dialog-message.error{color:#d45d5d;background:#a9363622}.bees-mcp-dialog-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:4px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}.bees-mcp-tab-panel{min-height:0}.bees-mcp-tab-panel>.bees-process-mcp-form{min-height:100%;align-content:start;padding:16px!important}
  .bees-answer-card{display:grid;gap:14px}.bees-answer-head{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap}.bees-answer-head h2{margin:2px 0 0;font-size:20px}.bees-answer-controls{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}.bees-answer-controls .bees-btn{padding:6px 9px;font-size:12px}.bees-question-detail{padding:10px 12px;border-radius:9px;background:var(--dsw-alias-bg-base)}.bees-question-options{display:grid;gap:8px}.bees-choice{display:flex;align-items:flex-start;gap:9px;width:100%;padding:11px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;color:inherit;background:var(--dsw-alias-bg-base);text-align:left;font:inherit;cursor:pointer}.bees-choice:hover,.bees-choice.selected{border-color:#f2b84b;background:#f2b84b16}.bees-choice-mark{display:grid;place-items:center;flex:0 0 22px;height:22px;border-radius:7px;background:var(--dsw-alias-interactive-bg-hover);font-size:11px}.bees-choice.selected .bees-choice-mark{background:#f2b84b;color:#21190b}.bees-choice-copy{display:grid;gap:2px}.bees-answer-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.bees-file-list{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}.bees-file-chip{display:block;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-file-chip.active{border-color:#f2b84b;background:#f2b84b16}.bees-file-preview-body pre,.bees-file-preview pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}
  .bees-flex-page{min-width:0}.bees-page-actions{display:flex;flex:none;align-items:center;gap:8px}.bees-page-actions .bees-btn{padding:5px 9px;font-size:12px;white-space:nowrap}.bees-flex-grid{margin:-6px}.bees-flex-widget{display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-base);box-shadow:0 2px 8px rgba(0,0,0,0.02);transition:transform 0.2s, box-shadow 0.2s}.bees-flex-widget:hover{border-color:var(--dsw-alias-border-l2);box-shadow:0 6px 16px rgba(0,0,0,0.04);transform:translateY(-1px)}.bees-flex-grid.editing .bees-flex-widget{box-shadow:0 0 0 2px #f2b84b88,0 1px 4px rgba(0,0,0,0.06)}.bees-flex-widget-handle{display:flex;align-items:center;gap:8px;flex:none;min-height:42px;padding:12px 14px 4px;border-bottom:none}.bees-flex-widget-handle>strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-flex-widget-actions{display:flex;align-items:center;flex:none;gap:6px;margin-left:auto}.bees-flex-widget-actions .bees-btn{padding:5px 9px;font-size:12px}.bees-flex-grid.editing .bees-flex-widget-handle{cursor:grab}.bees-flex-widget-body{min-height:0;flex:1;overflow:auto}.bees-page-grid .bees-flex-widget-body{padding:12px}.bees-flex-widget-body>.bees-cockpit-board{margin:0;padding:10px}.bees-flex-widget-body>.bees-convo-panel{height:100%;border:0;border-radius:0}.bees-flex-widget-body>.bees-details-panel{min-height:100%}.bees-flex-widget-body>.bees-details-panel>.bees-box{min-height:100%;border:0;border-radius:0}.bees-details-panel{display:flex;flex-direction:column;gap:12px}
  .bees-flex-widget-body>.bees-agent-form{border:0;border-radius:0}
  .bees-mark,.bees-btn.primary{background:var(--bees-accent);color:var(--bees-accent-contrast);border-color:var(--bees-accent);font-weight:700}.bees-brand-settings-button.active{color:var(--dsw-alias-label-primary);background:var(--bees-accent-soft)}.bees-segmented .active{border-color:var(--bees-accent);background:var(--bees-accent-soft)}
  .bees-settings-layout{display:grid;grid-template-columns:190px minmax(0,1fr);gap:20px;align-items:start}.bees-settings-menu{display:grid;gap:2px;padding:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-base)}.bees-settings-menu-label{padding:8px 9px 3px;color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}.bees-settings-divider{width:100%;margin:6px 0 2px;border:0;border-top:1px solid var(--dsw-alias-border-l1)}.bees-settings-menu button{width:100%;border:0;border-radius:8px;padding:8px 9px;color:inherit;background:transparent;text-align:left;font:inherit;cursor:pointer}.bees-settings-menu button:hover{background:var(--dsw-alias-interactive-bg-hover)}.bees-settings-menu button.active{background:var(--bees-accent-soft);font-weight:750;color:var(--bees-accent)}.bees-settings-content{min-width:0}.bees-org-branding{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:12px}.bees-org-branding label{display:grid;gap:5px}.bees-org-branding-preview{display:grid;place-items:center;width:42px;height:42px;border-radius:11px;color:#fff;font-size:18px;font-weight:800;box-shadow:inset 0 0 0 1px #fff3}.bees-color-input{width:52px;height:32px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);cursor:pointer}.bees-theme-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(max(110px,calc((100% - 18px * 4) / 5)),1fr));gap:18px;margin-top:20px}.bees-theme-card{display:flex;flex-direction:column;gap:14px;align-items:center;padding:18px 12px;border:none;border-radius:16px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base);text-align:center;font-size:13px;font-weight:600;letter-spacing:0.02em;cursor:pointer;transition:all 0.3s cubic-bezier(0.4,0,0.2,1);box-shadow:0 4px 12px rgba(0,0,0,0.04),inset 0 0 0 1px var(--dsw-alias-border-l1)}.bees-theme-card:hover{color:var(--dsw-alias-label-primary);transform:translateY(-4px);box-shadow:0 12px 24px rgba(0,0,0,0.08),inset 0 0 0 1px var(--dsw-alias-border-l2)}.bees-theme-card.active{color:var(--bees-accent);background:var(--bees-accent-soft);box-shadow:0 8px 24px rgba(0,0,0,0.06),inset 0 0 0 2px var(--bees-accent)}.bees-theme-swatches{display:flex;justify-content:center;gap:6px;width:100%}.bees-theme-swatches>span{width:22px;height:22px;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.15),inset 0 1px 2px rgba(255,255,255,0.3);transition:transform 0.2s}.bees-theme-card:hover .bees-theme-swatches>span{transform:scale(1.15)}
  .bees-team-chevron,.bees-nav-chevron{display:flex;align-items:center;justify-content:center;width:14px;height:14px;flex:none;color:var(--dsw-alias-label-secondary)}.bees-nav-link .bees-nav-chevron{min-width:14px;flex:none;overflow:visible}.bees-team-chevron svg,.bees-nav-chevron svg{width:14px;height:14px;transform:rotate(-90deg);transition:transform .15s}.bees-team-chevron.expanded svg,.bees-nav-chevron.expanded svg{transform:rotate(0)}@media(max-width:780px){.bees-app{grid-template-columns:76px 1fr}.bees-brand>span:nth-child(2),.bees-nav-child,.bees-dashboard-action,.bees-org-summary,.bees-team-heading span,.bees-team-name,.bees-team-chevron{display:none}.bees-brand{justify-content:center;padding-inline:8px}.bees-brand-settings{margin-left:0}.bees-scope-switcher{margin-inline:8px}.bees-org-tiles{display:grid;justify-items:center}.bees-team-heading{justify-content:center;padding:0}.bees-team-row{justify-content:center}.bees-team-toggle{justify-content:center;padding-inline:2px}.bees-team-settings{opacity:1;margin:0}.bees-nav-link{justify-content:center}.bees-settings-layout{grid-template-columns:1fr}.bees-content{padding:14px 16px}.bees-agent-fields,.bees-mcp-grid{grid-template-columns:1fr}.bees-nav-link>span:not(:first-child){display:none}}
/* Keep native scrolling and a stable width; reveal only the active scroller. */
* { scrollbar-width: thin; scrollbar-color: transparent transparent; }
*[data-bees-scrolling] { scrollbar-color: var(--dsw-alias-label-secondary, #888) transparent; }
*::-webkit-scrollbar { width: 6px; height: 6px; }
*::-webkit-scrollbar:horizontal { height: 0 !important; display: none !important; }
*::-webkit-scrollbar-track, *::-webkit-scrollbar-corner { background: transparent; }
*::-webkit-scrollbar-thumb { background: transparent; border-radius: 999px; }
*[data-bees-scrolling]::-webkit-scrollbar-thumb { background: var(--dsw-alias-label-secondary, #888); }
body, html { overflow-x: hidden !important; }
.bees-app { overflow: clip !important; grid-template-rows: minmax(0, 1fr); }

/* --- WORK ITEM COCKPIT DESIGN SYSTEM --- */

/* Surface Widgets */
.bees-work-item-grid { margin: -6px; }
.bees-work-item-grid .bees-flex-widget {
  background: var(--dsw-specific-sidebar-fill, #161920) !important;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08)) !important;
  border-radius: 14px !important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18) !important;
  overflow: hidden !important;
  display: flex !important;
  flex-direction: column !important;
}
.bees-work-item-grid .bees-flex-widget-body {
  padding: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  flex: 1 !important;
  min-height: 0 !important;
  overflow: auto !important;
}
.bees-work-item-grid .bees-flex-widget-borderless .bees-flex-widget-body { overflow: hidden !important; }

.bees-flex-grid.editing .bees-flex-widget-drag-surface { cursor: grab; }

.bees-convo-error { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 10px; margin: 8px 10px 0; padding: 8px 10px; border: 1px solid #ef444455; border-radius: 9px; color: #f87171; background: color-mix(in srgb, var(--dsw-alias-bg-base) 92%, #ef4444 8%); box-shadow: 0 6px 18px #0004; }
.bees-convo-error>span { min-width: 0; flex: 1; overflow-wrap: anywhere; font-size: 12px; }

/* Kanban Board Top Widget */
.bees-cockpit-board.bees-routing-board { min-height: 0 !important; flex: none; }
.bees-cockpit-board { display: flex !important; flex-direction: row !important; overflow-x: auto !important; overflow-y: hidden !important; gap: 12px !important; align-items: stretch !important; padding: 12px 14px !important; background: transparent !important; height: 100% !important; min-height: 0 !important; box-sizing: border-box !important; }
.bees-column { border-radius: 12px !important; padding: 12px 14px !important; display: flex !important; flex-direction: column !important; }
/* .bees-work-item-grid .bees-convo-history, (dummy for test) */
.bees-cockpit-board .bees-column {
  flex: 1 1 260px !important;
  min-width: 200px !important;
  max-width: 380px !important;
  min-height: 80px !important;
  background: var(--dsw-alias-bg-base, #1c2028) !important;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.06)) !important;
  border-radius: 10px !important;
  padding: 10px 12px !important;
  display: flex !important;
  flex-direction: column !important;
  height: 100% !important;
  min-height: 0 !important;
  box-sizing: border-box !important;
}
.bees-cockpit-board .bees-column-head {
  font-size: 11px !important;
  font-weight: 700 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.06em !important;
  color: var(--dsw-alias-label-secondary) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  margin-bottom: 8px !important;
  padding: 0 !important;
}
.bees-cockpit-board .bees-count {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  min-width: 18px !important;
  height: 18px !important;
  padding: 0 5px !important;
  border-radius: 999px !important;
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)) !important;
  color: var(--dsw-alias-label-secondary) !important;
  font-size: 10px !important;
  font-weight: 700 !important;
}
.bees-cockpit-board .bees-cards {
  display: flex !important;
  flex-direction: column !important;
  flex: 1 !important;
  min-height: 0 !important;
  overflow-y: auto !important;
  gap: 6px !important;
  padding: 0 !important;
}
.bees-cockpit-board .bees-hierarchy-card {
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
  padding: 12px !important;
  border-radius: 8px !important;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08)) !important;
  background: var(--dsw-specific-sidebar-fill, #161920) !important;
  transition: all 0.15s ease !important;
  cursor: pointer !important;
  text-align: left !important;
}
.bees-cockpit-board .bees-hierarchy-card:hover {
  border-color: #f2b84b88 !important;
}
.bees-cockpit-board .bees-hierarchy-card.active {
  border: 1.5px solid #f2b84b !important;
  background: #f2b84b12 !important;
  box-shadow: 0 2px 8px rgba(242, 184, 75, 0.12) !important;
}
.bees-cockpit-board .bees-hierarchy-card h3 {
  font-size: 13px !important;
  font-weight: 600 !important;
  margin: 0 !important;
  line-height: 1.3 !important;
}
.bees-cockpit-board .bees-hierarchy-card .bees-muted {
  font-size: 11px !important;
  color: var(--dsw-alias-label-secondary) !important;
}
.bees-cockpit-board .bees-empty {
  flex: 1 !important;
  min-height: 120px !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 12px !important;
  border: 0 !important;
  border-radius: 0 !important;
  font-size: 12px !important;
  color: var(--dsw-alias-label-secondary) !important;
  text-align: center !important;
  margin: 0 !important;
}
.bees-cockpit-board .bees-empty .bees-empty-icon { display: block !important; }
.bees-work-item-actions .bees-btn { min-height: 36px; padding: 8px 14px; font-size: 13px; }
.bees-routing-board .bees-route-card,
.bees-routing-board .bees-route-terminal {
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}
.bees-route-guide {
  margin: 0 0 10px;
}
.bees-routing-board .bees-column {
  min-width: 240px !important;
  min-height: 240px !important;
  padding: 14px 16px !important;
  border-top: 2px solid color-mix(in srgb, var(--bees-accent) 55%, var(--dsw-alias-border-l2)) !important;
}
.bees-routing-board .bees-route-card {
  gap: 14px !important;
}
.bees-routing-board .bees-route-card:hover,
.bees-routing-board .bees-route-terminal:hover {
  border-color: transparent !important;
}
.bees-routing-board .bees-route-terminal .bees-badge {
  align-self: flex-start;
}
.bees-routing-board .bees-route-card > .bees-btn {
  border-color: transparent;
  color: var(--bees-accent);
  background: transparent;
  box-shadow: none;
}
.bees-routing-board .bees-route-card > .bees-btn:hover {
  background: var(--bees-accent-soft);
}

/* Details Panel Structure */
.bees-details-panel {
  display: flex !important;
  flex-direction: column !important;
  height: 100% !important;
  min-height: 0 !important;
  background: transparent !important;
}

/* Tabs Header */
.bees-clean-tabs {
  display: flex !important;
  flex: 0 0 auto !important;
  align-items: center !important;
  gap: 4px !important;
  padding: 10px 14px 0 !important;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08)) !important;
  background: transparent !important;
  margin: 0 !important;
  flex-wrap: wrap !important;
}
.bees-clean-tab {
  position: relative !important;
  padding: 8px 12px !important;
  border: none !important;
  background: transparent !important;
  color: var(--dsw-alias-label-secondary) !important;
  font-size: 13px !important;
  font-weight: 500 !important;
  cursor: pointer !important;
  transition: all 0.15s ease !important;
  border-radius: 6px 6px 0 0 !important;
  white-space: nowrap !important;
}
.bees-clean-tab .bees-count {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bees-accent, #f2b84b);
  color: #21190b;
  font-size: 11px;
  font-weight: 700;
}
.bees-clean-tab:hover {
  color: var(--dsw-alias-label-primary) !important;
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.04)) !important;
}
.bees-clean-tab.active {
  color: var(--dsw-alias-label-primary) !important;
  font-weight: 600 !important;
}
.bees-clean-tab.active::after {
  content: '' !important;
  position: absolute !important;
  bottom: 0 !important;
  left: 0 !important;
  right: 0 !important;
  height: 2px !important;
  background: var(--dsw-alias-state-business-primary, #f2b84b) !important;
  border-radius: 2px 2px 0 0 !important;
}

.bees-card-badges{display:flex;flex-wrap:wrap;gap:6px;margin:0}
.bees-root-chip{display:inline-flex;align-items:center;padding:4px 8px;border-radius:6px;background:#3b82f622;border:1px solid #3b82f666;color:var(--dsw-alias-label-primary);font-size:10px;font-weight:700}
.bees-card-metadata { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 11px; }
.bees-card-metadata > div { display: flex; flex-direction: column; gap: 3px; }
.bees-card-metadata > div:last-child { align-items: flex-end; text-align: right; }
.bees-card-metadata > div > span:first-child { color: var(--dsw-alias-label-secondary); font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
.bees-card-metadata strong, .bees-card-metadata time, .bees-card-metadata > div > span:last-child { font-weight: 600; color: var(--dsw-alias-label-primary); }
.bees-tab-actions {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  flex-wrap: wrap !important;
  justify-content: flex-end !important;
  align-self: flex-end !important;
}

/* Status Badges */
.bees-detail-badge {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  border: 1px solid transparent;
  display: inline-flex !important;
  align-items: center !important;
  gap: 5px !important;
  padding: 4px 10px !important;
  border-radius: 6px !important;
  font-size: 10px !important;
  font-weight: 750 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.06em !important;
  line-height: 1 !important;
}
.bees-detail-badge.running { background: #22c55e1c !important; color: #4ade80 !important; border: 1px solid #22c55e33 !important; }
.bees-detail-badge.paused { background: #f59e0b1c !important; color: #fbbf24 !important; border: 1px solid #f59e0b33 !important; }
.bees-detail-badge.failed { background: #ef44441c !important; color: #f87171 !important; border: 1px solid #ef444433 !important; }
.bees-detail-badge.waiting { background: #a855f71c !important; color: #c084fc !important; border: 1px solid #a855f733 !important; }
.bees-detail-badge.completed { background: #10b9811c !important; color: #34d399 !important; border: 1px solid #10b98133 !important; }
.bees-detail-badge.default { background: rgba(255, 255, 255, 0.08) !important; color: var(--dsw-alias-label-secondary) !important; }

/* Buttons */
.bees-btn-icon {
  margin-right: 0 !important; line-height: 1 !important; justify-content: center !important;
  font-size: 13px !important;
  opacity: 0.8 !important;
  display: inline-flex !important;
  align-items: center !important;
}
.bees-btn-primary {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 8px 14px !important; min-height: 34px !important; gap: 6px !important;
  font-size: 12.5px !important;
  font-weight: 650 !important;
  border-radius: 8px !important;
  background: var(--dsw-alias-state-business-primary, #3b82f6) !important;
  color: #fff !important;
  border: none !important;
  cursor: pointer !important;
  transition: all 0.15s ease !important;
  box-shadow: 0 1px 3px rgba(59, 130, 246, 0.3) !important;
}
.bees-btn-primary:hover {
  filter: brightness(1.1) !important;
}
.bees-btn-secondary {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 8px 14px !important; min-height: 34px !important; gap: 6px !important;
  font-size: 12.5px !important;
  font-weight: 600 !important;
  border-radius: 8px !important;
  background: rgba(255, 255, 255, 0.06) !important;
  color: var(--dsw-alias-label-primary) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  cursor: pointer !important;
  transition: all 0.15s ease !important;
}
.bees-btn-secondary:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.1)) !important;
  border-color: rgba(255, 255, 255, 0.25) !important;
}
.bees-btn-danger-ghost {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 8px 14px !important; min-height: 34px !important; gap: 6px !important;
  font-size: 12.5px !important;
  font-weight: 600 !important;
  border-radius: 8px !important;
  background: rgba(239, 68, 68, 0.08) !important;
  color: #f87171 !important;
  border: 1px solid rgba(239, 68, 68, 0.2) !important;
  cursor: pointer !important;
  transition: all 0.15s ease !important;
}
.bees-btn-danger-ghost:hover {
  background: rgba(239, 68, 68, 0.15) !important;
  border-color: #f87171 !important;
}

/* Tab Panel Body */
.bees-tab-panel {
  flex: 1 !important;
  overflow-y: auto !important;
  padding: 14px 16px !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 14px !important;
  background: transparent !important;
}

/* Plain sections in Details Tab */
.bees-collaboration{font-size:13px;line-height:1.6;min-width:0}
.bees-collaboration h3,.bees-collaboration h4,.bees-collaboration p{margin:0}
.bees-collaboration h3{font-size:17px;line-height:1.35}
.bees-collaboration h4{font-size:14px;line-height:1.5}
.bees-collaboration-heading{display:grid;gap:5px;padding-bottom:4px}
.bees-collaboration .bees-box{display:grid;gap:10px;padding:16px}
.bees-context-goal{border-left:3px solid var(--bees-accent)}
.bees-context-label{font-size:11px;font-weight:700;color:var(--dsw-alias-label-secondary)}
.bees-context-corrections{border-left:3px solid var(--bees-accent);background:color-mix(in srgb,var(--bees-accent) 7%,var(--dsw-alias-bg-base))}
.bees-context-corrections article{display:grid;gap:5px}
.bees-context-section{min-width:0;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}
.bees-context-section>summary{font-weight:650;cursor:pointer;overflow-wrap:anywhere}
.bees-context-section[open]>summary{margin-bottom:10px}
.bees-context-section>p{margin-bottom:10px}
.bees-context-assignment{display:grid;gap:6px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.bees-context-text{min-width:0;overflow-wrap:anywhere;line-height:1.65}
.bees-context-text p{margin:0 0 8px}
.bees-context-text p:last-child{margin-bottom:0}
.bees-context-text ul,.bees-context-text ol{padding-left:22px;margin:8px 0}
.bees-context-text pre{max-width:100%;overflow-x:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.bees-context-text table{display:block;max-width:100%;overflow-x:auto}
.bees-context-technical pre{font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.bees-collaboration-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.bees-collaboration-meta>strong{overflow-wrap:anywhere}
.bees-collaboration-meta time{margin-left:auto;font-size:11px}
.bees-collaboration-badge{padding:2px 8px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:650}
.bees-discussion-participants{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:10px}
.bees-discussion-participant{display:grid;gap:3px;min-width:0}
.bees-discussion-participant .bees-btn,.bees-discussion-footer .bees-btn{padding:0;border:0;border-radius:3px;background:none;color:inherit;text-align:left;white-space:normal;overflow-wrap:anywhere;font-size:12px;text-decoration:underline;text-underline-offset:3px;justify-content:flex-start}
.bees-discussion-help{display:grid;gap:3px;padding:12px 14px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover)}
.bees-discussion-timeline{display:grid;gap:14px}
.bees-discussion-message{position:relative;display:grid;grid-template-columns:28px minmax(0,1fr);align-items:start;gap:10px}
.bees-discussion-message:not(:last-child)::before{content:"";position:absolute;top:34px;bottom:-14px;left:13px;width:1px;background:var(--dsw-alias-border-l1)}
.bees-discussion-avatar{display:grid;place-items:center;height:28px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover);font-size:12px;font-weight:750;color:var(--dsw-alias-label-secondary)}
.bees-collaboration .bees-discussion-recipient{margin-top:-5px;font-size:11px}
.bees-discussion-footer{padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.bees-discussion-technical{font-size:11px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.bees-discussion-technical summary{cursor:pointer}
.bees-discussion-empty{text-align:center}
.bees-collaboration summary:focus-visible,.bees-collaboration button:focus-visible{outline:2px solid var(--bees-accent);outline-offset:3px}
.bees-card-section {
  display: flex !important;
  flex-direction: column !important;
  gap: 10px !important;
}
.bees-card-section-head {
  font-size: 10px !important;
  font-weight: 750 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.06em !important;
  color: var(--dsw-alias-label-secondary) !important;
  margin: 0 !important;
}
/* Conversation Panel Header & Stream */
.bees-convo-header {
  display: flex !important;
  align-items: center !important;
  flex-wrap: wrap !important;
  gap: 8px !important;
  justify-content: space-between !important;
  padding: 10px 16px !important;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08)) !important;
  min-height: 42px !important;
  background: transparent !important;
  flex: none !important;
}
.bees-convo-title {
  font-size: 13px !important;
  font-weight: 700 !important;
  letter-spacing: 0.03em !important;
  color: var(--dsw-alias-label-primary) !important;
}

.bees-convo-panel {
  background: var(--dsw-specific-sidebar-fill, #161920) !important;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08)) !important;
  display: flex !important;
  flex-direction: column !important;
  height: 100% !important;
  min-height: 0 !important;
}
.bees-convo-history {
  background: transparent !important;
  box-shadow: none !important;
  padding: 14px !important;
  gap: 10px !important;
  flex: 1 !important;
  overflow-y: auto !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: stretch !important;
}

/* User Messages */
.bees-convo-msg.user {
  align-self: flex-end !important;
  flex-shrink: 0 !important;
  width: fit-content !important;
  max-width: min(86%, 720px) !important;
  box-sizing: border-box !important;
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.05)) !important;
  color: var(--dsw-alias-label-primary) !important;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08)) !important;
  border-radius: 12px 12px 4px 12px !important;
  padding: 12px 16px !important;
  margin: 0 !important;
  font-size: 13.5px !important;
  line-height: 1.55 !important;
}
.bees-convo-msg.user > strong {
  display: block !important;
  font-size: 10px !important;
  font-weight: 750 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.06em !important;
  color: #f2b84b !important;
  margin-bottom: 6px !important;
}

/* Agent Turns */
.bees-agent-turn {
  display: flex !important;
  align-items: flex-start !important;
  flex-shrink: 0 !important;
  gap: 12px !important;
  width: min(92%, 760px) !important;
  max-width: 100% !important;
  align-self: flex-start !important;
}
.bees-agent-avatar {
  display: grid !important;
  place-items: center !important;
  flex: 0 0 28px !important;
  height: 28px !important;
  margin-top: 2px !important;
  border: 1px solid rgba(242, 184, 75, 0.25) !important;
  border-radius: 8px !important;
  color: #f2b84b !important;
  background: rgba(242, 184, 75, 0.12) !important;
  font-size: 11px !important;
  font-weight: 800 !important;
}
.bees-convo-msg.agent {
  flex: 1 !important;
  min-width: 0 !important;
  max-width: 100% !important;
  padding: 12px 16px !important;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.04)) !important;
  border-radius: 10px !important;
  color: var(--dsw-alias-label-primary) !important;
  background: var(--dsw-alias-bg-base, #1c2028) !important;
  box-shadow: 0 1px 3px #0002 !important;
  font-size: 13.5px !important;
  line-height: 1.55 !important;
}
.bees-convo-msg.agent > strong {
  display: block !important;
  font-size: 10px !important;
  font-weight: 750 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.06em !important;
  color: var(--dsw-alias-label-secondary) !important;
  margin-bottom: 6px !important;
}
.bees-convo-msg.agent.error {
  border-color: rgba(239, 68, 68, 0.4) !important;
  background: rgba(239, 68, 68, 0.08) !important;
}

/* System & Context Messages */
.bees-convo-msg.system {
  border: 0 !important;
  background: transparent !important;
  border-radius: 0 !important;
  color: var(--dsw-alias-label-secondary) !important;
  padding: 4px 2px !important;
  max-width: 100% !important;
  align-self: stretch !important;
  flex-shrink: 0 !important;
  margin: 0 !important;
  font-size: 11.5px !important;
  line-height: 1.5 !important;
  display: flex !important;
  align-items: flex-start !important;
  gap: 8px !important;
  min-width: 0 !important;
  white-space: pre-wrap !important;
  overflow-wrap: anywhere !important;
}
.bees-convo-log {
  display: block !important;
  width: auto !important;
  margin-left: 40px !important;
  padding: 3px 0 3px 10px !important;
  border-left: 2px solid var(--dsw-alias-border-l2) !important;
}
.bees-convo-msg-interactive {
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  padding: 0 !important;
}

/* Interactive Cards */
.bees-answer-card { gap: 12px; background: var(--dsw-alias-button-elevated-fill) !important; border: 1px solid var(--dsw-alias-border-l2) !important; border-radius: 12px !important; box-shadow: 0 2px 8px #0000000c !important; padding: 16px !important; margin: 0 !important; }
.bees-convo-history > .bees-answer-card { flex: none; width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; border-left: 3px solid var(--bees-accent) !important; }
.bees-answer-card .bees-answer-head > div:first-child, .bees-answer-card .bees-choice-copy { min-width: 0; overflow-wrap: anywhere; }
.bees-answer-card .bees-status { color: var(--bees-accent); font-size: 11px; font-weight: 600; }
.bees-answer-card h2, .bees-answer-card h3 { color: var(--dsw-alias-label-primary) !important; margin: 0 !important; overflow-wrap: anywhere; }
.bees-answer-card h3 { font-size: 15px; font-weight: 500; line-height: 1.6; }
.bees-answer-card .bees-question-detail { min-width: 0; overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.6; padding: 10px 12px; background: var(--dsw-alias-bg-base); box-shadow: none; }
.bees-answer-card .bees-question-detail pre { max-width: 100%; overflow-x: auto; }
.bees-answer-card .bees-choice { background: var(--dsw-alias-bg-base); border-color: var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); font-size: 13px; }
.bees-answer-card .bees-choice:hover { background: var(--dsw-alias-interactive-bg-hover); }
.bees-answer-card .bees-choice.selected { border-color: var(--bees-accent); background: var(--bees-accent-soft); }
.bees-answer-card .bees-choice.selected .bees-choice-mark { background: var(--bees-accent); color: var(--bees-accent-contrast); }
.bees-answer-card .bees-textarea { min-height: 76px; padding: 10px 12px; font-size: 13px; line-height: 1.5; }
.bees-answer-card .bees-answer-actions { border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 12px; justify-content: flex-end; }
.bees-answer-card .bees-answer-actions .bees-btn { min-height: 34px; padding: 7px 11px; font-size: 12px; }

/* Compact Composer */
.bees-compact-composer {
  border: 1px solid var(--dsw-alias-border-l2) !important;
  border-radius: 12px !important;
  background: var(--dsw-alias-bg-base, #1c2028) !important;
  padding: 0 !important;
  margin: 0 12px 12px !important;
  position: relative !important;
  display: flex !important;
  box-shadow: 0 2px 8px #0002 !important;
}
.bees-compact-composer:focus-within {
  border-color: var(--bees-accent) !important;
  box-shadow: 0 0 0 3px var(--bees-accent-soft), 0 4px 12px #0003 !important;
}
.bees-compact-composer textarea {
  flex: 1 !important;
  width: 100% !important;
  min-height: 72px !important;
  max-height: 200px !important;
  padding: 14px 52px 14px 16px !important;
  background: transparent !important;
  border: none !important;
  border-radius: 0 !important;
  color: var(--dsw-alias-label-primary) !important;
  font-size: 13.5px !important;
  line-height: 1.5 !important;
  outline: none !important;
  box-shadow: none !important;
  resize: none !important;
}
.bees-compact-composer textarea:focus {
  outline: none !important;
  box-shadow: none !important;
}
.bees-composer-send {
  position: absolute !important;
  right: 10px !important;
  bottom: 10px !important;
  width: 32px !important;
  height: 32px !important;
  border-radius: 9px !important;
  background: var(--bees-accent) !important;
  color: var(--bees-accent-contrast) !important;
  display: grid !important;
  place-items: center !important;
  border: 0 !important;
  cursor: pointer !important;
  font-weight: 700 !important;
  font-size: 14px !important;
  transition: all 0.15s ease !important;
}
.bees-composer-send:disabled {
  opacity: 0.35 !important;
  cursor: not-allowed !important;
}
.bees-composer-send:not(:disabled):hover { filter: brightness(1.08) !important; transform: translateY(-1px) !important; }
.bees-composer-send:focus-visible { outline: 2px solid var(--bees-accent) !important; outline-offset: 2px !important; }
.bees-flex-widget-body>.bees-convo-panel { border: 0 !important; border-radius: 0 !important; background: transparent !important; }
.bees-agent-mention {
  color: #f2b84b !important;
  font-weight: 750 !important;
}
.bees-mention-suggestions {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 6px !important;
  padding: 10px 12px 0 !important;
}
.bees-mention-suggestions button {
  padding: 5px 8px !important;
  border: 1px solid var(--dsw-alias-border-l2) !important;
  border-radius: 7px !important;
  color: var(--dsw-alias-label-secondary) !important;
  background: var(--dsw-alias-interactive-bg-hover) !important;
  font: inherit !important;
  font-size: 12px !important;
  cursor: pointer !important;
}

/* Kanban Card Description */
.bees-card-desc {
  display: -webkit-box !important;
  -webkit-line-clamp: 2 !important;
  -webkit-box-orient: vertical !important;
  overflow: hidden !important;
  font-size: 11.5px !important;
  color: var(--dsw-alias-label-secondary) !important;
  margin: 0 !important;
  line-height: 1.4 !important;
  white-space: normal !important;
}

.bees-modal { width: min(620px, 100%); max-height: calc(100vh - 48px); overflow: auto; padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); box-shadow: 0 24px 80px rgba(0,0,0,.35); }
.bees-modal::backdrop { background: rgba(0,0,0,.55); }
.bees-modal > form { padding: 24px; }
.bees-modal.bees-ask-setup { width: min(960px, calc(100vw - 32px)); height: min(760px, calc(100dvh - 48px)); margin: auto; padding: 0 20px; box-sizing: border-box; overflow: hidden; }
.bees-modal.bees-ask-setup[open] { display: flex; flex-direction: column; }
.bees-ask-setup > fieldset { flex: 1; min-height: 0; overflow: auto; }
.bees-ask-setup > fieldset > .bees-form { padding-top: 16px; }
.bees-ask-setup > fieldset h2 { margin: 0; }
.bees-ask-tabs { padding-left: 0 !important; border-bottom: 0 !important; }
.bees-ask-setup .bees-routing-board { background: var(--dsw-specific-sidebar-fill) !important; border-radius: 12px; }
.bees-ask-setup .bees-routing-board .bees-column { border: 0 !important; background: color-mix(in srgb, #60a5fa 8%, var(--dsw-alias-bg-base)) !important; padding: 12px !important; }
.bees-ask-setup .bees-routing-board .bees-column:nth-child(3n + 2) { background: color-mix(in srgb, #a78bfa 8%, var(--dsw-alias-bg-base)) !important; }
.bees-ask-setup .bees-routing-board .bees-column:nth-child(3n) { background: color-mix(in srgb, #34d399 8%, var(--dsw-alias-bg-base)) !important; }
.bees-ask-setup .bees-resource-output,.bees-ask-setup .bees-output-field { border-top: 0; }
.bees-ask-heading { position: relative; padding-right: 44px; }
.bees-ask-close { position: absolute; top: 8px; right: 0; border: 0; background: transparent; box-shadow: none; font-size: 20px; line-height: 1; }
.bees-ask-actions { flex: none; align-items: center; padding: 12px 0; margin-top: 0; }
.bees-ask-actions .bees-error { margin: 0 auto 0 0; }
.bees-agent-dialog > .bees-modal { width: 100%; max-height: calc(100vh - 32px); padding: 24px; border: 0; box-shadow: none; }
.bees-playbook { margin: 12px 0; padding: 12px; overflow-wrap: anywhere; white-space: pre-wrap; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
.bees-cron-generator .cron_builder { max-width: none; color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }
.bees-cron-generator .cron_builder .cron_builder_bordering { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }
.bees-cron-generator .cron_builder .cron_builder_bordering input,
.bees-cron-generator .cron_builder .cron_builder_bordering select { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-button-elevated-fill); }
.bees-cron-generator .cron_builder .cron_builder_bordering select:disabled { color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-interactive-bg-hover); }
.bees-cron-generator .cron_builder .nav li button { color: var(--dsw-alias-label-primary); }
.bees-cron-generator .cron_builder .nav-tabs .nav-link:hover { background: var(--dsw-alias-interactive-bg-hover); }
.bees-cron-generator .cron_builder .nav-tabs .nav-link.active { border-color: var(--dsw-alias-border-l2) var(--dsw-alias-border-l2) var(--dsw-alias-bg-base); background: var(--dsw-alias-bg-base); }
.bees-cron-generator .cron_builder .nav-tabs .nav-link.disabled { color: var(--dsw-alias-label-secondary); border-bottom-color: var(--dsw-alias-bg-base); background: var(--dsw-alias-bg-base); }
.bees-cron-generator .cron_builder .well { border-color: var(--dsw-alias-border-l1); background: var(--dsw-alias-interactive-bg-hover); }
.bees-cron-generator .cron_builder .dropdown-content { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-button-elevated-fill); }
.bees-cron-generator .cron_builder .dropdown-content .dropdown-item { color: var(--dsw-alias-label-primary); }
.bees-cron-generator .cron_builder .dropdown-content .dropdown-item:hover,
.bees-cron-generator .cron_builder .dropdown-content .dropdown-item-selected,
.bees-cron-generator .cron_builder .cron-builder-bg { color: var(--dsw-alias-bg-base); background: var(--dsw-alias-state-business-primary, #f2b84b); }
.bees-notice { position: fixed; z-index: 1200; right: 24px; bottom: 24px; width: min(480px, calc(100vw - 48px)); padding: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-button-elevated-fill); box-shadow: 0 16px 48px rgba(0,0,0,.3); }
.bees-notice pre { margin: 8px 0 0; overflow-wrap: anywhere; white-space: pre-wrap; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }

.bees-work-files{min-width:0;display:grid;gap:12px}
.bees-work-files>h3{font-size:13px;margin:8px 0 0}
.bees-work-files>p{margin:0}
.bees-work-files>.bees-resource-list{grid-template-columns:minmax(0,1fr)}
.bees-output-directory{display:grid;gap:20px;min-width:0}
.bees-output-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.45;white-space:normal;overflow-wrap:anywhere;word-break:break-all;user-select:all;color:var(--dsw-alias-label-secondary);padding:5px 8px;margin:4px 0 8px 0;background:var(--dsw-alias-bg-base);border-radius:6px;border:1px solid var(--dsw-alias-border-l1)}
.bees-file-row{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;border-radius:6px;transition:background .15s}
.bees-file-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.bees-file-row.active{background:#f2b84b22}
.bees-file-row.active .bees-directory-file{background:transparent}
.bees-file-row.active .bees-file-action-btn{background:transparent;border-color:transparent}
.bees-file-row-actions{display:flex;align-items:center;gap:4px;flex-shrink:0}
.bees-file-action-btn{display:inline-flex;align-items:center;gap:4px;padding:3px 7px;font-size:11px;border-radius:5px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}
.bees-file-action-btn:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--bees-accent,#f2b84b)}
.bees-file-action-btn svg{width:12px;height:12px}
.bees-open-explorer{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;font-size:11px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;flex-shrink:0}
.bees-open-explorer:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--bees-accent,#f2b84b)}
.bees-open-explorer svg{width:13px;height:13px}
.bees-location-summary-with-action{display:flex!important;align-items:center;justify-content:space-between;gap:8px;width:100%}
.bees-location-summary-label{display:inline-flex;align-items:center;gap:7px;min-width:0;overflow:hidden;text-overflow:ellipsis}
.bees-location-action-wrap{display:inline-flex;align-items:center;flex-shrink:0;margin-left:auto}
.bees-location-file-row{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%}
.bees-inline-preview{margin:6px 0 10px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);overflow:hidden}
.bees-file-preview-inline{max-height:450px;display:flex;flex-direction:column}
.bees-file-preview-inline .bees-file-preview-body{max-height:380px;overflow:auto;padding:12px}
.bees-output-run{min-width:0}
.bees-output-run-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px}
.bees-output-run-head>h3{margin:0;font-size:12px;font-weight:600;overflow-wrap:anywhere}
.bees-output-run-head>.bees-status{flex-shrink:0}
.bees-file-tree{list-style:none;margin:0;padding-left:16px;border-left:1px solid var(--dsw-alias-border-l1)}
.bees-file-tree>li{min-width:0}
.bees-file-tree svg{width:16px;height:16px;margin-right:7px;vertical-align:-3px;color:var(--dsw-alias-label-secondary)}
.bees-location-tree{padding-left:0;border-left:0}
.bees-work-locations summary{list-style:none}
.bees-work-locations summary::-webkit-details-marker{display:none}
.bees-location-tree summary{padding:7px 8px;border-radius:6px;cursor:pointer;overflow-wrap:anywhere}
.bees-location-tree summary:hover{background:var(--dsw-alias-interactive-bg-hover)}
.bees-location-tree summary:focus-visible{outline:2px solid var(--bees-accent,#f2b84b);outline-offset:-2px}
.bees-location-tree .bees-file-tree{margin-left:12px}
.bees-work-files>div>h3{font-size:13px;margin:8px 0}
.bees-directory-file{display:block;width:100%;padding:7px 8px;border:0;border-radius:6px;text-align:left;color:inherit;background:transparent;font:inherit;overflow-wrap:anywhere;cursor:pointer}
.bees-directory-file:hover{background:var(--dsw-alias-interactive-bg-hover)}
.bees-directory-file.active{background:#f2b84b22}
.bees-file-preview{display:flex;flex-direction:column;overflow:hidden}
.bees-file-preview-head{flex-shrink:0;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.bees-file-preview-head>svg{flex-shrink:0;color:var(--dsw-alias-label-secondary)}
.bees-file-preview-head>.bees-editor-action{display:grid;place-items:center;width:30px;height:30px;padding:0;border:0;background:transparent}
.bees-file-preview-head>.bees-btn{flex-shrink:0}
.bees-file-preview-body{min-height:0;min-width:0;flex:1;overflow:auto;overflow-wrap:anywhere;padding:16px}
.bees-file-preview-image{display:block;max-width:100%;max-height:65vh;object-fit:contain;margin:auto}
.bees-file-preview-media{display:block;width:min(100%,900px);max-height:65vh;margin:auto}
.bees-file-preview-document{display:block;width:100%;height:65vh;min-height:300px;border:0;background:white}
.bees-work-files .bees-resource-list,.bees-file-dialog .bees-resource-list{grid-template-columns:minmax(0,1fr)}
.bees-editor-open{display:flex;flex-direction:column;flex:1;height:65vh;min-height:360px;gap:0}
.bees-editor-open>div{display:none}
.bees-editor-open>.bees-file-preview{flex:1;min-height:0;background:var(--dsw-alias-bg-base)}
.bees-tab-panel:has(>.bees-editor-open)>:not(.bees-editor-open){display:none!important}
.bees-file-dialog{position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;box-sizing:border-box;margin:0;padding:20px;border:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:inherit}
.bees-file-dialog[open]{display:flex;flex-direction:column}
.bees-file-dialog::backdrop{background:#0009}
.bees-file-dialog pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace}
.bees-file-dialog .bees-resource-list .bees-btn{text-align:left;white-space:normal;overflow-wrap:anywhere}
.bees-file-tree summary:focus-visible,.bees-directory-file:focus-visible,.bees-file-preview-body:focus-visible{outline:2px solid #f2b84b;outline-offset:-2px}
/* Nothing may poke out of its box: rows wrap, flex children may shrink, long words break, code scrolls inside. */
.bees-row>*{min-width:0}
.bees-row .bees-btn{flex:0 0 auto}
.bees-work-table{width:100%;border-collapse:collapse;text-align:left}
.bees-work-table th,.bees-work-table td{padding:10px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:middle}
.bees-work-table th{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}
.bees-work-table th:first-child,.bees-work-table td:first-child{width:100%;min-width:220px;max-width:0}
.bees-work-table td:not(:first-child){white-space:nowrap}
.bees-work-table .bees-work-item-row{border:0;padding:4px 0}
.bees-work-table .bees-answer-controls{flex-wrap:nowrap}
.bees-work-owner{display:block;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bees-owner-filter{max-width:220px}
.bees-row .bees-select.bees-grow{flex:1 1 140px}
.bees-column,.bees-box,.bees-work-item-row,.bees-flex-widget,.bees-row-main{min-width:0;overflow-wrap:break-word}
.bees-content,.bees-flex-widget-body{min-width:0}
.bees-content pre,.bees-flex-widget pre{max-width:100%;overflow:auto}
.bees-form>*{min-width:0}
.bees-select,.bees-input,.bees-textarea{max-width:100%}
label>.bees-select{min-width:0}
.bees-column .bees-btn{white-space:normal}
.bees-accounts{width:min(560px,100%)}
.bees-account-auth{display:grid;gap:8px}
.bees-toggle{position:relative;display:inline-flex;align-items:center;cursor:pointer}
.bees-toggle input{position:absolute;opacity:0;pointer-events:none}
.bees-toggle span{display:block;width:38px;height:22px;padding:3px;border-radius:999px;background:var(--dsw-alias-border-l2);transition:background .15s}
.bees-toggle span::after{content:"";display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);box-shadow:0 1px 3px #0005;transition:transform .15s}
.bees-toggle input:checked+span{background:var(--bees-accent)}
.bees-toggle input:checked+span::after{transform:translateX(16px)}
.bees-toggle input:focus-visible+span{outline:2px solid var(--bees-accent);outline-offset:2px}
.bees-toggle input:disabled+span{opacity:.5;cursor:not-allowed}

/* Unified AI Settings Cards */
.bees-stack > section[data-bees-plugin], .bees-appearance-card {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  padding: 24px;
  background: var(--dsw-alias-bg-base);
  box-shadow: 0 2px 8px rgba(0,0,0,0.02);
}
.bees-stack > section[data-bees-plugin] .bees-section-title,
.bees-appearance-card .bees-section-title {
  margin-top: 0;
  font-size: 17px;
  font-weight: 700;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  padding-bottom: 12px;
  margin-bottom: 16px;
}
.bees-stack > section[data-bees-plugin] .bees-box {
  box-shadow: none !important;
  background: transparent !important;
  border-color: var(--dsw-alias-border-l1) !important;
}
/* Demote primary buttons inside plugins to secondary to reduce CTA noise */
.bees-stack > section[data-bees-plugin] .bees-btn.primary {
  background: var(--dsw-alias-interactive-bg-hover) !important;
  color: var(--dsw-alias-label-primary) !important;
  border-color: var(--dsw-alias-border-l1) !important;
  font-weight: 500 !important;
}
.bees-stack > section[data-bees-plugin] .bees-btn.primary:hover {
  background: var(--dsw-alias-border-l2) !important;
}
/* Let the System Default button remain truly primary */
.bees-system-default .bees-btn.primary {
  background: var(--bees-accent) !important;
  color: var(--bees-accent-contrast) !important;
  border-color: var(--bees-accent) !important;
  font-weight: 700 !important;
}
.bees-mcp-grid {
  max-height: none;
  overflow: visible;
}
\n`;

export async function openExternal(url) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (invoke) return invoke("open_external_url", { url });
  // noopener makes window.open return null even when it worked, so cut the opener by hand
  const opened = window.open(url, "_blank");
  if (!opened) throw new Error("Your browser blocked the website window");
  opened.opener = null;
}

function dialogValue(label, initial, confirmOnly = false, inputType = "text", options = null, checkbox = null) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "bees-prompt";
    dialog.setAttribute("closedby", "any");
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (!(rect.top <= event.clientY && event.clientY <= rect.top + rect.height && rect.left <= event.clientX && event.clientX <= rect.left + rect.width)) {
          dialog.close();
        }
      });
    }
    const form = document.createElement("form");
    form.method = "dialog";
    const title = document.createElement("label");
    title.textContent = label;
    form.append(title);
    const input = confirmOnly ? null : document.createElement(options ? "select" : inputType === "textarea" ? "textarea" : "input");
    if (input) {
      input.className = inputType === "textarea" ? "bees-textarea" : "bees-input";
      if (options) for (const option of options) {
        const element = document.createElement("option");
        element.value = option.value;
        element.textContent = option.label;
        input.append(element);
      }
      else if (inputType === "textarea") input.rows = 10;
      else input.type = inputType;
      input.value = initial || options?.[0]?.value || "";
      input.setAttribute("aria-label", label.split("\n")[0]);
      form.append(input);
    }
    let checkboxInput = null;
    if (checkbox) {
      const checkboxLabel = document.createElement("label");
      checkboxLabel.className = "bees-prompt-checkbox";
      checkboxInput = document.createElement("input");
      checkboxInput.type = "checkbox";
      checkboxInput.checked = checkbox.checked;
      checkboxLabel.append(checkboxInput, checkbox.label);
      form.append(checkboxLabel);
    }
    const actions = document.createElement("div");
    actions.className = "bees-prompt-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "bees-btn";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => dialog.close());
    const submit = document.createElement("button");
    submit.className = "bees-btn primary";
    // escape closes a dialog with an empty return value too, so only this button may confirm
    submit.value = "ok";
    submit.textContent = confirmOnly ? "Confirm" : "Continue";
    actions.append(cancel, submit);
    form.append(actions);
    dialog.append(form);
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      const value = dialog.returnValue !== "ok" ? null : input ? input.value.trim() : true;
      dialog.remove();
      resolve(value === null || !checkboxInput ? value : { value, checked: checkboxInput.checked });
    }, { once: true });
    requestAnimationFrame(() => { dialog.showModal(); input?.focus(); input?.select?.(); });
  });
}

export const ask = (label, initial = "", inputType = "text") => dialogValue(label, initial, false, inputType);
export const choose = (label, options) => dialogValue(label, "", false, "text", options);
export const confirmAction = (label) => dialogValue(label, "", true);
export const oneLine = (text, max = 110) => { const flat = String(text ?? "").replace(/\s+/g, " ").trim(); return flat.length > max ? flat.slice(0, max - 1) + "…" : flat; };
export const Button = ({ children, className = "", ...props }) =>
  h("button", { type: "button", className: `bees-btn ${className}`, ...props }, children);
