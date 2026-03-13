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

  // Provider assignments per room type (default: minimax for all rooms)
  PROVIDER_DISCOVERY: z.string().default('minimax'),
  PROVIDER_ARCHITECTURE: z.string().default('minimax'),
  PROVIDER_CODE_LAB: z.string().default('minimax'),
  PROVIDER_TESTING_LAB: z.string().default('minimax'),
  PROVIDER_REVIEW: z.string().default('minimax'),
  PROVIDER_DEPLOY: z.string().default('minimax'),

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

  // Agent Conversation Loop
  MAX_TOOL_ITERATIONS: z.coerce.number().int().positive().default(200),
  TOOL_TIMEOUT_MS: z.coerce.number().positive().default(120_000),
  AI_MAX_RETRIES: z.coerce.number().int().nonnegative().default(5),
  AI_RETRY_DELAY_MS: z.coerce.number().positive().default(1_000),

  // Shell Tool — 300s default supports native builds (Xcode, cargo, etc.)
  SHELL_TIMEOUT_MS: z.coerce.number().positive().default(300_000),
  SHELL_MAX_OUTPUT: z.coerce.number().positive().default(1_000_000),

  // Web Tool
  WEB_MAX_RESULTS: z.coerce.number().int().positive().default(50),
  WEB_MAX_LENGTH: z.coerce.number().positive().default(500_000),
  WEB_MAX_RESPONSE_BODY: z.coerce.number().positive().default(5_242_880),

  // Plugin Sandboxes
  PLUGIN_TIMEOUT_MS: z.coerce.number().positive().default(30_000),
  PLUGIN_MAX_TIMEOUT_MS: z.coerce.number().positive().default(60_000),
  LUA_TIMEOUT_MS: z.coerce.number().positive().default(30_000),

  // Escalation
  ESCALATION_INTERVAL_MS: z.coerce.number().positive().default(5 * 60 * 1000),
  ESCALATION_THRESHOLD_MS: z.coerce.number().positive().default(30 * 60 * 1000),

  // Context Management
  CONTEXT_PRESERVE_RECENT: z.coerce.number().int().positive().default(10),

  // Log Broadcasting
  LOG_WINDOW_MS: z.coerce.number().positive().default(1_000),
  MAX_LOGS_PER_WINDOW: z.coerce.number().int().positive().default(50),
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
      // Auto-validate on first access — all fields have defaults so this is safe
      this.validate();
    }
    return this.#values![key];
  }

  getAll(): ConfigValues {
    if (!this.#values) {
      this.validate();
    }
    return { ...this.#values! };
  }
}

export const config = new Config();
export type { Config, ConfigValues, ConfigKey };
