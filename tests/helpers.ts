import { resolve, join } from "path";

/** Anchored on this file so the suite runs from any checkout location. */
export const PROJECT_ROOT = resolve(import.meta.dir, "..");
export const SANDBOX = join(PROJECT_ROOT, "sandbox");
export const BIN_MO = join(PROJECT_ROOT, "bin", "mo.ts");
