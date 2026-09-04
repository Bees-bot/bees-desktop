import { h, React, useEffect, useRef, useState } from "./runtime.js";

import { HomeIcon, WorkIcon, AgentsIcon, ProcessesIcon, FilesIcon, ActivityIcon, KnowledgeIcon, SettingsIcon } from "./icons.js";

export const NAVIGATION = [
  { id: "home", label: "Home", icon: HomeIcon, defaultChild: "home", children: [] },
  { id: "work", label: "Process Runs", icon: WorkIcon, defaultChild: "all-work", children: [
    ["all-work", "All process runs"], ["schedules", "Schedules"]
  ] },
  { id: "processes", label: "Process Templates", icon: ProcessesIcon, defaultChild: "all-processes", children: [] },
  { id: "agents", label: "Agents", icon: AgentsIcon, defaultChild: "all-agents", children: [
    ["all-agents", "Agents, pools & presets"],
    ["skills", "Skills & tools"], ["mcp", "MCP servers"]
  ] },
  { id: "files", label: "Files & Folders", icon: FilesIcon, defaultChild: "locations", children: [] },
  { id: "activity", label: "Activity", icon: ActivityIcon, defaultChild: "runs", children: [
    ["runs", "Executions"], ["evaluations", "Evaluations"], ["audit", "Audit"]
  ] },
  { id: "knowledge", label: "Knowledge Base", icon: KnowledgeIcon, defaultChild: "search", children: [
    ["search", "Search & sources"], ["artifacts", "Artifacts"]
  ] },
  { id: "settings", label: "Settings", icon: SettingsIcon, defaultChild: "organizations", children: [
    ["organizations", "Account & invitations"], ["connections", "Connections"],
    ["organization-settings", "Organization general"], ["organization-members", "Organization members"],
    ["organization-invitations", "Organization invitations"], ["organization-ai", "Connect AI"],
    ["organization-workspace", "Organization workspace"], ["organization-authentication", "Organization authentication"],
    ["team-settings", "Team members"], ["personal-ai", "AI connections"],
    ["appearance", "Appearance"], ["system-instructions", "System instructions"]
  ] }
];

const OLD_THEME_IDS = [
  "light", "dark", "cupcake", "bumblebee", "emerald", "corporate", "synthwave",
  "retro", "cyberpunk", "valentine", "halloween", "garden", "forest", "aqua",
  "lofi", "pastel", "fantasy", "wireframe", "black", "luxury", "dracula", "cmyk",
  "autumn", "business", "acid", "lemonade", "night", "coffee", "winter", "dim",
  "nord", "sunset", "caramellatte", "abyss", "silk"
];
// Exact DaisyUI 5.7 palettes used by old Bees.
const OLD_THEME_PALETTES = {
  "light": ["light","oklch(45% 0.24 277.023)","oklch(93% 0.034 272.788)","oklch(65% 0.241 354.308)","oklch(77% 0.152 181.912)","oklch(100% 0 0)","oklch(98% 0 0)","oklch(95% 0 0)","oklch(21% 0.006 285.885)"],
  "dark": ["dark","oklch(58% 0.233 277.117)","oklch(96% 0.018 272.314)","oklch(65% 0.241 354.308)","oklch(77% 0.152 181.912)","oklch(25.33% 0.016 252.42)","oklch(23.26% 0.014 253.1)","oklch(21.15% 0.012 254.09)","oklch(97.807% 0.029 256.847)"],
  "cupcake": ["light","oklch(85% 0.138 181.071)","oklch(43% 0.078 188.216)","oklch(89% 0.061 343.231)","oklch(90% 0.076 70.697)","oklch(97.788% 0.004 56.375)","oklch(93.982% 0.007 61.449)","oklch(91.586% 0.006 53.44)","oklch(23.574% 0.066 313.189)"],
  "bumblebee": ["light","oklch(85% 0.199 91.936)","oklch(42% 0.095 57.708)","oklch(75% 0.183 55.934)","oklch(0% 0 0)","oklch(100% 0 0)","oklch(97% 0 0)","oklch(92% 0 0)","oklch(20% 0 0)"],
  "emerald": ["light","oklch(76.662% 0.135 153.45)","oklch(33.387% 0.04 162.24)","oklch(61.302% 0.202 261.294)","oklch(72.772% 0.149 33.2)","oklch(100% 0 0)","oklch(93% 0 0)","oklch(86% 0 0)","oklch(35.519% 0.032 262.988)"],
  "corporate": ["light","oklch(58% 0.158 241.966)","oklch(100% 0 0)","oklch(55% 0.046 257.417)","oklch(60% 0.118 184.704)","oklch(100% 0 0)","oklch(93% 0 0)","oklch(86% 0 0)","oklch(22.389% 0.031 278.072)"],
  "synthwave": ["dark","oklch(71% 0.202 349.761)","oklch(28% 0.109 3.907)","oklch(82% 0.111 230.318)","oklch(75% 0.183 55.934)","oklch(15% 0.09 281.288)","oklch(20% 0.09 281.288)","oklch(25% 0.09 281.288)","oklch(78% 0.115 274.713)"],
  "retro": ["light","oklch(80% 0.114 19.571)","oklch(39% 0.141 25.723)","oklch(92% 0.084 155.995)","oklch(68% 0.162 75.834)","oklch(91.637% 0.034 90.515)","oklch(88.272% 0.049 91.774)","oklch(84.133% 0.065 90.856)","oklch(41% 0.112 45.904)"],
  "cyberpunk": ["light","oklch(74.22% 0.209 6.35)","oklch(14.844% 0.041 6.35)","oklch(83.33% 0.184 204.72)","oklch(71.86% 0.217 310.43)","oklch(94.51% 0.179 104.32)","oklch(91.51% 0.179 104.32)","oklch(85.51% 0.179 104.32)","oklch(0% 0 0)"],
  "valentine": ["light","oklch(65% 0.241 354.308)","oklch(100% 0 0)","oklch(62% 0.265 303.9)","oklch(82% 0.111 230.318)","oklch(97% 0.014 343.198)","oklch(94% 0.028 342.258)","oklch(89% 0.061 343.231)","oklch(52% 0.223 3.958)"],
  "halloween": ["dark","oklch(77.48% 0.204 60.62)","oklch(19.693% 0.004 196.779)","oklch(45.98% 0.248 305.03)","oklch(64.8% 0.223 136.073)","oklch(21% 0.006 56.043)","oklch(14% 0.004 49.25)","oklch(0% 0 0)","oklch(84.955% 0 0)"],
  "garden": ["light","oklch(62.45% 0.278 3.836)","oklch(100% 0 0)","oklch(48.495% 0.11 355.095)","oklch(56.273% 0.054 154.39)","oklch(92.951% 0.002 17.197)","oklch(86.445% 0.002 17.197)","oklch(79.938% 0.001 17.197)","oklch(16.961% 0.001 17.32)"],
  "forest": ["dark","oklch(68.628% 0.185 148.958)","oklch(0% 0 0)","oklch(69.776% 0.135 168.327)","oklch(70.628% 0.119 185.713)","oklch(20.84% 0.008 17.911)","oklch(18.522% 0.007 17.911)","oklch(16.203% 0.007 17.911)","oklch(83.768% 0.001 17.911)"],
  "aqua": ["dark","oklch(85.661% 0.144 198.645)","oklch(40.124% 0.068 197.603)","oklch(60.682% 0.108 309.782)","oklch(93.426% 0.102 94.555)","oklch(37% 0.146 265.522)","oklch(28% 0.091 267.935)","oklch(22% 0.091 267.935)","oklch(90% 0.058 230.902)"],
  "lofi": ["light","oklch(15.906% 0 0)","oklch(100% 0 0)","oklch(21.455% 0.001 17.278)","oklch(26.861% 0 0)","oklch(100% 0 0)","oklch(97% 0 0)","oklch(94% 0 0)","oklch(0% 0 0)"],
  "pastel": ["light","oklch(90% 0.063 306.703)","oklch(49% 0.265 301.924)","oklch(89% 0.058 10.001)","oklch(90% 0.093 164.15)","oklch(100% 0 0)","oklch(98.462% 0.001 247.838)","oklch(92.462% 0.001 247.838)","oklch(20% 0 0)"],
  "fantasy": ["light","oklch(37.45% 0.189 325.02)","oklch(87.49% 0.037 325.02)","oklch(53.92% 0.162 241.36)","oklch(75.98% 0.204 56.72)","oklch(100% 0 0)","oklch(93% 0 0)","oklch(86% 0 0)","oklch(27.807% 0.029 256.847)"],
  "wireframe": ["light","oklch(87% 0 0)","oklch(26% 0 0)","oklch(87% 0 0)","oklch(87% 0 0)","oklch(100% 0 0)","oklch(97% 0 0)","oklch(94% 0 0)","oklch(20% 0 0)"],
  "black": ["dark","oklch(35% 0 0)","oklch(100% 0 0)","oklch(35% 0 0)","oklch(35% 0 0)","oklch(0% 0 0)","oklch(19% 0 0)","oklch(22% 0 0)","oklch(87.609% 0 0)"],
  "luxury": ["dark","oklch(100% 0 0)","oklch(20% 0 0)","oklch(27.581% 0.064 261.069)","oklch(36.674% 0.051 338.825)","oklch(14.076% 0.004 285.822)","oklch(20.219% 0.004 308.229)","oklch(23.219% 0.004 308.229)","oklch(75.687% 0.123 76.89)"],
  "dracula": ["dark","oklch(75.461% 0.183 346.812)","oklch(15.092% 0.036 346.812)","oklch(74.202% 0.148 301.883)","oklch(83.392% 0.124 66.558)","oklch(28.822% 0.022 277.508)","oklch(26.805% 0.02 277.508)","oklch(24.787% 0.019 277.508)","oklch(97.747% 0.007 106.545)"],
  "cmyk": ["light","oklch(71.772% 0.133 239.443)","oklch(14.354% 0.026 239.443)","oklch(64.476% 0.202 359.339)","oklch(94.228% 0.189 105.306)","oklch(100% 0 0)","oklch(95% 0 0)","oklch(90% 0 0)","oklch(20% 0 0)"],
  "autumn": ["light","oklch(40.723% 0.161 17.53)","oklch(88.144% 0.032 17.53)","oklch(61.676% 0.169 23.865)","oklch(73.425% 0.094 60.729)","oklch(95.814% 0 0)","oklch(89.107% 0 0)","oklch(82.4% 0 0)","oklch(19.162% 0 0)"],
  "business": ["dark","oklch(41.703% 0.099 251.473)","oklch(88.34% 0.019 251.473)","oklch(64.092% 0.027 229.389)","oklch(67.271% 0.167 35.791)","oklch(24.353% 0 0)","oklch(22.648% 0 0)","oklch(20.944% 0 0)","oklch(84.87% 0 0)"],
  "acid": ["light","oklch(71.9% 0.357 330.759)","oklch(14.38% 0.071 330.759)","oklch(73.37% 0.224 48.25)","oklch(92.78% 0.264 122.962)","oklch(98% 0 0)","oklch(95% 0 0)","oklch(91% 0 0)","oklch(0% 0 0)"],
  "lemonade": ["light","oklch(58.92% 0.199 134.6)","oklch(11.784% 0.039 134.6)","oklch(77.75% 0.196 111.09)","oklch(85.39% 0.201 100.73)","oklch(98.71% 0.02 123.72)","oklch(91.8% 0.018 123.72)","oklch(84.89% 0.017 123.72)","oklch(19.742% 0.004 123.72)"],
  "night": ["dark","oklch(75.351% 0.138 232.661)","oklch(15.07% 0.027 232.661)","oklch(68.011% 0.158 276.934)","oklch(72.36% 0.176 350.048)","oklch(20.768% 0.039 265.754)","oklch(19.314% 0.037 265.754)","oklch(17.86% 0.034 265.754)","oklch(84.153% 0.007 265.754)"],
  "coffee": ["dark","oklch(71.996% 0.123 62.756)","oklch(14.399% 0.024 62.756)","oklch(34.465% 0.029 199.194)","oklch(42.621% 0.074 224.389)","oklch(24% 0.023 329.708)","oklch(21% 0.021 329.708)","oklch(16% 0.019 329.708)","oklch(72.354% 0.092 79.129)"],
  "winter": ["light","oklch(56.86% 0.255 257.57)","oklch(91.372% 0.051 257.57)","oklch(42.551% 0.161 282.339)","oklch(59.939% 0.191 335.171)","oklch(100% 0 0)","oklch(97.466% 0.011 259.822)","oklch(93.268% 0.016 262.751)","oklch(41.886% 0.053 255.824)"],
  "dim": ["dark","oklch(86.133% 0.141 139.549)","oklch(17.226% 0.028 139.549)","oklch(73.375% 0.165 35.353)","oklch(74.229% 0.133 311.379)","oklch(30.857% 0.023 264.149)","oklch(28.036% 0.019 264.182)","oklch(26.346% 0.018 262.177)","oklch(82.901% 0.031 222.959)"],
  "nord": ["light","oklch(59.435% 0.077 254.027)","oklch(11.887% 0.015 254.027)","oklch(69.651% 0.059 248.687)","oklch(77.464% 0.062 217.469)","oklch(95.127% 0.007 260.731)","oklch(93.299% 0.01 261.788)","oklch(89.925% 0.016 262.749)","oklch(32.437% 0.022 264.182)"],
  "sunset": ["dark","oklch(74.703% 0.158 39.947)","oklch(14.94% 0.031 39.947)","oklch(72.537% 0.177 2.72)","oklch(71.294% 0.166 299.844)","oklch(22% 0.019 237.69)","oklch(20% 0.019 237.69)","oklch(18% 0.019 237.69)","oklch(77.383% 0.043 245.096)"],
  "caramellatte": ["light","oklch(0% 0 0)","oklch(100% 0 0)","oklch(22.45% 0.075 37.85)","oklch(46.44% 0.111 37.85)","oklch(98% 0.016 73.684)","oklch(95% 0.038 75.164)","oklch(90% 0.076 70.697)","oklch(40% 0.123 38.172)"],
  "abyss": ["dark","oklch(92% 0.2653 125)","oklch(50% 0.2653 125)","oklch(83.27% 0.0764 298.3)","oklch(43% 0 0)","oklch(20% 0.08 209)","oklch(15% 0.08 209)","oklch(10% 0.08 209)","oklch(90% 0.076 70.697)"],
  "silk": ["light","oklch(23.27% 0.0249 284.3)","oklch(94.22% 0.2505 117.44)","oklch(23.27% 0.0249 284.3)","oklch(23.27% 0.0249 284.3)","oklch(97% 0.0035 67.78)","oklch(95% 0.0081 61.42)","oklch(90% 0.0081 61.42)","oklch(40% 0.0081 61.42)"],
};

