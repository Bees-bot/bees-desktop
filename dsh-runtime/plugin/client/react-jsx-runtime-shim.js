import { h, React } from "./runtime.js";

export function Fragment({ children }) {
  return h(React.Fragment, null, ...[].concat(children ?? []));
}

export function jsx(type, props, key) {
  return h(type, key === undefined ? props : { ...props, key });
}

export const jsxs = jsx;
