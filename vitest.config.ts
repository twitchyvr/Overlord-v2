import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      // Override agent config for tests — use smaller values so tests are fast
      MAX_TOOL_ITERATIONS: '20',
      AI_MAX_RETRIES: '2',
      AI_RETRY_DELAY_MS: '100',
      TOOL_TIMEOUT_MS: '10000',
      SHELL_TIMEOUT_MS: '10000',
      ENABLE_LUA_SCRIPTING: 'false',
      MAX_LOGS_PER_WINDOW: '20',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
