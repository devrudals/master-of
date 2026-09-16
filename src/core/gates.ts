import { resolve } from "path";
import { normalizeNFC } from "./unicode.ts";
import { isPathSafe } from "./boundary.ts";
import { DEFAULT_SOURCE } from "./types.ts";

/** Gate and source names address files on disk, so they are allowlisted rather than sanitized. */
const PLAIN_NAME = /^[a-z0-9_][a-z0-9_-]*$/;

/** Gate index files live at gates/<source>/<category>.txt: one view per harness,
 * so an agent only ever reads the skills it can actually run. */
export function gateFilePath(gatesDir: string, source: string, category: string): string {
  return resolve(gatesDir, source, `${category}.txt`);
}

/**
 * Resolves a gate index file from untrusted gate/source names.
 * Returns null for anything that is not a plain identifier, so a caller can
 * never be steered outside gatesDir by '../' or an absolute path.
 */
export function resolveGateFile(gatesDir: string, rawGate: string, rawSource: string = DEFAULT_SOURCE): string | null {
  const gate = normalizeNFC(rawGate).trim().toLowerCase();
  const source = normalizeNFC(rawSource).trim().toLowerCase();
  if (!PLAIN_NAME.test(gate) || !PLAIN_NAME.test(source)) return null;

  const gateFile = gateFilePath(gatesDir, source, gate);
  if (!isPathSafe(gateFile, [gatesDir])) return null;

  return gateFile;
}
