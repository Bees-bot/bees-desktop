import { h } from "./runtime.js";

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

export const HomeIcon = () => h(Icon, { d: ["m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"], polyline: "9 22 9 12 15 12 15 22" });
export const WorkIcon = () => h(Icon, { d: "M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16", rect: { width: "20", height: "14", x: "2", y: "7", rx: "2", ry: "2" } });
export const AgentsIcon = () => h(Icon, { d: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"], circle: { cx: "9", cy: "7", r: "4" } });
export const ProcessesIcon = () => h(Icon, { d: ["M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z", "m3.3 7 8.7 5 8.7-5", "M12 22V12"] });
export const FilesIcon = () => h(Icon, { d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" });
export const ActivityIcon = () => h(Icon, { circle: { cx: "12", cy: "12", r: "10" }, polyline: "12 6 12 12 16 14" });
export const KnowledgeIcon = () => h(Icon, { circle: { cx: "11", cy: "11", r: "8" }, d: "m21 21-4.3-4.3" });
export const SettingsIcon = () => h(Icon, { circle: { cx: "12", cy: "12", r: "3" }, d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" });
export const PinIcon = ({ active }) => h("svg", {
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
export const BookIcon = () => h(Icon, { d: ["M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"] });
