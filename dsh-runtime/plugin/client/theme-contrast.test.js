import assert from "node:assert/strict";
import test from "node:test";

import { THEME_PRESETS } from "./shared.js";

const parse = (color) => {
  const [, lightness, chroma, hue] = color.match(/oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)/);
  return [Number(lightness) / 100, Number(chroma), Number(hue) * Math.PI / 180];
};

const rgb = (color) => {
  const [lightness, chroma, hue] = parse(color);
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ].map((channel) => Math.max(0, Math.min(1, channel)));
};

const luminance = ([red, green, blue]) => 0.2126 * red + 0.7152 * green + 0.0722 * blue;
const contrast = (left, right) => {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};
const encode = (channel) => channel <= 0.0031308
  ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
const decode = (channel) => channel <= 0.04045
  ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const muted = (foreground, background) => foreground.map((channel, index) =>
  decode(encode(channel) * 0.88 + encode(background[index]) * 0.12));

test("theme text meets WCAG AA contrast", () => {
  for (const theme of THEME_PRESETS) {
    const foreground = rgb(theme.foreground);
    for (const surface of [theme.surface, theme.surfaceAlt, theme.surfaceRaised]) {
      const background = rgb(surface);
      assert.ok(contrast(foreground, background) >= 4.5, `${theme.id} foreground`);
      assert.ok(contrast(muted(foreground, background), background) >= 4.5, `${theme.id} muted text`);
    }
    assert.ok(contrast(rgb(theme.primaryContent), rgb(theme.colors[0])) >= 4.5,
      `${theme.id} primary button`);
  }
});
