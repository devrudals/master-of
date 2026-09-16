import { writeFileSync, renameSync, mkdirSync, readFileSync, existsSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { normalizeNFC } from "./unicode.ts";

/**
 * Writes data atomically to target path using a temporary file and POSIX rename.
 * Prevents partially written or corrupted files if the process is terminated abruptly.
 */
export function writeAtomicSync(targetPath: string, content: string): void {
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true });

  const tmpPath = join(dir, `.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`);
  try {
    writeFileSync(tmpPath, normalizeNFC(content), "utf8");
    renameSync(tmpPath, targetPath);
  } catch (err) {
    if (existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch {}
    }
    throw err;
  }
}

/** Returns null when the file is missing OR unparseable — callers that must tell
 * those apart check existence themselves before calling. */
export function readJsonOrNull<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, "utf8");
    return JSON.parse(normalizeNFC(content)) as T;
  } catch {
    return null;
  }
}

export function readJsonSafe<T>(filePath: string, fallback: T): T {
  const parsed = readJsonOrNull<T>(filePath);
  return parsed === null ? fallback : parsed;
}
