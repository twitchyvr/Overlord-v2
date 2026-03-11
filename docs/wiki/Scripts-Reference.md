# Scripts Reference

## npm Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload (`tsx watch src/server.ts`) |
| `npm run build` | Compile TypeScript to `dist/` (`tsc`) |
| `npm start` | Run compiled production server (`node dist/server.js`) |
| `npm test` | Run test suite (`vitest run`) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with v8 coverage report |
| `npm run typecheck` | TypeScript type checking (`tsc --noEmit`) |
| `npm run lint` | Run ESLint (`eslint src/ tests/ scripts/`) |
| `npm run validate` | Full validation: typecheck + lint + test |
| `npm run db:migrate` | Run database migrations |
| `npm run db:seed` | Seed development data |
| `npm run check:layers` | Run architecture compliance checker |

## Utility Scripts

### `scripts/check-layers.ts`
Architecture compliance checker. Parses all imports in `src/` and verifies that no lower layer imports from a higher layer. Exits with code 1 if violations are found.

```bash
npm run check:layers
```

This script runs as part of CI to prevent architectural regressions.

### `scripts/migrate.ts`
Database migration runner. Applies schema changes and tracks applied migrations in the `migrations` table.

### `scripts/seed.ts`
Development data seeder. Creates:
- 1 building with 7 floors
- 6 default agents with role-appropriate room access
- Default building phase set to `strategy`

## CI Scripts

The CI workflow (`.github/workflows/ci.yml`) runs:
1. `npm run lint` — ESLint
2. `npm run typecheck` — TypeScript
3. `npm test` — Vitest (on Node 20 and 22)
4. `npm run check:layers` — Architecture compliance

All four must pass for a PR to be merged.
