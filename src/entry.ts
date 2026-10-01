/**
 * Is this module the program node was asked to run?
 *
 * Compares real paths. `import.meta.url` is always the resolved file, while
 * process.argv[1] keeps the path node was given, and that path is usually a
 * symlink: npm installs every `bin` command as a symlink in node_modules/.bin,
 * and the production endpoint runs from a `current` release link. Comparing the
 * two strings as given made every entry point exit silently when launched
 * that way. (Built from fileURLToPath, not by hand, so Windows paths and paths
 * containing spaces or # still compare correctly.)
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isMain(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
