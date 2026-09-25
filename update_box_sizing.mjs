import fs from 'fs';
const file = '/Users/shyam/Projects/Funcove/bees.bot/bees-desktop/dsh-runtime/plugin/client/shared.js';
let content = fs.readFileSync(file, 'utf8');

const target = `.bees-btn,.bees-select,.bees-input,.bees-textarea{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;background:var(--dsw-alias-bg-base);font:inherit;box-shadow:0 1px 2px rgba(0,0,0,0.03);transition:border-color 0.15s, box-shadow 0.15s}`;
const replacement = `.bees-btn,.bees-select,.bees-input,.bees-textarea{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;background:var(--dsw-alias-bg-base);font:inherit;box-shadow:0 1px 2px rgba(0,0,0,0.03);transition:border-color 0.15s, box-shadow 0.15s}`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync(file, content);
  console.log("Updated shared.js box-sizing");
} else {
  console.log("Could not find target in shared.js");
}
