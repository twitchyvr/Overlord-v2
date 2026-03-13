/**
 * Path Permissions
 *
 * Multi-folder permission system for filesystem tools.
 * Replaces the single-directory guardPath() with flexible
 * allowed paths, dangerous path warnings, and always-blocked paths.
 */

import { resolve, normalize, dirname, basename } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'tool:path-permissions' });

// ── Always-blocked paths ────────────────────────────────────────────────────
// These paths can NEVER be accessed, regardless of allowedPaths or working directory.

const home = homedir();

/**
 * Resolved paths that are unconditionally blocked from all filesystem operations.
 * Includes sensitive credential stores and key material directories.
 */
export const ALWAYS_BLOCKED_PATHS: string[] = [
  resolve(home, '.ssh'),
  resolve(home, '.gnupg'),
  resolve(home, '.aws'),
  resolve(home, '.config', 'gcloud'),
];

/**
 * Path segments that trigger a block when found as a directory or file name
 * component. Checked via path component splitting, not substring matching.
 */
const BLOCKED_PATH_SEGMENTS = ['.credentials', '.secrets'] as const;

/**
 * File basenames that are always blocked regardless of location.
 */
const BLOCKED_BASENAMES = ['.env', '.env.local', '.env.production', '.env.staging', '.env.development'] as const;

// ── Dangerous path warnings ────────────────────────────────────────────────

interface DangerousPathResult {
  dangerous: boolean;
  reason: string;
}

const DANGEROUS_PATHS: Array<{ path: string; reason: string }> = [
  { path: home, reason: 'This is your home directory. Operating here could affect personal files and dotfiles.' },
  { path: resolve(home, 'Desktop'), reason: 'This is your Desktop folder. Files here are visible on your desktop.' },
  { path: resolve(home, 'Documents'), reason: 'This is your Documents folder. Operating here could affect personal documents.' },
  { path: resolve(home, 'Downloads'), reason: 'This is your Downloads folder. Operating here could affect downloaded files.' },
  { path: '/', reason: 'This is the filesystem root. Operating here could affect critical system files.' },
  { path: '/etc', reason: 'This is a system configuration directory. Modifications could break your system.' },
  { path: '/usr', reason: 'This is a system binaries directory. Modifications could break your system.' },
  { path: '/var', reason: 'This is a system data directory. Modifications could break running services.' },
  // Windows system paths (for cross-platform awareness)
  { path: 'C:\\', reason: 'This is the Windows system drive root. Operating here could affect critical system files.' },
  { path: 'C:\\Windows', reason: 'This is the Windows system directory. Modifications could break your system.' },
  { path: 'C:\\Users', reason: 'This is the Windows users directory. Operating here could affect other user profiles.' },
];

// ── Helper: check if target is within a parent directory ────────────────────

function isWithin(target: string, parent: string): boolean {
  const resolvedTarget = resolve(normalize(target));
  const resolvedParent = resolve(normalize(parent));

  // Exact match or is a subdirectory (parent + separator prefix)
  return resolvedTarget === resolvedParent || resolvedTarget.startsWith(resolvedParent + '/');
}

// ── Helper: check if any path component matches blocked segments ────────────

function hasBlockedSegment(targetPath: string): string | null {
  const normalized = resolve(normalize(targetPath));
  const segments = normalized.split('/');

  for (const segment of segments) {
    for (const blocked of BLOCKED_PATH_SEGMENTS) {
      if (segment === blocked) {
        return blocked;
      }
    }
  }

  return null;
}

// ── Helper: check if the basename is a blocked .env variant ─────────────────

function isBlockedEnvFile(targetPath: string): boolean {
  const name = basename(resolve(normalize(targetPath)));
  return (BLOCKED_BASENAMES as readonly string[]).includes(name);
}

// ── Exported functions ──────────────────────────────────────────────────────

/**
 * Check whether a target path falls within the allowed access boundaries.
 *
 * A path is allowed if:
 * 1. It is within the working directory (existing single-directory behavior)
 * 2. It is within any entry in the allowedPaths array (subfolder inheritance)
 * 3. It is within the system temp directory (os.tmpdir())
 *
 * All comparisons use path.resolve() + path.normalize() -- no raw string matching.
 *
 * @param targetPath   - The absolute or relative path to check
 * @param workingDirectory - The current working directory (project root), or null
 * @param allowedPaths - Additional directories the user has explicitly allowed
 * @returns true if the path is permitted, false otherwise
 */
