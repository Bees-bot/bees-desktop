import { h } from "./runtime.js";
export const css = `

/* the hidden attribute has to beat the display rules below */
.bees-app [hidden]{display:none!important}

  /* Keep host chrome hidden; native conversation/file panels render through Bees' portal targets. */
  :has(>[data-shell-overlay])>:not([data-shell-overlay]){visibility:hidden;pointer-events:none}
  .bees-app{--bees-accent:#10b981;--bees-accent-soft:#10b98120;--bees-accent-contrast:#04130d;position:absolute;inset:0;z-index:90;display:grid;grid-template-columns:280px 1fr;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji";pointer-events:auto}
  .bees-app *{box-sizing:border-box}.bees-mark{display:grid;place-items:center;flex:none;width:28px;height:28px;border-radius:9px;background:#f2b84b;color:#21190b}.bees-btn, .bees-input, .bees-textarea {box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;background:var(--dsw-alias-bg-base);font:inherit;box-shadow:0 1px 2px rgba(0,0,0,0.03);transition:border-color 0.15s, box-shadow 0.15s}.bees-btn{display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;min-height:34px;cursor:pointer;vertical-align:middle}.bees-btn:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l1)}
.bees-input:focus, .bees-textarea:focus {border-color:var(--bees-accent);outline:none;box-shadow:0 0 0 3px var(--bees-accent-soft)}.bees-btn.danger{color:#d15353}.bees-btn:disabled{opacity:.5;cursor:not-allowed}.bees-input {padding:8px 12px;min-height:34px}
.bees-textarea{padding:10px 12px}input[type=file]{color:var(--dsw-alias-label-secondary);font:inherit}input[type=file]::file-selector-button{margin-right:10px;padding:6px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;color:inherit;background:var(--dsw-alias-bg-base);font:inherit;cursor:pointer}.bees-input,.bees-textarea{width:100%}.bees-textarea{min-height:88px;resize:vertical}
  .bees-muted{color:var(--dsw-alias-label-secondary);font-size:12px}.bees-box{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;background:var(--dsw-alias-bg-base)}.bees-box h2,.bees-box h3{margin:0 0 9px}.bees-error{margin:10px 18px 0;padding:9px 12px;border-radius:8px;background:#a9363622;color:#d45d5d}.bees-status{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--dsw-alias-label-secondary)}.bees-running{color:#2e9b61}.bees-card-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.bees-card-actions .bees-btn{padding:4px 7px;font-size:11px}
  .bees-prompt{width:min(540px,calc(100vw - 32px));color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:0;box-shadow:0 18px 60px #0006}.bees-prompt::backdrop{background:#0008}.bees-prompt form{display:grid;gap:14px;padding:20px}.bees-prompt label{white-space:pre-wrap;font-weight:700}.bees-prompt-checkbox{display:flex;align-items:center;gap:8px;font-weight:500!important;cursor:pointer}.bees-prompt-checkbox input{width:16px;height:16px;margin:0;accent-color:var(--bees-accent)}.bees-prompt-actions{display:flex;justify-content:flex-end;gap:8px}
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

function dialogValue(label, initial, confirmOnly = false, inputType = "text", placeholder = "") {
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
    submit.className = "bees-btn primary";
    // escape closes a dialog with an empty return value too, so only this button may confirm
    submit.value = "ok";
    submit.textContent = confirmOnly ? "Confirm" : "Continue";
    actions.append(cancel, submit);
    form.append(actions);
    dialog.append(form);
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
export const confirmAction = (label) => dialogValue(label, "", true);
export const Button = ({ children, className = "", ...props }) =>
  h("button", { type: "button", className: `bees-btn ${className}`, ...props }, children);
