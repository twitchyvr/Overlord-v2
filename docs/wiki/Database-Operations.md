# Database Operations

## Overview

Overlord v2 uses SQLite with WAL mode for local development. The database is automatically created and initialized when the server starts.

## Scripts

### Migration
```bash
npm run db:migrate
```

Runs the migration script (`scripts/migrate.ts`) which applies schema changes tracked in the `migrations` table.

### Seeding
```bash
npm run db:seed
```

Runs the seed script (`scripts/seed.ts`) which creates:
- 1 default building ("Overlord Project")
- 7 floors (Lobby, Strategy, Collaboration, Execution, Operations, Governance, Integration)
- 6 default agents (Strategist, Architect, Developer, QA Lead, DevOps, PM)

### Reset
To reset the database, delete the file and re-run:
```bash
rm data/overlord.db
npm run db:migrate
npm run db:seed
```

## SQLite Configuration

```typescript
db.pragma('journal_mode = WAL');   // Write-Ahead Logging
db.pragma('foreign_keys = ON');    // Referential integrity
```

### WAL Mode
Write-Ahead Logging allows concurrent reads while writing. This is important for the real-time Socket.IO transport where multiple clients may be reading while an agent is writing.

### Foreign Keys
Foreign key constraints are enforced to maintain data integrity. For example, a room cannot reference a non-existent floor.

## Database Location

Default: `./data/overlord.db`

Configurable via the `DB_PATH` environment variable. The `data/` directory is gitignored.

## Backup

SQLite databases can be backed up by copying the file:
```bash
cp data/overlord.db data/overlord-backup-$(date +%Y%m%d).db
```

For online backups while the server is running, use SQLite's backup API or the `.backup` command.

## Future: PostgreSQL Migration

The schema is designed for portability to PostgreSQL/Supabase:
- TEXT IDs → UUID
- TEXT JSON columns → JSONB
- `datetime('now')` → `NOW()`
- The `initStorage()` function will accept a `dbType` config to select the backend