export const THEME_PRESETS = OLD_THEME_IDS.map((id) => {
  const [mode, primary, primaryContent, secondary, accent, surface, surfaceAlt, surfaceRaised, foreground] =
    OLD_THEME_PALETTES[id];
  return {
    id, label: id[0].toUpperCase() + id.slice(1), dark: mode === "dark",
    colors: [primary, secondary, accent, surfaceRaised],
    primaryContent, surface, surfaceAlt, surfaceRaised, foreground
  };
}).sort((left, right) => left.label.localeCompare(right.label));

function selectedColorMode(preference, current) {
  return ["dark", "light"].includes(preference.colorMode)
    ? preference.colorMode : current.dark ? "dark" : "light";
}

export function nextThemePreset(preference = {}) {
  const current = THEME_PRESETS.find(({ id }) => id === preference.themePreset)
    ?? THEME_PRESETS.find(({ id }) => id === "forest");
  const currentMode = selectedColorMode(preference, current);
  const fallback = currentMode === "dark" ? "emerald" : "forest";
  const saved = currentMode === "dark" ? preference.lightThemePreset : preference.darkThemePreset;
  return THEME_PRESETS.find(({ id }) => id === saved)
    ?? THEME_PRESETS.find(({ id }) => id === fallback);
}

/** Stable fallback copied from old Bees, so similarly named organizations remain distinct. */
export function defaultOrgColor(seed) {
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 55% 45%)`;
}

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

.bees-app [hidden]{display:none!important}
.bees-ask-setup{max-width:1040px;margin:0 auto;padding:12px 0 32px;min-width:0}
.bees-ask-heading{padding:24px 0 20px}.bees-ask-heading h1{font-size:28px;margin:6px 0 10px}.bees-ask-heading h1:focus{outline:none}
.bees-ask-fields{border:0;margin:0;padding:0;display:grid;gap:16px;min-width:0}
.bees-ask-fields h2{font-size:17px;margin:0}.bees-ask-fields p{margin:0;line-height:1.5}
.bees-ask-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.bees-ask-columns>.bees-box{min-width:0;align-content:start;overflow-wrap:anywhere}
.bees-ask-toggle{display:flex!important;align-items:center;gap:8px;font-weight:500}
.bees-ask-stages{display:grid;gap:10px;padding:12px;border-radius:8px;background:var(--dsw-alias-bg-base)}
.bees-ask-stages>div{display:grid;gap:4px}
.bees-ask-footer{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 0}
.bees-ask-footer .bees-btn{flex-shrink:0}.bees-ask-fields .bees-textarea{min-height:96px}
@media(max-width:760px){.bees-ask-columns{grid-template-columns:1fr}.bees-ask-footer{align-items:stretch;flex-direction:column}.bees-ask-heading h1{font-size:24px}}
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
  padding: 0 !important;
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

.bees-dot-typing { display: inline-block; position: relative; width: 36px; height: 10px; margin-right: 8px; }
.bees-dot-typing::before, .bees-dot-typing::after { content: ""; position: absolute; top: 0; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-secondary); animation: bees-typing 1.4s infinite ease-in-out both; }
.bees-dot-typing::before { left: 0; animation-delay: -0.32s; }
.bees-dot-typing::after { left: 16px; animation-delay: 0s; }
.bees-dot-typing { background: var(--dsw-alias-label-secondary); border-radius: 50%; width: 6px; left: 8px; animation: bees-typing 1.4s infinite ease-in-out both; animation-delay: -0.16s; }
@keyframes bees-typing { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
.bees-convo-msg-interactive { max-width: 100%; width: 100%; padding: 0; background: var(--dsw-alias-bg-base) !important; box-shadow: 0 1px 3px rgba(0,0,0,0.2) !important; border: none !important; }
.bees-convo-msg-interactive > .bees-box, .bees-convo-msg-interactive > .bees-answer-card { margin: 0; border-radius: 12px; border: 1px solid #8A6B27; background: #3D3014; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
.bees-convo-msg-interactive .bees-answer-card h2 { color: #fff; font-size: 16px; margin: 0; }
.bees-convo-msg-interactive .bees-choice { background: #2A2A2A; border-color: #444; color: #fff; }
.bees-convo-msg-interactive .bees-choice:hover { background: #333; }
.bees-convo-msg { padding: 16px; border-radius: 12px; white-space: pre-wrap; font-size: 14px; line-height: 1.5; max-width: 100%; width: 100%; box-sizing: border-box; }
.bees-convo-msg.user { align-self: stretch; background: var(--dsw-alias-interactive-bg-hover); border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); border-radius: 12px; max-width: 100%; }
.bees-convo-msg.agent { align-self: stretch; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; color: var(--dsw-alias-label-primary); max-width: 100%; }
.bees-convo-msg.system { align-self: stretch; background: transparent; color: #888; font-size: 13px; text-align: left; display: flex; align-items: center; gap: 8px; padding: 4px 16px; border: none; max-width: 100%; }
.bees-convo-msg strong { display: block; margin-bottom: 4px; font-size: 12px; font-weight: 500; color: #aaa; }.bees-working-indicator { display: flex; align-items: center; justify-content: center; padding: 12px; font-style: italic; gap: 4px; }


.bees-panel-wide { max-width: none; }
.bees-panel-full-height { height: 100%; display: flex; flex-direction: column; min-height: 0; flex: 1; }
.bees-cockpit-head { flex-shrink: 0; display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
.bees-cockpit-board { flex-shrink: 0; margin-bottom: 16px; }
.bees-workspace-layout { display: grid; grid-template-columns: minmax(0, 5fr) minmax(320px, 4fr); gap: 20px; flex: 1; min-height: 0; }
.bees-convo-panel { display: flex; flex-direction: column; overflow: hidden; background: transparent; border-radius: 12px; }
.bees-convo-history { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding: 4px; padding-bottom: 20px; align-items: stretch; }
.bees-details-panel { display: flex; flex-direction: column; overflow: hidden; }
.bees-details-panel > .bees-box { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.bees-tab-panel { flex: 1; overflow-y: auto; }
.bees-convo-msg { max-width: 100%; padding: 12px 16px; border-radius: 12px; white-space: pre-wrap; font-size: 14px; line-height: 1.5; box-sizing: border-box; }
.bees-convo-msg.user { align-self: stretch; background: #f2b84b33; border: 1px solid #f2b84b55; color: inherit; border-bottom-right-radius: 4px; max-width: 100%; }
.bees-convo-msg.agent { align-self: stretch; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-bottom-left-radius: 4px; max-width: 100%; }
.bees-convo-msg.system { align-self: stretch; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12px; text-align: left; max-width: 100%; }
.bees-convo-msg strong { display: block; margin-bottom: 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.7; }


  .bees-home-layout { display: grid; grid-template-columns: 1.6fr 1fr; gap: 40px; min-height: 100%; align-items: start; padding: 24px 0; }
  .bees-home-main { display: flex; flex-direction: column; gap: 32px; min-width: 0; }
  .bees-home-side { display: flex; flex-direction: column; gap: 16px; min-height: calc(100vh - 106px); min-width: 0; }
  .bees-home-side h3 { margin: 0; font-size: 16px; font-weight: 700; }
  
  .bees-hero { display: flex; flex-direction: column; gap: 20px; }
  .bees-hero h1 { font-size: 32px; font-weight: 800; line-height: 1.2; margin: 0; }
  
  .bees-dashboard{min-width:0}.bees-dashboard-add{position:relative}.bees-dashboard-add>summary{list-style:none}.bees-dashboard-add>summary::-webkit-details-marker{display:none}.bees-dashboard-widget-menu{position:absolute;right:0;top:42px;z-index:120;width:290px;max-height:min(480px,70vh);overflow:auto;display:grid;gap:3px;padding:7px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-base);box-shadow:0 14px 35px #0004}.bees-dashboard-widget-menu button{display:grid;gap:2px;padding:9px;border:0;border-radius:8px;color:inherit;background:transparent;text-align:left;font:inherit;cursor:pointer}.bees-dashboard-widget-menu button:hover{background:var(--dsw-alias-interactive-bg-hover)}.bees-dashboard-widget-menu span{color:var(--dsw-alias-label-secondary);font-size:11px}
  .bees-dashboard-grid{margin:-6px}.bees-dashboard-widget{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-sidebar-fill);box-shadow:0 2px 8px #00000008}.bees-dashboard-grid.editing .bees-dashboard-widget{border-color:#f2b84b88}.bees-dashboard-widget-handle{display:flex;align-items:center;gap:8px;flex:none;min-height:40px;padding:9px 11px;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-dashboard-grid.editing .bees-dashboard-widget-handle{cursor:grab}.bees-dashboard-widget-handle strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-dashboard-remove{display:grid;place-items:center;width:24px;height:24px;margin-left:auto;border:0;border-radius:7px;color:var(--dsw-alias-label-secondary);background:transparent;font:20px/1 inherit;cursor:pointer}.bees-dashboard-remove:hover{color:#d15353;background:var(--dsw-alias-interactive-bg-hover)}.bees-dashboard-widget-body{min-height:0;flex:1;overflow:auto;padding:11px}.bees-dashboard-widget-body>.bees-empty{padding:20px}.bees-dashboard-composer{height:100%;padding:12px}.bees-dashboard-composer .bees-composer-input{min-height:60px;flex:1}.bees-dashboard-composer .bees-error{margin:0}.bees-dashboard-list{display:grid;gap:6px}.bees-dashboard-row{width:100%;padding:8px;border:0;border-radius:8px;color:inherit;background:var(--dsw-alias-bg-base);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;font:inherit;cursor:pointer}.bees-dashboard-row:hover,.bees-dashboard-row.active{background:var(--dsw-alias-interactive-bg-hover)}.bees-dashboard-need-row{display:grid;grid-template-columns:minmax(0,1fr) 32px;gap:4px}.bees-dashboard-need-row .bees-dashboard-row{display:flex;align-items:center;gap:7px}.bees-dashboard-need-copy{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis}.bees-dashboard-launch{display:grid;place-items:center;width:32px;border:0;border-radius:8px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base);font:16px/1 inherit;cursor:pointer}.bees-dashboard-launch:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.bees-dashboard-needs-answer{margin-top:8px}.bees-dashboard-needs .bees-answer-card{min-height:0;padding:12px}.bees-dashboard-needs .bees-answer-head h2{font-size:15px}.bees-dashboard-needs .bees-file-preview{max-height:320px}.bees-dashboard-view-all{position:sticky;bottom:0;margin-top:3px}.bees-dashboard-metrics{height:100%;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.bees-dashboard-metric{display:grid;place-items:center;align-content:center;border-radius:10px;background:var(--dsw-alias-bg-base);text-align:center}.bees-dashboard-metric strong{font-size:25px}.bees-dashboard-metric span{color:var(--dsw-alias-label-secondary);font-size:11px}.bees-dashboard-proposal{padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}.bees-dashboard-proposal p{margin:4px 0}.bees-dashboard .bees-home-templates{gap:7px}.bees-dashboard .bees-template-card{padding:10px}
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
  
  .bees-app{--bees-accent:#10b981;--bees-accent-soft:#10b98120;--bees-accent-contrast:#04130d;position:absolute;inset:0;z-index:90;display:grid;grid-template-columns:240px 1fr;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji";pointer-events:auto}
  [data-bees-debug-dsh] .bees-app{display:none}
  .bees-app *{box-sizing:border-box}.bees-sidebar{min-width:0;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-sidebar-fill);overflow:visible}.bees-brand{display:flex;align-items:center;gap:8px;padding:18px 16px 10px;font-size:19px;font-weight:800}.bees-mark{display:grid;place-items:center;flex:none;width:28px;height:28px;border-radius:9px;background:#f2b84b;color:#21190b}.bees-brand-settings{margin-left:auto}.bees-brand-settings-button,.bees-team-settings,.bees-scope-add,.bees-org-tile,.bees-team-name{border:0;color:inherit;background:transparent;font:inherit;cursor:pointer}.bees-brand-settings-button{display:grid;place-items:center;width:30px;height:30px;padding:0;border-radius:8px;color:var(--dsw-alias-label-secondary)}.bees-brand-settings-button:hover,.bees-brand-settings.active .bees-brand-settings-button{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.bees-brand-settings-button svg{width:17px;height:17px}.bees-brand-settings .bees-nav-flyout{top:calc(100% + 4px);right:0;left:auto;min-width:220px}.bees-scope-switcher{display:grid;gap:8px;margin:0 12px 7px;padding-bottom:8px;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-org-tiles{display:flex;gap:7px;overflow-x:auto;padding:2px}.bees-org-tile{display:grid;place-items:center;flex:0 0 34px;width:34px;height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);font-weight:800;box-shadow:0 1px 2px #0001}.bees-org-tile:hover,.bees-org-tile.active{border-color:#f2b84b;background:#f2b84b1c}.bees-org-tile.active{box-shadow:0 0 0 1px #f2b84b}.bees-scope-add{display:grid;place-items:center;color:var(--dsw-alias-label-secondary);font-size:20px;line-height:1}.bees-scope-add:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.bees-scope-add:disabled{opacity:.4;cursor:not-allowed}.bees-team-heading{display:flex;align-items:center;min-height:24px;padding-left:7px;color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:750;text-transform:uppercase;letter-spacing:.05em}.bees-team-heading span{min-width:0;flex:1}.bees-team-heading .bees-scope-add{width:26px;height:24px;border-radius:7px}.bees-team-list{display:grid;gap:2px;max-height:min(220px,30vh);overflow:auto}.bees-team-row{display:flex;align-items:center;border-radius:8px}.bees-team-row:hover,.bees-team-row.active{background:var(--dsw-alias-interactive-bg-hover)}.bees-team-name{min-width:0;flex:1;padding:7px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}.bees-team-row.active .bees-team-name{font-weight:750}.bees-team-settings{display:grid;place-items:center;flex:none;width:30px;height:30px;margin-right:2px;border-radius:7px;color:var(--dsw-alias-label-secondary);opacity:.7}.bees-team-row:hover .bees-team-settings,.bees-team-row:focus-within .bees-team-settings,.bees-team-row.active .bees-team-settings{opacity:1}.bees-team-settings:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-floating-hover)}.bees-team-settings svg{width:15px;height:15px}
  .bees-scope-switcher{display:flex;min-height:0;flex:1;flex-direction:column;gap:8px;margin:0 10px 7px;padding-bottom:0;border-bottom:0}.bees-org-tiles{flex:none}.bees-org-tile{border:2px solid transparent;color:white;background:var(--bees-org-color,var(--dsw-alias-bg-base));box-shadow:0 1px 2px #0003}.bees-org-tile:hover{filter:brightness(1.12)}.bees-org-tile.active{border-color:var(--bees-accent);background:var(--bees-org-color);box-shadow:0 0 0 1px var(--dsw-alias-bg-base),0 0 0 3px var(--bees-accent)}.bees-org-tile.bees-scope-add{border:1px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:transparent;filter:none}.bees-org-summary{display:grid;gap:2px;min-width:0;padding:5px 7px 7px;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-org-summary-title{display:flex;align-items:center;gap:7px;min-width:0}.bees-org-summary-title strong{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-org-summary-title .bees-badge{flex:none}.bees-org-summary-meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:11px}.bees-team-list{align-content:start;gap:5px;min-height:0;max-height:none;padding:1px}.bees-team-section{overflow:visible;border:1px solid transparent;border-radius:10px}.bees-team-section.active,.bees-team-section.expanded{border-color:color-mix(in srgb,var(--bees-accent) 25%,var(--dsw-alias-border-l1));background:var(--bees-accent-soft);box-shadow:0 1px 3px #0001}.bees-team-row{min-height:36px}.bees-team-toggle{display:flex;align-items:center;min-width:0;flex:1;gap:7px;padding:7px 6px;border:0;color:inherit;background:transparent;text-align:left;font:inherit;cursor:pointer}.bees-team-initial{display:grid;place-items:center;flex:none;width:21px;height:21px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);font-size:10px;font-weight:800}.bees-team-toggle .bees-team-name{min-width:0;flex:1;padding:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-team-section.active .bees-team-name{font-weight:750}.bees-team-nav{display:grid;gap:1px;padding:0 4px 5px}.bees-team-nav .bees-nav-link{padding-block:6px;font-size:12px}.bees-team-nav .bees-nav-link>span:first-child{width:16px!important}.bees-team-nav .bees-nav-menu{display:block}.bees-team-nav .bees-nav-menu:hover,.bees-team-nav .bees-nav-menu.active{background:color-mix(in srgb,var(--bees-accent) 12%,var(--dsw-alias-interactive-bg-hover))}.bees-team-nav .bees-nav-flyout{position:static;min-width:0;margin:0 0 2px 22px;padding:0;border:0;background:transparent;box-shadow:none;pointer-events:auto;opacity:1}
  .bees-nav{display:grid;gap:2px;padding:0 8px 12px;position:relative;min-width:0}.bees-nav-separator{height:1px;background:var(--dsw-alias-border-l1);margin:8px 6px}.bees-nav-menu{display:flex;align-items:center;position:relative;border-radius:8px;transition:background 0.1s}.bees-nav-menu:hover,.bees-nav-menu.active{background:var(--dsw-alias-interactive-bg-hover)}.bees-nav-menu .bees-nav-link{min-width:0;flex:1}.bees-nav-link{min-width:0;display:flex;align-items:center;gap:9px;width:100%;border:0;border-radius:8px;padding:7px 9px;color:inherit;background:transparent;text-align:left;font:inherit;cursor:pointer}.bees-nav-link.active{font-weight:750}.bees-nav-link span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}.bees-nav-child{display:block;padding-left:31px;font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-dashboard-link:hover,.bees-dashboard-link.active{background:var(--dsw-alias-interactive-bg-hover)}.bees-dashboard-link{padding-left:31px}.bees-nav-standard{margin-top:6px;min-width:0}.bees-sidebar-foot{margin-top:auto;padding:10px 12px}.bees-sidebar-foot .bees-nav-link.active{background:var(--dsw-alias-interactive-bg-hover)}
  .bees-nav-flyout{position:absolute;left:calc(100% - 4px);top:0;z-index:100;min-width:180px;display:grid;gap:2px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);box-shadow:0 8px 30px #0003;pointer-events:none;opacity:0;transition:opacity 0.1s}.bees-nav-menu:hover .bees-nav-flyout,.bees-nav-menu:focus-within .bees-nav-flyout{pointer-events:auto;opacity:1}.bees-nav-flyout-item{display:flex;align-items:center;border-radius:8px}.bees-nav-flyout-item:hover,.bees-nav-flyout-item.active{background:var(--dsw-alias-interactive-bg-hover)}.bees-nav-flyout-item .bees-nav-link{padding-left:9px;font-size:13px;color:var(--dsw-alias-label-primary)}
  .bees-main{min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}.bees-top{height:58px;display:flex;align-items:center;gap:8px;padding:0 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-title{font-size:17px;font-weight:800}.bees-context{color:var(--dsw-alias-label-secondary);font-size:12px}.bees-grow{flex:1}.bees-theme-toggle{display:grid;place-items:center;flex:none;width:34px;height:34px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-button-elevated-fill);cursor:pointer}.bees-theme-toggle:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-floating-hover)}.bees-theme-toggle svg{width:16px;height:16px}.bees-theme-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.bees-content{min-height:0;flex:1;overflow:auto;padding:22px;display:flex;flex-direction:column}.bees-panel{width:100%;flex:1;min-height:0;display:flex;flex-direction:column}
  .bees-btn,.bees-select,.bees-input,.bees-textarea{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;background:var(--dsw-alias-button-elevated-fill);font:inherit}.bees-btn{padding:7px 11px;cursor:pointer}.bees-btn:hover{background:var(--dsw-alias-button-floating-hover)}.bees-btn.primary{background:#f2b84b;color:#21190b;border-color:#f2b84b;font-weight:700}.bees-btn.danger{color:#d15353}.bees-btn:disabled{opacity:.5;cursor:not-allowed}.bees-select,.bees-input,.bees-textarea{padding:8px 9px}.bees-input,.bees-textarea{width:100%}.bees-textarea{min-height:88px;resize:vertical}
  .bees-row{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-work-item-row{width:100%;padding-inline:8px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);color:inherit;background:transparent;font:inherit;text-align:left;cursor:pointer}.bees-work-item-row:hover{background:var(--dsw-alias-interactive-bg-hover)}.bees-work-item-row .bees-row-title,.bees-work-item-row .bees-muted{display:block}.bees-row-main{min-width:0;flex:1}.bees-row-title{font-weight:700}.bees-muted{color:var(--dsw-alias-label-secondary);font-size:12px}.bees-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px}.bees-box{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:15px;background:var(--dsw-specific-sidebar-fill)}.bees-box h2,.bees-box h3{margin:0 0 9px}.bees-empty{border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;padding:28px;text-align:center;color:var(--dsw-alias-label-secondary)}.bees-error{margin:10px 18px 0;padding:9px 12px;border-radius:8px;background:#a9363622;color:#d45d5d}.bees-status{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--dsw-alias-label-secondary)}.bees-running{color:#2e9b61}.bees-failed{color:#cf5b5b}
  .bees-hero h1{font-size:32px;line-height:1.15;margin:0 0 10px}.bees-hero form{display:flex;gap:8px;margin-top:20px}.bees-hero .bees-input{font-size:16px}.bees-proposals{margin-top:18px}.bees-change{margin:7px 0;padding:9px;border-radius:8px;background:var(--dsw-alias-bg-base)}
  .bees-board{display:flex;gap:0;overflow-x:auto;padding-bottom:12px}.bees-column{flex:0 0 300px;width:300px;min-height:260px;border-right:1px solid var(--dsw-alias-border-l1);background:transparent}.bees-column:last-child{border-right:none}.bees-column-head{display:flex;padding:12px 16px;font-weight:750;opacity:0.6;font-size:12px;text-transform:uppercase;letter-spacing:0.05em}.bees-count{margin-left:auto;color:var(--dsw-alias-label-secondary)}.bees-cards{display:grid;gap:8px;padding:8px 16px}.bees-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:11px;background:var(--dsw-alias-bg-base)}.bees-card h3{margin:0 0 4px}.bees-card p{white-space:pre-wrap;color:var(--dsw-alias-label-secondary);font-size:12px}.bees-card-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.bees-card-actions .bees-btn{padding:4px 7px;font-size:11px}
  .bees-routing-board{padding-bottom:4px}.bees-routing-board .bees-column{min-height:310px}.bees-routing-controls{margin-top:auto;padding-top:4px;border-top:1px solid var(--dsw-alias-border-l1)}.bees-routing-controls>label{display:grid;gap:5px}
  .bees-create{position:relative}.bees-create[open] summary{background:var(--dsw-alias-interactive-bg-hover)}.bees-create summary{list-style:none}.bees-menu{position:absolute;right:0;top:42px;z-index:5;min-width:190px;display:grid;gap:3px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);box-shadow:0 14px 35px #0004}.bees-menu .bees-nav-link{padding:8px}.bees-search{display:flex;gap:8px;margin-bottom:16px}
  .bees-prompt{width:min(540px,calc(100vw - 32px));color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:0;box-shadow:0 18px 60px #0006}.bees-prompt::backdrop{background:#0008}.bees-prompt form{display:grid;gap:14px;padding:20px}.bees-prompt label{white-space:pre-wrap;font-weight:700}.bees-prompt-checkbox{display:flex;align-items:center;gap:8px;font-weight:500!important;cursor:pointer}.bees-prompt-checkbox input{width:16px;height:16px;margin:0;accent-color:var(--bees-accent)}.bees-prompt-actions{display:flex;justify-content:flex-end;gap:8px}
  .bees-transcript{display:grid;gap:10px;margin-top:14px}.bees-message{padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-specific-sidebar-fill);white-space:pre-wrap}.bees-message strong{display:block;margin-bottom:5px;text-transform:capitalize}.bees-loading{grid-column:1/-1;display:grid;place-items:center;height:100%;color:var(--dsw-alias-label-secondary)}
  .bees-stack{display:grid;gap:12px}.bees-form{display:grid;gap:10px}.bees-form>label{display:grid;gap:5px}.bees-form-row{display:flex;align-items:end;gap:8px;flex-wrap:wrap}.bees-form-row label{display:grid;gap:5px;min-width:160px;flex:1}.bees-form-row .bees-btn{flex:0 0 auto}.bees-badge{display:inline-flex;padding:2px 7px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:10px;text-transform:uppercase}.bees-segmented{display:flex;gap:7px;flex-wrap:wrap}.bees-segmented .active{border-color:#f2b84b;background:#f2b84b22}.bees-section-title{margin:20px 0 8px}.bees-section-title:first-child{margin-top:0}.bees-page-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}.bees-page-head h2{margin:0}.bees-callout{margin-bottom:14px;padding:12px 14px;border-left:3px solid #f2b84b;border-radius:8px;background:#f2b84b12}.bees-callout h3{margin:0 0 4px}.bees-help-grid h3{margin-bottom:4px}.bees-system-default{border:2px solid #f2b84b;background:linear-gradient(135deg,#f2b84b18,transparent 65%)}.bees-system-default form{display:grid;grid-template-columns:minmax(260px,2fr) minmax(190px,1fr) auto;gap:10px;align-items:end}.bees-system-default label{display:grid;gap:5px}.bees-system-default .bees-btn{margin-bottom:1px}.bees-danger-zone{margin-top:16px;border-color:#d1535355}
  .bees-resource-fields{display:grid;gap:9px;margin-top:6px;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-base)}.bees-resource-fields h3{margin:0}.bees-resource-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:7px}.bees-resource-option{display:flex;align-items:flex-start;gap:8px;padding:9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;cursor:pointer}.bees-resource-option>span{display:grid;min-width:0}.bees-resource-option .bees-muted{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-output-field{display:grid;gap:7px;margin-top:6px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}
  .bees-cockpit-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}.bees-cockpit-head h2{margin:0}.bees-cockpit-board{margin-bottom:16px}.bees-hierarchy-card{display:block;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:11px;color:inherit;background:var(--dsw-alias-bg-base);text-align:left;font:inherit;cursor:pointer}.bees-hierarchy-card:hover,.bees-hierarchy-card.active{border-color:#f2b84b;background:#f2b84b12;box-shadow:0 2px 8px rgba(0,0,0,0.1)}.bees-hierarchy-card h3{margin:0 0 4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;white-space:normal;line-height:1.3}.bees-lineage{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-cockpit-detail{display:block}.bees-tabbar{display:flex;align-items:center;gap:8px;margin:-5px -5px 14px;padding:5px;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-tabs{display:flex;min-width:0;gap:4px;overflow-x:auto}.bees-tab-actions{display:flex;flex:none;gap:6px;margin-left:auto}.bees-tab-actions .bees-btn{padding:5px 8px;font-size:12px}.bees-tab{flex:none;padding:7px 10px;border:0;border-radius:8px;color:var(--dsw-alias-label-secondary);background:transparent;font:inherit;cursor:pointer}.bees-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}.bees-tab.active{color:var(--dsw-alias-label-primary);background:#f2b84b22;font-weight:750}.bees-tab:focus-visible{outline:2px solid #f2b84b;outline-offset:1px}.bees-tab-panel{min-height:220px}.bees-detail-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}.bees-run-list{display:grid;gap:6px}.bees-run-row{display:flex;align-items:center;gap:8px;width:100%;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;color:inherit;background:transparent;text-align:left;cursor:pointer}.bees-run-row.active{border-color:#f2b84b}.bees-audit{border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-audit>summary{cursor:pointer;list-style-position:inside}.bees-audit>summary:hover{background:var(--dsw-alias-interactive-bg-hover)}.bees-audit>summary span{display:block}.bees-audit-detail{padding:0 12px 12px 27px}.bees-audit-detail pre{margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.bees-agent-form textarea{min-height:180px}
  .bees-resource-fields{min-width:0}.bees-resource-fields>.bees-resource-list{grid-template-columns:minmax(0,1fr)}.bees-resource-fields h3{font-size:13px}.bees-resource-controls{display:flex;flex-wrap:wrap;gap:6px;min-width:0}.bees-resource-controls .bees-select{flex:1 1 180px;min-width:0;width:100%}.bees-resource-fields .bees-btn{padding:5px 8px;font-size:12px}.bees-resource-option{align-items:center;padding:6px;cursor:default}.bees-resource-copy{display:flex;align-items:center;gap:8px;min-width:0;flex:1}.bees-resource-copy>span{display:grid;min-width:0}.bees-resource-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-resource-option>.bees-btn{flex-shrink:0}.bees-file-preview-head{display:flex;align-items:center;gap:8px}.bees-file-preview-head>strong{min-width:0;overflow:hidden;text-overflow:ellipsis;flex:1}.bees-file-preview .bees-resource-list .bees-btn{text-align:left;white-space:normal;overflow-wrap:anywhere}
  .bees-inbox{display:grid;grid-template-columns:minmax(230px,.72fr) minmax(360px,1.28fr);gap:12px;align-items:start}.bees-inbox-list{display:grid;gap:7px}.bees-inbox-row{display:grid;grid-template-columns:10px minmax(0,1fr) auto;align-items:center;gap:9px;width:100%;padding:11px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;color:inherit;background:var(--dsw-specific-sidebar-fill);text-align:left;font:inherit;cursor:pointer}.bees-inbox-row:hover,.bees-inbox-row.active{border-color:#f2b84b;background:#f2b84b12}.bees-inbox-dot{width:8px;height:8px;border-radius:50%;background:#f2b84b}.bees-inbox-copy{min-width:0}.bees-inbox-copy strong,.bees-inbox-copy span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-answer-card{display:grid;gap:14px;min-height:270px}.bees-answer-head{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap}.bees-answer-head h2{margin:2px 0 0;font-size:20px}.bees-answer-controls{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}.bees-answer-controls .bees-btn{padding:6px 9px;font-size:12px}.bees-question-detail{padding:10px 12px;border-radius:9px;background:var(--dsw-alias-bg-base)}.bees-question-options{display:grid;gap:8px}.bees-choice{display:flex;align-items:flex-start;gap:9px;width:100%;padding:11px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;color:inherit;background:var(--dsw-alias-bg-base);text-align:left;font:inherit;cursor:pointer}.bees-choice:hover,.bees-choice.selected{border-color:#f2b84b;background:#f2b84b16}.bees-choice-mark{display:grid;place-items:center;flex:0 0 22px;height:22px;border-radius:7px;background:var(--dsw-alias-interactive-bg-hover);font-size:11px}.bees-choice.selected .bees-choice-mark{background:#f2b84b;color:#21190b}.bees-choice-copy{display:grid;gap:2px}.bees-answer-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.bees-file-list{display:flex;gap:6px;flex-wrap:wrap;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}.bees-file-chip{max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-file-chip.active{border-color:#f2b84b;background:#f2b84b16}.bees-file-preview-body pre,.bees-file-preview pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}.bees-blocked{margin-top:18px}
  .bees-flex-page{min-width:0}.bees-page-actions{display:flex;align-items:center;gap:8px}.bees-page-actions .bees-btn{padding:5px 9px;font-size:12px}.bees-flex-grid{margin:-6px}.bees-flex-widget{display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-sidebar-fill);box-shadow:0 2px 8px #00000008}.bees-flex-grid.editing .bees-flex-widget{border-color:#f2b84b88}.bees-flex-widget-handle{display:flex;align-items:center;gap:8px;flex:none;min-height:40px;padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-flex-widget-handle>strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-flex-widget-actions{display:flex;align-items:center;flex:none;gap:6px;margin-left:auto}.bees-flex-widget-actions .bees-btn{padding:5px 9px;font-size:12px}.bees-flex-grid.editing .bees-flex-widget-handle{cursor:grab}.bees-flex-widget-body{min-height:0;flex:1;overflow:auto}.bees-page-grid .bees-flex-widget-body{padding:11px}.bees-flex-widget-body>.bees-cockpit-board{margin:0;padding:10px}.bees-flex-widget-body>.bees-convo-panel{height:100%;border:0;border-radius:0}.bees-flex-widget-body>.bees-details-panel{min-height:100%}.bees-flex-widget-body>.bees-details-panel>.bees-box{min-height:100%;border:0;border-radius:0}.bees-convo-panel{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-sidebar-fill);height:600px;overflow:hidden}.bees-convo-history{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:16px;align-items:stretch;scroll-behavior:smooth}.bees-convo-composer{padding:12px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}.bees-convo-msg{padding:10px 14px;border-radius:12px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);max-width:100%;width:100%;box-sizing:border-box}.bees-convo-msg.agent{align-self:stretch}.bees-convo-msg.system{align-self:stretch;text-align:left;font-size:12px;color:var(--dsw-alias-label-secondary);background:transparent;border:none}.bees-details-panel{display:flex;flex-direction:column;gap:12px}
  .bees-flex-widget-body>.bees-agent-form{border:0;border-radius:0}
  .bees-mark,.bees-btn.primary{background:var(--bees-accent);color:var(--bees-accent-contrast);border-color:var(--bees-accent)}.bees-brand-settings-button.active{color:var(--dsw-alias-label-primary);background:var(--bees-accent-soft)}.bees-segmented .active{border-color:var(--bees-accent);background:var(--bees-accent-soft)}
  .bees-settings-layout{display:grid;grid-template-columns:190px minmax(0,1fr);gap:20px;align-items:start}.bees-settings-menu{display:grid;gap:4px;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-sidebar-fill);box-shadow:0 1px 3px #0001}.bees-settings-menu-label{padding:8px 9px 3px;color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}.bees-settings-menu button{width:100%;border:0;border-radius:8px;padding:8px 9px;color:inherit;background:transparent;text-align:left;font:inherit;cursor:pointer}.bees-settings-menu button:hover{background:var(--dsw-alias-interactive-bg-hover)}.bees-settings-menu button.active{background:var(--bees-accent-soft);font-weight:750}.bees-settings-content{min-width:0}.bees-org-branding{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:12px}.bees-org-branding label{display:grid;gap:5px}.bees-org-branding-preview{display:grid;place-items:center;width:42px;height:42px;border-radius:11px;color:#fff;font-size:18px;font-weight:800;box-shadow:inset 0 0 0 1px #fff3}.bees-color-input{width:52px;height:32px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);cursor:pointer}.bees-theme-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px}.bees-theme-card{display:grid;gap:9px;padding:11px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;color:inherit;background:var(--dsw-alias-bg-base);text-align:left;font:inherit;cursor:pointer}.bees-theme-card:hover,.bees-theme-card.active{border-color:var(--bees-accent)}.bees-theme-card.active{box-shadow:0 0 0 1px var(--bees-accent)}.bees-theme-swatches{display:grid;grid-template-columns:repeat(4,1fr);height:26px;overflow:hidden;border-radius:7px}
  .bees-team-chevron, .bees-nav-chevron { display: flex; align-items: center; justify-content: center; width: 14px; height: 14px; flex: none; color: var(--dsw-alias-label-secondary); font-size: 16px; transform: none !important; }@media(max-width:780px){.bees-app{grid-template-columns:76px 1fr}.bees-brand>span:nth-child(2),.bees-nav-link span:last-child,.bees-nav-child,.bees-nav-dashboards,.bees-org-summary,.bees-team-heading span,.bees-team-name,.bees-team-chevron{display:none}.bees-brand{justify-content:center;padding-inline:8px}.bees-brand-settings{margin-left:0}.bees-scope-switcher{margin-inline:8px}.bees-org-tiles{display:grid;justify-items:center}.bees-team-heading{justify-content:center;padding:0}.bees-team-row{justify-content:center}.bees-team-toggle{justify-content:center;padding-inline:2px}.bees-team-settings{opacity:1;margin:0}.bees-nav-link{justify-content:center}.bees-settings-layout{grid-template-columns:1fr}.bees-theme-grid{grid-template-columns:1fr}.bees-content{padding:12px}.bees-dashboard-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.bees-hero{padding:20px}.bees-hero form,.bees-system-default form{grid-template-columns:1fr}.bees-cockpit-detail,.bees-inbox{grid-template-columns:1fr}}
/* Keep native scrolling and a stable width; reveal only the active scroller. */
* { scrollbar-width: thin; scrollbar-color: transparent transparent; }
*[data-bees-scrolling] { scrollbar-color: var(--dsw-alias-label-secondary, #888) transparent; }
*::-webkit-scrollbar { width: 6px; height: 6px; }
*::-webkit-scrollbar-track, *::-webkit-scrollbar-corner { background: transparent; }
*::-webkit-scrollbar-thumb { background: transparent; border-radius: 999px; }
*[data-bees-scrolling]::-webkit-scrollbar-thumb { background: var(--dsw-alias-label-secondary, #888); }

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

/* Kanban Board Top Widget */
.bees-cockpit-board.bees-routing-board { min-height: 0 !important; flex: none; }
.bees-cockpit-board { display: flex !important; flex-direction: row !important; overflow-x: auto !important; overflow-y: hidden !important; gap: 12px !important; align-items: stretch !important; padding: 12px 14px !important; background: transparent !important; height: auto !important; min-height: 100% !important; }
.bees-column { flex: 0 0 300px !important; background: var(--dsw-specific-sidebar-fill) !important; border: 1px solid var(--dsw-alias-border-l1) !important; border-radius: 12px !important; padding: 12px 14px !important; display: flex !important; flex-direction: column !important; min-height: 80px !important; }
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
  gap: 6px !important;
  padding: 0 !important;
}
.bees-cockpit-board .bees-hierarchy-card {
  padding: 8px 10px !important;
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
  margin: 0 0 3px !important;
  line-height: 1.3 !important;
}
.bees-cockpit-board .bees-hierarchy-card .bees-muted {
  font-size: 11px !important;
  color: var(--dsw-alias-label-secondary) !important;
}
.bees-cockpit-board .bees-empty {
  padding: 12px !important;
  border: 1px dashed var(--dsw-alias-border-l1) !important;
  border-radius: 8px !important;
  font-size: 12px !important;
  color: var(--dsw-alias-label-secondary) !important;
  text-align: center !important;
  margin: 0 !important;
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
  align-items: center !important;
  gap: 4px !important;
  padding: 10px 14px 0 !important;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08)) !important;
  background: transparent !important;
  margin: 0 !important;
  overflow-x: auto !important;
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
  bottom: -1px !important;
  left: 0 !important;
  right: 0 !important;
  height: 2px !important;
  background: var(--dsw-alias-state-business-primary, #f2b84b) !important;
  border-radius: 2px 2px 0 0 !important;
}

/* Full-width status and controls below Kanban. */
.bees-action-ribbon {
  display: flex !important;
  flex-direction: row !important;
  align-items: flex-start !important;
  justify-content: space-between !important;
  gap: 12px !important;
  padding: 12px 14px !important;
}
.bees-ribbon-left {
  display: flex !important;
  flex-direction: column !important;
  align-items: flex-start !important;
  gap: 10px !important;
  min-width: 0 !important;
  flex: 1 !important;
  overflow-wrap: anywhere;
}
.bees-action-ribbon .bees-tab-actions{max-width:60%;align-self:flex-start!important}
.bees-control-title{font-size:13px}
.bees-card-badges{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.bees-root-chip{display:inline-flex;align-items:center;padding:4px 8px;border-radius:6px;background:#3b82f622;border:1px solid #3b82f666;color:var(--dsw-alias-label-primary);font-size:10px;font-weight:700}
.bees-card-metadata{display:grid;gap:6px;margin-top:10px;font-size:11px}
.bees-card-metadata>div{display:grid;grid-template-columns:80px minmax(0,1fr);gap:6px;overflow-wrap:anywhere}
.bees-card-metadata>div>span:first-child{color:var(--dsw-alias-label-secondary)}
.bees-card-metadata strong{font-weight:600}
@media(max-width:780px){.bees-action-ribbon{flex-direction:column!important}.bees-action-ribbon .bees-tab-actions{max-width:100%;align-self:stretch!important}}
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
  margin-right: 6px !important;
  font-size: 13px !important;
  opacity: 0.8 !important;
  display: inline-flex !important;
  align-items: center !important;
}
.bees-btn-primary {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 6px 14px !important;
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
  padding: 6px 14px !important;
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
  padding: 6px 14px !important;
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
  justify-content: space-between !important;
  padding: 10px 16px !important;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08)) !important;
  background: rgba(0, 0, 0, 0.12) !important;
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
  padding: 16px !important;
  gap: 14px !important;
  flex: 1 !important;
  overflow-y: auto !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: stretch !important;
}

/* User Messages */
.bees-convo-msg.user {
  align-self: stretch !important;
  flex-shrink: 0 !important;
  width: 100% !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.05)) !important;
  color: var(--dsw-alias-label-primary) !important;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08)) !important;
  border-radius: 12px 12px 0 12px !important;
  padding: 12px 16px !important;
  margin: 0 !important;
  font-size: 13.5px !important;
  line-height: 1.55 !important;
}
.bees-convo-msg.user strong {
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
  width: 100% !important;
  max-width: 100% !important;
  align-self: stretch !important;
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
  font-size: 13.5px !important;
  line-height: 1.55 !important;
}
.bees-convo-msg.agent strong {
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
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.06)) !important;
  background: rgba(0, 0, 0, 0.15) !important;
  border-radius: 8px !important;
  color: var(--dsw-alias-label-secondary) !important;
  padding: 8px 12px !important;
  max-width: 100% !important;
  align-self: stretch !important;
  flex-shrink: 0 !important;
  margin: 0 !important;
  font-size: 12.5px !important;
  line-height: 1.5 !important;
  display: flex !important;
  align-items: flex-start !important;
  gap: 8px !important;
}
.bees-convo-msg-interactive {
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  padding: 0 !important;
}

/* Tool Execution Cards & Logs */
.bees-tool-card {
  width: 100% !important;
  align-self: stretch !important;
  flex-shrink: 0 !important;
  overflow: hidden !important;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08)) !important;
  border-radius: 10px !important;
  background: var(--dsw-alias-bg-base, #1c2028) !important;
  transition: all 0.15s ease !important;
}
.bees-tool-card[open] {
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2) !important;
  border-color: var(--dsw-alias-border-l1) !important;
}
.bees-tool-summary {
  display: grid !important;
  grid-template-columns: auto minmax(0, 1fr) auto !important;
  align-items: center !important;
  gap: 10px !important;
  padding: 8px 12px !important;
  cursor: pointer !important;
  list-style: none !important;
  user-select: none !important;
}
.bees-tool-summary::-webkit-details-marker { display: none !important; }
.bees-tool-status {
  padding: 2px 7px !important;
  border: 1px solid currentColor !important;
  border-radius: 999px !important;
  font-size: 9.5px !important;
  font-weight: 750 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.05em !important;
}
.bees-tool-card.working .bees-tool-status { color: #f2b84b !important; }
.bees-tool-card.completed .bees-tool-status { color: #4ade80 !important; }
.bees-tool-card.failed .bees-tool-status { color: #f87171 !important; }
.bees-tool-title {
  min-width: 0 !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  font-size: 12.5px !important;
  font-weight: 650 !important;
  color: var(--dsw-alias-label-primary) !important;
}
.bees-tool-chevron {
  transform: rotate(-90deg) !important;
  color: var(--dsw-alias-label-secondary) !important;
  font-size: 13px !important;
  transition: transform 0.15s ease !important;
}
.bees-tool-card[open] .bees-tool-chevron {
  transform: rotate(0deg) !important;
}
.bees-tool-detail {
  padding: 10px 14px 14px !important;
  border-top: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.06)) !important;
  background: rgba(0, 0, 0, 0.25) !important;
}
.bees-tool-detail strong {
  display: block !important;
  margin: 8px 0 4px !important;
  color: var(--dsw-alias-label-secondary) !important;
  font-size: 10px !important;
  font-weight: 750 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.06em !important;
}
.bees-tool-detail strong:first-child { margin-top: 0 !important; }
.bees-tool-detail pre {
  margin: 0 !important;
  padding: 8px 10px !important;
  overflow-wrap: anywhere !important;
  white-space: pre-wrap !important;
  color: var(--dsw-alias-label-primary) !important;
  background: var(--dsw-specific-sidebar-fill, #161920) !important;
  border: 1px solid rgba(255, 255, 255, 0.05) !important;
  border-radius: 6px !important;
  font: 11.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace !important;
}

/* Interactive Cards */
.bees-answer-card { background: var(--dsw-alias-button-elevated-fill) !important; border: 1px solid var(--dsw-alias-border-l2) !important; border-radius: 12px !important; box-shadow: 0 4px 12px #00000012 !important; padding: 14px !important; margin: 0 !important; }
.bees-answer-card h2, .bees-answer-card h3 { color: var(--dsw-alias-label-primary) !important; margin: 0 0 8px !important; }
.bees-answer-card .bees-question-detail { color: var(--dsw-alias-label-secondary) !important; font-size: 13px !important; margin-bottom: 12px !important; padding: 0 !important; background: var(--dsw-alias-bg-base) !important; box-shadow: 0 1px 3px rgba(0,0,0,0.2) !important; }
.bees-answer-card .bees-choice { background: var(--dsw-alias-bg-base) !important; border: 1px solid var(--dsw-alias-border-l1) !important; color: var(--dsw-alias-label-primary) !important; }
.bees-answer-card .bees-choice:hover { background: var(--dsw-alias-interactive-bg-hover) !important; }

/* Compact Composer */
.bees-compact-composer {
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08)) !important;
  background: var(--dsw-alias-bg-base, #1c2028) !important;
  padding: 0 !important;
  margin: 12px 0 0 0 !important;
  position: relative !important;
  display: flex !important;
}
.bees-compact-composer textarea {
  flex: 1 !important;
  width: 100% !important;
  min-height: 60px !important;
  max-height: 200px !important;
  padding: 14px 48px 14px 16px !important;
  background: transparent !important;
  border: none !important;
  border-radius: 0 !important;
  color: var(--dsw-alias-label-primary) !important;
  font-size: 13.5px !important;
  line-height: 1.5 !important;
  outline: none !important;
  box-shadow: none !important;
  resize: vertical !important;
}
.bees-compact-composer textarea:focus {
  outline: none !important;
  box-shadow: none !important;
}
.bees-composer-send {
  position: absolute !important;
  right: 14px !important;
  bottom: 14px !important;
  width: 28px !important;
  height: 28px !important;
  border-radius: 6px !important;
  background: var(--dsw-alias-state-business-primary, #3b82f6) !important;
  color: #fff !important;
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

/* Kanban Card Description */
.bees-card-desc {
  display: -webkit-box !important;
  -webkit-line-clamp: 2 !important;
  -webkit-box-orient: vertical !important;
  overflow: hidden !important;
  font-size: 11.5px !important;
  color: var(--dsw-alias-label-secondary) !important;
  margin: 4px 0 8px !important;
  line-height: 1.4 !important;
  white-space: normal !important;
}

.bees-modal-backdrop { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 24px; background: rgba(0,0,0,.55); }
.bees-modal { width: min(620px, 100%); max-height: calc(100vh - 48px); overflow: auto; box-shadow: 0 24px 80px rgba(0,0,0,.35); }
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
.bees-file-location{display:grid;gap:3px;min-width:0;flex:1;overflow-wrap:anywhere}
.bees-file-location .bees-muted{font-size:12px;white-space:normal}
.bees-output-directory{display:grid;gap:20px;min-width:0}
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
.bees-directory-file.active{background:#f2b84b22;box-shadow:inset 2px 0 #f2b84b}
.bees-file-preview{display:flex;flex-direction:column;overflow:hidden}
.bees-file-preview-head{flex-shrink:0;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.bees-file-preview-head>svg{flex-shrink:0;color:var(--dsw-alias-label-secondary)}
.bees-file-preview-head>.bees-editor-action{display:grid;place-items:center;width:30px;height:30px;padding:0;border:0;background:transparent}
.bees-file-preview-head>.bees-btn{flex-shrink:0}
.bees-file-preview-body{min-height:0;min-width:0;flex:1;overflow:auto;overflow-wrap:anywhere;padding:16px}
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
`;