export function isPathAllowed(
  targetPath: string,
  workingDirectory: string | null,
  allowedPaths: string[],
): boolean {
  const resolved = resolve(normalize(targetPath));

  // 1. Working directory (existing behavior)
  if (workingDirectory && isWithin(resolved, workingDirectory)) {
    return true;
  }

  // 2. Explicitly allowed paths (subfolder inheritance)
  for (const allowed of allowedPaths) {
    if (isWithin(resolved, allowed)) {
      return true;
    }
  }

  // 3. System temp directory is always allowed
  if (isWithin(resolved, tmpdir())) {
    return true;
  }

  return false;
}

/**
 * Check whether a target path points to a sensitive location that warrants a warning.
 *
 * This does NOT block access -- it returns a human-readable warning so the caller
 * can inform the user. Paths like the home directory, Desktop, system roots, etc.
 * are flagged as dangerous.
 *
 * @param targetPath - The absolute or relative path to check
 * @returns An object with `dangerous: true` and a human-readable `reason`, or
 *          `{ dangerous: false, reason: '' }` for safe paths.
 */
export function isDangerousPath(targetPath: string): DangerousPathResult {
  const resolved = resolve(normalize(targetPath));

  for (const entry of DANGEROUS_PATHS) {
    const dangerousResolved = resolve(normalize(entry.path));

    // Exact match: the target IS the dangerous path
    if (resolved === dangerousResolved) {
      return { dangerous: true, reason: entry.reason };
    }
  }

  return { dangerous: false, reason: '' };
}

/**
 * Check whether a path is unconditionally blocked from all filesystem operations.
 *
 * Blocked paths include credential stores (~/.ssh, ~/.gnupg, ~/.aws, ~/.config/gcloud),
 * paths containing `.credentials` or `.secrets` directory components, and `.env` files
 * (checked by basename to avoid false positives on paths like `/projects/dotenv-parser/`).
 *
 * @param targetPath - The absolute or relative path to check
 * @returns true if the path must be blocked, false otherwise
 */
export function isBlockedPath(targetPath: string): boolean {
  const resolved = resolve(normalize(targetPath));

  // Check against always-blocked directory prefixes
  for (const blocked of ALWAYS_BLOCKED_PATHS) {
    if (isWithin(resolved, blocked)) {
      log.warn({ path: resolved, blockedBy: blocked }, 'Access to always-blocked path denied');
      return true;
    }
  }

  // Check for blocked path segments (.credentials, .secrets)
  const blockedSegment = hasBlockedSegment(resolved);
  if (blockedSegment) {
    log.warn({ path: resolved, segment: blockedSegment }, 'Path contains blocked segment');
    return true;
  }

  // Check for .env files by basename (not substring)
  if (isBlockedEnvFile(resolved)) {
    log.warn({ path: resolved, basename: basename(resolved) }, 'Access to .env file denied');
    return true;
  }

  return false;
}

/**
 * Main path guard for filesystem tools. Replaces the old single-directory `guardPath()`.
 *
 * Resolves the user-supplied path against `cwd`, then applies the full permission stack:
 * 1. Blocked paths are rejected unconditionally (credentials, secrets, .env files)
 * 2. Allowed paths are checked (working directory, user-configured allowed paths, temp dir)
 * 3. Everything else is rejected with an actionable error message
 *
 * @param userPath     - The raw path from the tool call (may be relative)
 * @param cwd          - The current working directory to resolve relative paths against
 * @param allowedPaths - Additional directories the user has explicitly allowed
 * @returns The resolved absolute path, if access is permitted
 * @throws Error if the path is blocked or not within any allowed boundary
 */
export function guardPathWithPermissions(
  userPath: string,
  cwd: string,
  allowedPaths: string[],
): string {
  const root = resolve(cwd);
  const full = resolve(root, normalize(userPath));

  // 1. Always-blocked paths take priority
  if (isBlockedPath(full)) {
    throw new Error(
      `Access denied: '${full}' is a protected path that cannot be accessed. ` +
      `Credential stores, secret files, and .env files are always blocked.`,
    );
  }

  // 2. Check the full permission stack
  if (isPathAllowed(full, cwd, allowedPaths)) {
    // Warn if the path is in a dangerous location (but still allowed)
    const danger = isDangerousPath(full);
    if (danger.dangerous) {
      log.warn({ path: full, reason: danger.reason }, 'Accessing dangerous path location');
    }

    return full;
  }

  // 3. Not allowed -- provide an actionable error
  const parentDir = dirname(full);
  throw new Error(
    `Access denied: '${full}' is outside your project folder. ` +
    `Add '${parentDir}' to allowed folders in Settings to grant access.`,
  );
}
