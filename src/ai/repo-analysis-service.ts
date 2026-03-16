/**
 * Repo Analysis Service — AI-Powered Integration Strategy
 *
 * Fetches metadata for GitHub repos (README, languages, structure)
 * and asks AI to suggest how each repo should integrate with a project.
 *
 * Layer: AI (imports only from Core)
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result, AIProviderAPI } from '../core/contracts.js';

const execFileAsync = promisify(execFile);

const log = logger.child({ module: 'ai:repo-analysis' });

// ─── Types ───

export interface RepoInput {
  url: string;
  name: string;
}

export interface RepoSuggestion {
  name: string;
  url: string;
  relationship: 'main' | 'dependency' | 'fork' | 'reference' | 'submodule';
  reason: string;
  action: string;
  keyFiles: string[];
  techStack: string[];
}

export interface RepoAnalysisResult {
  suggestions: RepoSuggestion[];
  summary: string;
}

interface RepoMetadata {
  name: string;
  url: string;
  description: string;
  languages: string[];
  readme: string;
  topics: string[];
  defaultBranch: string;
}

// ─── System Prompt ───

const ANALYSIS_SYSTEM_PROMPT = `You are an expert software architect analyzing GitHub repositories for a project orchestration platform called Overlord. A user is creating a new project and has selected multiple GitHub repos as building blocks. Your job is to analyze each repo and suggest how it should be used.

RELATIONSHIP TYPES:
- "dependency" — Import as a package. Use when the repo is a standalone library/framework that provides functionality the project consumes.
- "fork" — Copy and embed into the project. Use when the repo contains code that needs heavy customization.
- "reference" — Read-only context for AI agents. Use when the repo is documentation, examples, or templates to learn from but not directly use.
- "submodule" — Git submodule. Use when the repo should stay as a linked sub-project with its own versioning.
- "main" — The primary project repo. Rarely suggested for component repos.

For each repo, provide:
1. The recommended relationship type
2. A plain-language reason (1-2 sentences, non-technical audience)
3. A concrete action to take (what Overlord should do)
4. Key files of interest (up to 5)
5. Detected tech stack

Also provide a brief summary (2-3 sentences) of how all repos fit together.

RESPOND WITH VALID JSON ONLY. No markdown, no code fences:

{
  "suggestions": [
    {
      "name": "owner/repo",
      "url": "https://github.com/owner/repo",
      "relationship": "dependency",
      "reason": "...",
      "action": "...",
      "keyFiles": ["src/index.ts", "package.json"],
      "techStack": ["TypeScript", "React"]
    }
  ],
  "summary": "..."
}`;

// ─── Metadata Fetching ───

/**
 * Fetch repo metadata using the `gh` CLI (async, non-blocking).
 * Uses execFile to avoid shell injection. Returns best-effort data —
 * if `gh` is not available or the repo is private, returns minimal info.
 */
async function fetchRepoMetadata(repoUrl: string, name: string): Promise<RepoMetadata> {
  const metadata: RepoMetadata = {
    name,
    url: repoUrl,
    description: '',
    languages: [],
    readme: '',
    topics: [],
    defaultBranch: 'main',
  };

  // Extract owner/repo from URL
  const ownerRepo = extractOwnerRepo(repoUrl);
  if (!ownerRepo) return metadata;

  try {
    // Fetch repo info — execFile avoids shell injection entirely
    const { stdout: infoJson } = await execFileAsync(
      'gh', ['repo', 'view', ownerRepo, '--json', 'description,languages,repositoryTopics,defaultBranchRef'],
      { timeout: 10000, encoding: 'utf-8' },
    );
    const info = JSON.parse(infoJson) as Record<string, unknown>;
    metadata.description = (info.description as string) || '';
    metadata.defaultBranch = (info.defaultBranchRef as { name?: string })?.name || 'main';

    // Languages
    if (Array.isArray(info.languages)) {
      metadata.languages = (info.languages as Array<{ node?: { name?: string } }>)
        .map(l => l.node?.name || '')
        .filter(Boolean);
    }

    // Topics
    if (Array.isArray(info.repositoryTopics)) {
      metadata.topics = (info.repositoryTopics as Array<{ name?: string }>)
        .map(t => t.name || '')
        .filter(Boolean);
    }
  } catch {
    log.debug({ ownerRepo }, 'gh repo view failed — using minimal metadata');
  }

  try {
    // Fetch README (truncated to 2000 chars to stay within token budget)
    const { stdout: readme } = await execFileAsync(
      'gh', ['repo', 'view', ownerRepo, '--json', 'readme', '--jq', '.readme'],
      { timeout: 10000, encoding: 'utf-8', maxBuffer: 50_000 },
    );
    metadata.readme = readme.slice(0, 2000);
  } catch {
    // README not available — that's fine
  }

  return metadata;
}

function extractOwnerRepo(url: string): string | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    return null;
  } catch {
    return null;
  }
}

// ─── AI Analysis ───