export async function request(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options?.headers ?? {}) }
  });
  const value = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? value.error ?? `Request failed (${response.status})`);
  return value;
}

/** One submit at a time; a second click while the first is in flight creates a duplicate. */
export function useSubmit(handler) {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  return [busy, async (event) => {
    event.preventDefault();
    if (running.current) return;
    running.current = true; setBusy(true);
    try { await handler(event); } finally { running.current = false; setBusy(false); }
  }];
}

export async function openExternal(url) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (invoke) return invoke("open_external_url", { url });
  if (!window.open(url, "_blank", "noopener,noreferrer")) throw new Error("Your browser blocked the website window");
}

export const collaboration = (action, values = {}) => request("/bees-api/collaboration", action ? {
  method: "POST", body: JSON.stringify({ action, ...values })
} : undefined);

function dialogValue(label, initial, confirmOnly = false, inputType = "text", options = null, checkbox = null) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "bees-prompt";
    const form = document.createElement("form");
    form.method = "dialog";
    const title = document.createElement("label");
    title.textContent = label;
    form.append(title);
    const input = confirmOnly ? null : document.createElement(options ? "select" : "input");
    if (input) {
      input.className = "bees-input";
      if (options) for (const option of options) {
        const element = document.createElement("option");
        element.value = option.value;
        element.textContent = option.label;
        input.append(element);
      }
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
      resolve(value === null || !checkboxInput ? value : { value, checked: checkboxInput.checked });
    }, { once: true });
    requestAnimationFrame(() => { dialog.showModal(); input?.focus(); input?.select?.(); });
  });
}

