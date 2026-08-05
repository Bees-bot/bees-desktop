import { sqlite } from "@flue/runtime/node";
import { resolve } from "node:path";
import { stateDir } from "./state.ts";

// Outside the bundled project so mutable runtime data never becomes a build input.
export default sqlite(resolve(stateDir(), "flue.db"));
