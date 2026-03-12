/**
 * Configuration Service
 *
 * Loads .env, validates required fields, provides typed access.
 * Single source of truth for all config — no scattered process.env reads.
 */

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Database
  DB_PATH: z.string().default('./data/overlord.db'),

  // AI Providers
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-20250514'),
  MINIMAX_API_KEY: z.string().optional(),
  MINIMAX_BASE_URL: z.string().default('https://api.minimax.io/anthropic'),
  MINIMAX_GROUP_ID: z.string().optional(),
  MINIMAX_MODEL: z.string().default('MiniMax-M2.5'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('llama3'),

  // Provider assignments per room type
  PROVIDER_DISCOVERY: z.string().default('anthropic'),
  PROVIDER_ARCHITECTURE: z.string().default('anthropic'),
  PROVIDER_CODE_LAB: z.string().default('minimax'),
  PROVIDER_TESTING_LAB: z.string().default('minimax'),
  PROVIDER_REVIEW: z.string().default('anthropic'),
  PROVIDER_DEPLOY: z.string().default('anthropic'),

  // GitHub
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_OWNER: z.string().optional(),
  GITHUB_REPO: z.string().optional(),

  // MCP
  MCP_SERVERS_CONFIG: z.string().default('./mcp-servers.json'),

  // Security
  SESSION_SECRET: z.string().default('dev-secret-change-in-production'),
  CORS_ORIGIN: z.string().default('http://localhost:4000'),

  // AI Request Timeout
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().positive().default(60_000),

  // MCP Settings
  ENABLE_MCP: z.coerce.boolean().default(false),
  MCP_TIMEOUT_MS: z.coerce.number().positive().default(60_000),

  // Features
  ENABLE_PLUGINS: z.coerce.boolean().default(false),
  ENABLE_LUA_SCRIPTING: z.coerce.boolean().default(false),
  PLUGIN_DIR: z.string().default('./plugins'),
});

type ConfigValues = z.infer<typeof ConfigSchema>;
type ConfigKey = keyof ConfigValues;

class Config {
  #values: ConfigValues | null = null;

  constructor() {
    loadDotenv();
  }

  validate(): this {
    const result = ConfigSchema.safeParse(process.env);
    if (!result.success) {
      const errors = result.error.issues.map(
        (i) => `  ${i.path.join('.')}: ${i.message}`,
      );
      throw new Error(`Config validation failed:\n${errors.join('\n')}`);
    }
    this.#values = result.data;
    return this;
  }

  get<K extends ConfigKey>(key: K): ConfigValues[K] {
    if (!this.#values) {
      throw new Error('Config not validated. Call config.validate() first.');
    }
    return this.#values[key];
  }

  getAll(): ConfigValues {
    if (!this.#values) {
      throw new Error('Config not validated. Call config.validate() first.');
    }
    return { ...this.#values };
  }
}

export const config = new Config();
export type { Config, ConfigValues, ConfigKey };