export const ask = (label, initial = "", inputType = "text") => dialogValue(label, initial, false, inputType);
export const askWithCheckbox = (label, checkbox, checked = false, initial = "") =>
  dialogValue(label, initial, false, "text", null, { label: checkbox, checked });
export const choose = (label, options) => dialogValue(label, "", false, "text", options);
export const confirmAction = (label) => dialogValue(label, "", true);
export const Button = ({ children, className = "", ...props }) =>
  h("button", { type: "button", className: `bees-btn ${className}`, ...props }, children);

export function AuditEvent({ event, detail, onOpen, openLabel = "Open related item" }) {
  const title = String(event.type ?? "Audit event").replace(/^domain-/, "").replace(/[-_]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
  return h("details", { className: "bees-audit" },
    h("summary", { className: "bees-row" }, h("span", { className: "bees-row-main" },
      h("span", { className: "bees-row-title" }, title),
      h("span", { className: "bees-muted" }, [detail, new Date(event.createdAt).toLocaleString()].filter(Boolean).join(" · ")))),
    h("div", { className: "bees-audit-detail" },
      event.executionId ? h("div", { className: "bees-muted" }, `Run: ${event.executionId}`) : null,
      h("pre", null, JSON.stringify(event.metadata ?? {}, null, 2)),
      onOpen ? h(Button, { onClick: onOpen }, openLabel) : null));
}

function ThemeIcon({ theme }) {
  const props = {
    viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8,
    strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true"
  };
  if (theme === "light") return h("svg", props,
    h("circle", { cx: 12, cy: 12, r: 3.5 }),
    h("path", { d: "M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" })
  );
  if (theme === "dark") return h("svg", props,
    h("path", { d: "M21 12.8A8.5 8.5 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8Z" })
  );
  return h("svg", props,
    h("rect", { x: 3, y: 4, width: 18, height: 13, rx: 2 }),
    h("path", { d: "M8 21h8M12 17v4" })
  );
}

export function ThemeToggle({ ctx, preferences }) {
  const theme = ctx.get?.("theme") ?? ctx.theme;
  const stored = usePreference(preferences);
  const current = THEME_PRESETS.find(({ id }) => id === stored.themePreset)
    ?? THEME_PRESETS.find(({ id }) => id === "forest");
  const next = nextThemePreset(stored);
  const currentMode = selectedColorMode(stored, current);
  const nextMode = currentMode === "dark" ? "light" : "dark";
  const label = `${current.label} theme; switch to ${next.label}`;
  return h("button", {
    type: "button", className: "bees-theme-toggle", title: label, "aria-label": label,
    onClick: async () => {
      await preferences?.set("themePreset", next.id);
      await preferences?.set("colorMode", nextMode);
      theme.setTheme(nextMode);
    }
  }, h(ThemeIcon, { theme: currentMode }));
}

export function usePreference(scope) {
  const [snapshot, setSnapshot] = useState(() => scope.getSnapshot());
  useEffect(() => {
    const update = () => setSnapshot(scope.getSnapshot());
    const unsubscribe = scope.subscribe(update);
    update();
    return unsubscribe;
  }, [scope]);
  return snapshot.value ?? { lastScope: "" };
}

export function useSnapshot(source, fallback = null) {
  const [observed, setObserved] = useState(() => ({ source, snapshot: source?.getSnapshot() ?? fallback }));
  const snapshot = observed.source === source ? observed.snapshot : source?.getSnapshot() ?? fallback;
  useEffect(() => {
    if (!source) { setObserved({ source, snapshot: fallback }); return undefined; }
    const update = () => setObserved({ source, snapshot: source.getSnapshot() });
    update();
    return source.subscribe(update);
  }, [source]);
  return snapshot;
}

export function useBeesChangeRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision((value) => value + 1);
    window.addEventListener("bees-change", changed);
    return () => window.removeEventListener("bees-change", changed);
  }, []);
  return revision;
}

