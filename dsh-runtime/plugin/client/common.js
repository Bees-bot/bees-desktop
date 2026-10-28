import { h } from "./runtime.js";
export const css = `

/* the hidden attribute has to beat the display rules below */
.bees-app [hidden]{display:none!important}

  /* Keep host chrome hidden; native conversation/file panels render through Bees' portal targets. */
  :has(>[data-shell-overlay])>:not([data-shell-overlay]){visibility:hidden;pointer-events:none}
  .bees-app{--bees-accent:#10b981;--bees-accent-soft:#10b98120;--bees-accent-contrast:#04130d;position:absolute;inset:0;z-index:90;display:grid;grid-template-columns:280px 1fr;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji";pointer-events:auto}
  .bees-app *{box-sizing:border-box}.bees-mark{display:grid;place-items:center;flex:none;width:28px;height:28px;border-radius:9px;background:#f2b84b;color:#21190b}.bees-btn, .bees-input, .bees-textarea {box-sizing:border-box;border:1px solid var(--line,var(--dsw-alias-border-l2));border-radius:9px;color:var(--ink,inherit);background:var(--surface,var(--dsw-alias-bg-base));font:inherit;font-size:13px;transition:border-color 0.15s, box-shadow 0.15s}.bees-btn{display:inline-flex;align-items:center;justify-content:center;padding:7px 13px;min-height:36px;cursor:pointer;vertical-align:middle;font-weight:550;gap:7px}.bees-btn:hover{background:var(--surface-alt,var(--dsw-alias-interactive-bg-hover));border-color:color-mix(in srgb,var(--ink,inherit) 20%,var(--line,var(--dsw-alias-border-l1)))}.bees-btn:disabled{opacity:.45;cursor:not-allowed;pointer-events:none}
.bees-input:focus, .bees-textarea:focus {border-color:var(--accent,var(--bees-accent));outline:none;box-shadow:0 0 0 3px var(--soft,var(--bees-accent-soft))}.bees-btn.danger{color:#d15353!important;background:color-mix(in srgb,#d15353 10%,var(--surface,#fff))!important;border-color:color-mix(in srgb,#d15353 30%,var(--line,#e9ebe5))!important}.bees-btn.danger:hover{background:color-mix(in srgb,#d15353 20%,var(--surface,#fff))!important}.bees-input {padding:7px 11px;min-height:36px;width:100%}
.bees-textarea{padding:9px 11px;min-height:80px;resize:vertical;width:100%;line-height:1.5}input[type=file]{color:var(--dsw-alias-label-secondary);font:inherit}input[type=file]::file-selector-button{margin-right:10px;padding:5px 10px;border:1px solid var(--line,var(--dsw-alias-border-l1));border-radius:8px;color:inherit;background:var(--surface,var(--dsw-alias-bg-base));font:inherit;font-size:12px;font-weight:550;cursor:pointer;transition:background .15s,border-color .15s}.bees-input,.bees-textarea{width:100%}
  .bees-muted{color:var(--dsw-alias-label-secondary);font-size:12px}.bees-box{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;background:var(--dsw-alias-bg-base)}.bees-box h2,.bees-box h3{margin:0 0 9px}.bees-error{margin:10px 18px 0;padding:9px 12px;border-radius:8px;background:#a9363622;color:#d45d5d}.bees-status{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--dsw-alias-label-secondary)}.bees-running{color:#2e9b61}.bees-card-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.bees-card-actions .bees-btn{padding:4px 7px;font-size:11px}
  .bees-prompt{width:min(540px,calc(100vw - 32px));color:var(--ink,var(--dsw-alias-label-primary));background:var(--surface,var(--dsw-alias-bg-base));border:1px solid var(--line,var(--dsw-alias-border-l2));border-radius:16px;padding:0;box-shadow:0 20px 60px rgba(0,0,0,0.3);font-family:inherit}.bees-prompt::backdrop{background:rgba(0,0,0,0.45);backdrop-filter:blur(3px)}.bees-prompt form{display:grid;gap:14px;padding:20px}.bees-prompt label{white-space:pre-wrap;font-weight:700}.bees-prompt-checkbox{display:flex;align-items:center;gap:8px;font-weight:500!important;cursor:pointer}.bees-prompt-checkbox input{width:16px;height:16px;margin:0;accent-color:var(--accent,var(--bees-accent))}.bees-prompt-actions{display:flex;justify-content:flex-end;gap:8px}.bees-prompt .bees-btn{background:var(--surface,#fff);color:var(--ink,#242820);border:1px solid var(--line,#e9ebe5);border-radius:9px;font-family:inherit;font-size:13px;font-weight:550;transition:background 0.15s,border-color 0.15s}.bees-prompt .bees-btn:hover{background:var(--surface-alt,#f4f5f1)}.bees-prompt .bees-btn.primary{background:var(--accent,var(--bees-accent))!important;color:var(--accent-contrast,var(--bees-accent-contrast,#fff))!important;border-color:var(--accent,var(--bees-accent))!important}.bees-prompt .bees-btn.danger{background:color-mix(in srgb,#d9534f 15%,var(--surface,#fff))!important;color:#d9534f!important;border-color:color-mix(in srgb,#d9534f 40%,var(--line,#e9ebe5))!important}.bees-prompt .bees-btn.danger:hover{background:color-mix(in srgb,#d9534f 25%,var(--surface,#fff))!important}.bees-prompt .bees-input,.bees-prompt .bees-textarea{background:var(--surface,#fff);color:var(--ink,#242820);border:1px solid var(--line,#e9ebe5);font-family:inherit}.bees-prompt .bees-input:focus,.bees-prompt .bees-textarea:focus{border-color:var(--accent,var(--bees-accent));box-shadow:0 0 0 3px var(--soft,rgba(113,125,75,0.15))}
  .bees-loading{grid-column:1/-1;display:grid;place-items:center;height:100%;color:var(--dsw-alias-label-secondary)}
  .bees-stack{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}.bees-badge{display:inline-flex;padding:2px 7px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:10px;text-transform:uppercase}.bees-section-title{margin:20px 0 8px}.bees-section-title:first-child{margin-top:0}.bees-callout{margin-bottom:14px;padding:12px 14px;border-left:3px solid #f2b84b;border-radius:8px;background:#f2b84b12}.bees-callout h3{margin:0 0 4px}.bees-mark,.bees-btn.primary{background:var(--bees-accent);color:var(--bees-accent-contrast);border-color:var(--bees-accent);font-weight:700}@media(max-width:780px){.bees-app{grid-template-columns:76px 1fr}}
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

/* Nothing may poke out of its box: rows wrap, flex children may shrink, long words break, code scrolls inside. */
.bees-box {min-width:0;overflow-wrap:break-word}
.bees-input, .bees-textarea {max-width:100%}

/* Unified AI Settings Cards */
.bees-stack > section[data-bees-plugin] {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  padding: 24px;
  background: var(--dsw-alias-bg-base);
  box-shadow: 0 2px 8px rgba(0,0,0,0.02);
}
.bees-stack > section[data-bees-plugin] .bees-section-title {
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
.bees-empty-state { display: flex; align-items: center; gap: 10px; color: var(--dsw-alias-label-secondary); }
.bees-empty-state svg { width: 22px; height: 22px; flex-shrink: 0; }
\n`;

