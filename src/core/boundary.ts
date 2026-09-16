import { resolve, normalize, dirname, sep } from "path";
import { realpathSync, existsSync } from "fs";

export class SecurityBoundaryViolation extends Error {
  constructor(message: string, public readonly targetPath: string, public readonly boundaryRoot: string) {
    super(`[SecurityBoundaryViolation] ${message}: target '${targetPath}' is outside boundary '${boundaryRoot}'`);
    this.name = "SecurityBoundaryViolation";
  }
}

/**
 * Separator-aware containment. A bare startsWith would accept '/srv/data-evil'
 * as living inside '/srv/data'.
 */
function contains(root: string, target: string): boolean {
  if (target === root) return true;
  const prefix = root.endsWith(sep) ? root : root + sep;
  return target.startsWith(prefix);
}

/** Deepest ancestor of p that exists on disk, or null if none does. */
function nearestExisting(p: string): string | null {
  let current = p;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

/**
 * Checks whether targetPath is inside or equal to boundaryRoot.
 * Resolves symlinks using realpath, including for paths that do not exist yet —
 * those are judged by their nearest existing ancestor, so a symlinked parent
 * cannot place a future file outside the boundary.
 */
export function assertWithinSandbox(targetPath: string, boundaryRoot: string): string {
  const normBoundary = normalize(resolve(boundaryRoot));
  const normTarget = normalize(resolve(targetPath));

  if (!contains(normBoundary, normTarget)) {
    throw new SecurityBoundaryViolation("Lexical path escapes sandbox", normTarget, normBoundary);
  }

  if (!existsSync(normBoundary)) return normTarget;
  const realBoundary = realpathSync(normBoundary);

  if (existsSync(normTarget)) {
    const realTarget = realpathSync(normTarget);
    if (!contains(realBoundary, realTarget)) {
      throw new SecurityBoundaryViolation("Symlink traversal escapes sandbox", realTarget, realBoundary);
    }
    return realTarget;
  }

  const anchor = nearestExisting(normTarget);
  if (anchor) {
    const realAnchor = realpathSync(anchor);
    if (!contains(realBoundary, realAnchor)) {
      throw new SecurityBoundaryViolation("Symlinked parent escapes sandbox", realAnchor, realBoundary);
    }
  }

  return normTarget;
}

export function isPathSafe(targetPath: string, allowedRoots: string[]): boolean {
  try {
    const normTarget = normalize(resolve(targetPath));
    return allowedRoots.some((root) => contains(normalize(resolve(root)), normTarget));
  } catch {
    return false;
  }
}
