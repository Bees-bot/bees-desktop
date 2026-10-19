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
    ?? THEME_PRESETS.find(({ id }) => id === "corporate");
  const currentMode = selectedColorMode(preference, current);
  const fallback = currentMode === "dark" ? "corporate" : "halloween";
  const savedCandidate = currentMode === "dark" ? preference.lightThemePreset : preference.darkThemePreset;
  const savedPreset = THEME_PRESETS.find(({ id }) => id === savedCandidate);
  const validSaved = savedPreset && (currentMode === "dark" ? !savedPreset.dark : savedPreset.dark);
  return (validSaved ? savedPreset : null)
    ?? THEME_PRESETS.find(({ id }) => id === fallback);
}