export async function openExternal(url) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (invoke) return invoke("open_external_url", { url });
  // noopener makes window.open return null even when it worked, so cut the opener by hand
  const opened = window.open(url, "_blank");
  if (!opened) throw new Error("Your browser blocked the website window");
  opened.opener = null;
}

function dialogValue(label, initial, confirmOnly = false, inputType = "text", placeholder = "", action = "Confirm") {
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
    const input = confirmOnly ? null : document.createElement(inputType === "textarea" ? "textarea" : "input");
    if (input) {
      input.className = inputType === "textarea" ? "bees-textarea" : "bees-input";
      if (inputType === "textarea") input.rows = 10;
      else input.type = inputType;
      input.value = initial || "";
      input.placeholder = placeholder;
      input.setAttribute("aria-label", label.split("\n")[0]);
      form.append(input);
    }
    const actions = document.createElement("div");
    actions.className = "bees-prompt-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "bees-btn";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => dialog.close());
    const submit = document.createElement("button");
    const isDanger = confirmOnly && ["Delete", "Remove", "Leave", "Forget"].some(w => action.includes(w));
    submit.className = "bees-btn " + (isDanger ? "danger" : "primary");
    // escape closes a dialog with an empty return value too, so only this button may confirm
    submit.value = "ok";
    submit.textContent = confirmOnly ? action : "Continue";
    actions.append(cancel, submit);
    form.append(actions);
    dialog.append(form);
    const appEl = document.querySelector(".bc-app");
    if (appEl) {
      for (let i = 0; i < appEl.style.length; i++) {
        const key = appEl.style[i];
        if (key.startsWith("--")) dialog.style.setProperty(key, appEl.style.getPropertyValue(key));
      }
      if (appEl.style.colorScheme) dialog.style.colorScheme = appEl.style.colorScheme;
    }
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(dialog.returnValue !== "ok" ? null : input ? input.value.trim() : true);
    }, { once: true });
    requestAnimationFrame(() => { dialog.showModal(); input?.focus(); input?.select(); });
  });
}

export const ask = (label, initial = "", inputType = "text", placeholder = "") => dialogValue(label, initial, false, inputType, placeholder);
// folders come through a drop as unreadable entries, so only plain files are kept
export const droppedFiles = event => [...(event.dataTransfer?.items ?? [])].filter(item => item.kind === 'file' && !item.webkitGetAsEntry?.()?.isDirectory).map(item => item.getAsFile()).filter(Boolean);
// spreadsheets copy a picture next to the text, so a paste with text stays text. every screenshot is image.png, so each gets its own name
export const pastedFiles = event => event.clipboardData?.types.includes('text/plain') ? [] : [...(event.clipboardData?.files ?? [])].map((file, i) => /^image\.\w+$/.test(file.name) ? new File([file], `pasted-${new Date().toTimeString().slice(0, 8).replaceAll(':', '')}${i ? '-' + (i + 1) : ''}.${file.name.split('.').pop()}`, { type: file.type }) : file);
export const when = value => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export const confirmAction = (label, action) => dialogValue(label, "", true, "text", "", action);
export const Button = ({ children, className = "", ...props }) =>
  h("button", { type: "button", className: `bees-btn ${className}`, ...props }, children);
