import type { Plugin } from "vite";

/** Null unless BEES_HARNESS=1; Vite drops a null plugin, so builds carry nothing from here. */
export function harnessPlugin(): Plugin | null;
