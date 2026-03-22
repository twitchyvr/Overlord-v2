/**
 * Database Seed Script — Real Repo Discovery
 *
 * Clears existing buildings and re-discovers git repositories from ~/GitRepos/.
 * Delegates discovery to autoDiscoverRepos() in building-manager.
 *
 * Usage: npx tsx scripts/seed.ts
 */

import { config } from '../src/core/config.js';
import { initStorage, getDb } from '../src/storage/db.js';
import { autoDiscoverRepos } from '../src/rooms/building-manager.js';

async function seed() {
  config.validate();
  await initStorage(config);
  const db = getDb();

  console.log('Seeding database with real repos from ~/GitRepos/...');

  // Clear any existing data so autoDiscoverRepos() sees an empty DB
  const existingCount = (db.prepare('SELECT COUNT(*) as count FROM buildings').get() as { count: number }).count;
  if (existingCount > 0) {
    console.log(`Found ${existingCount} existing building(s) — clearing...`);
    db.exec('DELETE FROM agents');
    db.exec('DELETE FROM rooms');
    db.exec('DELETE FROM floors');
    db.exec('DELETE FROM buildings');
    console.log('Cleared all buildings, floors, rooms, and agents.');
  }

  // Delegate to the shared auto-discovery logic
  const created = autoDiscoverRepos();
  console.log(`\nSeeded ${created} buildings from ~/GitRepos/`);
  console.log('Done.');
}

seed().catch(console.error);
