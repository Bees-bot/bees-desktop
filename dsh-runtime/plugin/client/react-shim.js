import { React } from "./runtime.js";

export const useState = (...args) => React.useState(...args);
export const useEffect = (...args) => React.useEffect(...args);
export const useRef = (...args) => React.useRef(...args);
export const useCallback = (...args) => React.useCallback(...args);
export const useMemo = (...args) => React.useMemo(...args);

// Third-party controls must use DSH's renderer-owned React singleton. A bundled second
// React copy would have a different hook dispatcher and fail at runtime.
export default new Proxy({}, {
  get: (_target, property) => React[property]
});
