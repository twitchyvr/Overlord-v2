/**
 * Database Migration Runner
 *
 * Runs pending migrations against the database.
 * Migrations are defined in src/storage/db.ts.
 */

import { config } from '../src/core/config.js';
import { initStorage } from '../src/storage/db.js';

async function migrate() {
  config.validate();
  await initStorage(config);
  console.log('Migrations complete.');
}

migrate().catch(console.error);