export function sectionFor(child) {
  // Routes a page owns without listing in the nav tree, so they still light up their section.
  const section = { goals: "work", waiting: "work", completed: "work", pools: "agents", presets: "agents", sources: "knowledge" }[child];
  return NAVIGATION.find((item) => item.id === (section ?? child) || item.defaultChild === child || item.children.some(([id]) => id === child)) ?? NAVIGATION[0];
}

export function scopeParts(data, scope, connectionId = "") {
  const [kind, id] = String(scope).split(":");
  const connection = connectionId
    ? data.connections?.find((row) => row.id === connectionId) ?? null
    : null;
  const selectedWorkspace = kind === "workspace" ? data.workspaces.find((row) => row.id === id) : null;
  const teamId = selectedWorkspace?.teamId ?? (kind === "team" ? id : "");
  const workspace = selectedWorkspace ?? (teamId
    ? data.workspaces.find((row) => row.teamId === teamId)
    : null);
  const connectionTeam = connection && teamId
    ? data.connectionTeams?.find((row) => row.connectionId === connection.id && row.teamId === teamId)
    : null;
  const rawTeam = data.teams.find((row) => row.id === teamId);
  const localTeam = rawTeam && !(data.connections ?? []).some((row) =>
    row.organizationId === rawTeam.organizationId);
  const team = rawTeam && (connection ? connectionTeam : localTeam)
    ? { ...rawTeam, role: connectionTeam?.role ?? rawTeam.role }
    : null;
  const organizationId = team?.organizationId ?? (kind === "organization" ? id : "");
  const rawOrganization = data.organizations.find((row) => row.id === organizationId);
  const localOrganization = rawOrganization && !(data.connections ?? []).some((row) =>
    row.organizationId === rawOrganization.id);
  const organization = rawOrganization && (connection
    ? connection.organizationId === organizationId
    : localOrganization)
    ? { ...rawOrganization, role: connection?.role ?? rawOrganization.role }
    : null;
  return {
    workspaceId: team ? workspace?.id ?? "" : "", teamId: team?.id ?? "",
    organizationId: organization?.id ?? "", workspace: team ? workspace : null,
    team, organization, connection, accountUserId: connection?.accountUserId ?? null
  };
}

