/**
 * Plugin Registry
 *
 * Tracks metadata about installed plugins beyond what's in the manifest:
 * install date, source, user rating, and favorites.
 * Backed by a JSON file in the plugins directory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../core/logger.js';
import { config } from '../core/config.js';

const log = logger.child({ module: 'plugin-registry' });

export interface RegistryEntry {
  pluginId: string;
  installedAt: number;
  source: 'built-in' | 'user' | 'imported';
  rating: number;        // 0-5
  favorite: boolean;
  lastUsed?: number;
}

const registry: Map<string, RegistryEntry> = new Map();
let registryPath = '';

/**
 * Initialize the registry — loads from disk or creates empty.
 */
export function initRegistry(): void {
  const pluginDir = path.resolve(config.get('PLUGIN_DIR'));
  registryPath = path.join(pluginDir, 'registry.json');

  try {
    if (fs.existsSync(registryPath)) {
      const raw = fs.readFileSync(registryPath, 'utf-8');
      const entries = JSON.parse(raw) as RegistryEntry[];
      for (const entry of entries) {
        registry.set(entry.pluginId, entry);
      }
      log.info({ count: registry.size }, 'Plugin registry loaded');
    } else {
      log.info('No registry file found — starting fresh');
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn({ error: msg }, 'Failed to load registry — starting fresh');
  }
}

/**
 * Save the registry to disk.
 */
function saveRegistry(): void {
  try {
    const entries = [...registry.values()];
    fs.writeFileSync(registryPath, JSON.stringify(entries, null, 2), 'utf-8');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn({ error: msg }, 'Failed to save registry');
  }
}

/**
 * Get a registry entry by plugin ID.
 */
export function getRegistryEntry(pluginId: string): RegistryEntry | undefined {
  return registry.get(pluginId);
}

/**
 * List all registry entries.
 */
export function listRegistryEntries(): RegistryEntry[] {
  return [...registry.values()];
}

/**
 * Register or update a plugin in the registry.
 */
export function upsertRegistryEntry(entry: Partial<RegistryEntry> & { pluginId: string }): RegistryEntry {
  const existing = registry.get(entry.pluginId);
  const updated: RegistryEntry = {
    pluginId: entry.pluginId,
    installedAt: existing?.installedAt || Date.now(),
    source: entry.source || existing?.source || 'user',
    rating: entry.rating ?? existing?.rating ?? 0,
    favorite: entry.favorite ?? existing?.favorite ?? false,
    lastUsed: entry.lastUsed ?? existing?.lastUsed,
  };
  registry.set(entry.pluginId, updated);
  saveRegistry();
  return updated;
}

/**
 * Remove a plugin from the registry.
 */
export function removeRegistryEntry(pluginId: string): boolean {
  const removed = registry.delete(pluginId);
  if (removed) saveRegistry();
  return removed;
}

/**
 * Set the rating for a plugin (0-5).
 */
export function setRating(pluginId: string, rating: number): RegistryEntry | undefined {
  const entry = registry.get(pluginId);
  if (!entry) return undefined;
  entry.rating = Math.max(0, Math.min(5, rating));
  saveRegistry();
  return entry;
}

/**
 * Toggle favorite status for a plugin.
 */
export function toggleFavorite(pluginId: string): RegistryEntry | undefined {
  const entry = registry.get(pluginId);
  if (!entry) return undefined;
  entry.favorite = !entry.favorite;
  saveRegistry();
  return entry;
}