function buildUserPrompt(
  repos: RepoMetadata[],
  projectName: string,
  projectGoals: string,
): string {
  let prompt = `Analyze these GitHub repositories for a new project.\n\n`;
  prompt += `Project: "${projectName}"\n`;
  if (projectGoals) {
    prompt += `Goals: ${projectGoals}\n`;
  }
  prompt += `\n---\n\n`;

  for (const repo of repos) {
    prompt += `## ${repo.name}\n`;
    prompt += `URL: ${repo.url}\n`;
    if (repo.description) prompt += `Description: ${repo.description}\n`;
    if (repo.languages.length > 0) prompt += `Languages: ${repo.languages.join(', ')}\n`;
    if (repo.topics.length > 0) prompt += `Topics: ${repo.topics.join(', ')}\n`;
    if (repo.readme) {
      prompt += `\nREADME (first 2000 chars):\n${repo.readme}\n`;
    }
    prompt += `\n---\n\n`;
  }

  prompt += 'Respond with ONLY valid JSON, no other text.';
  return prompt;
}

function parseAnalysisResponse(raw: string): RepoAnalysisResult | null {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    if (!Array.isArray(parsed.suggestions)) return null;

    const suggestions: RepoSuggestion[] = (parsed.suggestions as Record<string, unknown>[]).map(s => ({
      name: String(s.name || ''),
      url: String(s.url || ''),
      relationship: validateRelationship(String(s.relationship || 'reference')),
      reason: String(s.reason || ''),
      action: String(s.action || ''),
      keyFiles: Array.isArray(s.keyFiles) ? s.keyFiles.filter((f): f is string => typeof f === 'string').slice(0, 5) : [],
      techStack: Array.isArray(s.techStack) ? s.techStack.filter((t): t is string => typeof t === 'string').slice(0, 10) : [],
    }));

    return {
      suggestions,
      summary: String(parsed.summary || ''),
    };
  } catch {
    return null;
  }
}

function validateRelationship(rel: string): RepoSuggestion['relationship'] {
  const valid = ['main', 'dependency', 'fork', 'reference', 'submodule'] as const;
  return valid.includes(rel as typeof valid[number])
    ? (rel as RepoSuggestion['relationship'])
    : 'reference';
}

// ─── Public API ───

/**
 * Analyze repos and suggest integration strategies using AI.
 *
 * @param ai - The AI provider API
 * @param repos - List of repos to analyze
 * @param projectName - Name of the project being created
 * @param projectGoals - User's stated project goals
 * @param provider - AI provider to use (defaults to 'anthropic')
 */
export async function analyzeRepos(
  ai: AIProviderAPI,
  repos: RepoInput[],
  projectName: string,
  projectGoals: string,
  provider: string = 'anthropic',
): Promise<Result<RepoAnalysisResult>> {
  if (repos.length === 0) {
    return err('NO_REPOS', 'No repos to analyze', { retryable: false });
  }

  // Check provider
  const adapter = ai.getAdapter(provider);
  if (!adapter || !adapter.validateConfig()) {
    // Fall back to minimax
    const fallback = ai.getAdapter('minimax');
    if (fallback?.validateConfig()) {
      provider = 'minimax';
      log.info('Falling back to minimax for repo analysis');
    } else {
      return err('PROVIDER_NOT_CONFIGURED', 'No AI provider configured for repo analysis', {
        retryable: false,
      });
    }
  }

  log.info({ repos: repos.map(r => r.name), projectName, provider }, 'Analyzing repos');

  // Fetch metadata for each repo (async, parallelized)
  const metadataList = await Promise.all(
    repos.map(r => fetchRepoMetadata(r.url, r.name))
  );

  const userPrompt = buildUserPrompt(metadataList, projectName, projectGoals);

  const result = await ai.sendMessage({
    provider,
    messages: [
      { role: 'user', content: userPrompt },
    ],
    tools: [],
    options: {
      system: ANALYSIS_SYSTEM_PROMPT,
      max_tokens: 4096,
      temperature: 0.3,
    },
  });

  if (!result.ok) {
    log.error({ error: result.error }, 'AI repo analysis failed');
    return err('ANALYSIS_FAILED', `AI analysis failed: ${result.error.message}`, {
      retryable: result.error.retryable,
    });
  }

  // Extract text from response
  const response = result.data as {
    content: Array<{ type: string; text?: string }>;
  };
  const textBlock = response.content?.find(b => b.type === 'text');
  const rawText = textBlock?.text || '';

  if (!rawText) {
    return err('EMPTY_RESPONSE', 'AI returned empty response', { retryable: true });
  }

  const analysis = parseAnalysisResponse(rawText);
  if (!analysis) {
    log.warn({ rawText: rawText.slice(0, 500) }, 'Failed to parse AI analysis response');
    return err('PARSE_FAILED', 'Could not parse AI analysis response', { retryable: true });
  }

  log.info({ repoCount: analysis.suggestions.length }, 'Repo analysis complete');
  return ok(analysis);
}