export function Empty({ children }) { return h("div", { className: "bees-empty" }, children); }

export const isDone = (item) => item.completed || item.archivedAt || ["completed", "cancelled"].includes(item.runtimePhase);
export const isScheduleDefinition = (item) => !item.parentId && item.kind !== "run" && Boolean(item.recurringWorkId);
export const workItemStatus = (item) => isScheduleDefinition(item)
  ? "scheduled" : isDone(item) ? "completed" : item.runtimePhase || "pending";

export function runTitle(data, run) {
  return data.items.find(({ id }) => id === run.workItemId)?.title ??
    (run.mode === "planning" && run.purpose ? `Plan outcome: ${run.purpose}` : "Agent run");
}

/** Cut on characters, not code units, or a slice can land inside an emoji and render as a box. */
export const clip = (text, limit) => [...String(text ?? "")].slice(0, limit).join("");

export function workItemsFor(data, route, workspaceIds) {
  let rows = data.items.filter((item) => workspaceIds.includes(data.processes.find(({ id }) => id === item.processId)?.workspaceId));
  rows = rows.filter((item) => route === "schedules" ? isScheduleDefinition(item) : !isScheduleDefinition(item));
  if (route === "goals") rows = rows.filter((item) => item.kind === "goal" ||
    (item.kind === "run" && data.processes.find(({ id }) => id === item.processId)?.kind === "goals"));
  if (route === "waiting") rows = rows.filter((item) =>
    !isDone(item) && (["waiting", "failed"].includes(item.runtimePhase) || data.runs.some((run) =>
      run.workItemId === item.id && ["waiting_for_input", "waiting_for_approval"].includes(run.status))));
  if (route === "waiting") return rows;
  return rows.filter((item) => route === "completed" ? isDone(item) : !isDone(item));
}

export const headerEmitter = {
  header: null,
  actions: null,
  listeners: new Set(),
  setHeader(h) { this.header = h; this.listeners.forEach(l => l()); },
  setActions(a) { this.actions = a; this.listeners.forEach(l => l()); }
};

export function PageHead({ setPageHeader, children }) {
  useEffect(() => {
    if (setPageHeader === 'actions') headerEmitter.setActions(h(React.Fragment, null, children));
    else if (setPageHeader === 'header') headerEmitter.setHeader(h(React.Fragment, null, children));
    else if (typeof setPageHeader === 'function') setPageHeader(h(React.Fragment, null, children));

    return () => {
      if (setPageHeader === 'actions') headerEmitter.setActions(null);
      else if (setPageHeader === 'header') headerEmitter.setHeader(null);
      else if (typeof setPageHeader === 'function') setPageHeader(null);
    };
  });
  return null;
}


export function HelpTooltip({ text, examples }) {
  if (!text) return null;
  return h("span", { className: "bees-widget-tooltip-wrapper", "aria-label": "Help" },
    h("span", { style: { display: "inline-flex", width: "14px", height: "14px", borderRadius: "50%", border: "1px solid currentColor", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: "bold", fontStyle: "italic" } }, "i"),
    h("div", { className: "bees-widget-tooltip" },
      h("p", null, text),
      examples && examples.length ? h("div", null, 
        h("strong", { style: { display: "block", marginBottom: "4px" } }, "Examples:"),
        h("ul", null, ...examples.map(ex => h("li", { key: ex }, ex)))
      ) : null
    )
  );
}
