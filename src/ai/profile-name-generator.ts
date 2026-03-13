/**
 * AI-Powered Agent Identity Generator
 *
 * Uses Claude to generate realistic professional identities for agents:
 * first/last name, display name, specialization description, and a
 * multi-paragraph professional bio that reads like a real resume.
 *
 * Layer: AI (imports only from Core)
 */

import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result, AIProviderAPI } from '../core/contracts.js';

const log = logger.child({ module: 'ai:profile-name-gen' });

// ─── Types ───

export interface GeneratedIdentity {
  firstName: string;
  lastName: string;
  displayName: string;
  nickname: string;
  bio: string;
  specialization: string;
}

export interface GenerateIdentityOpts {
  gender?: string;
  provider?: string;
  /** If set, the AI must use this as the first name (generate only lastName, bio, etc.) */
  firstName?: string;
}

// ─── System Prompt ───

const IDENTITY_SYSTEM_PROMPT = `You are a professional identity generator for Overlord, an AI-powered software engineering project orchestration platform. Agents work within a building/floor/room metaphor managing software projects through phases: Strategy, Discovery, Architecture, Execution (Code Lab, Testing Lab), Review, and Deployment.

All roles exist in this SOFTWARE ENGINEERING context. For example, "Operator" means DevOps/infrastructure operator, "Architect" means software architect, "Strategist" means technical project strategist. Never interpret roles as physical/industrial jobs.

CRITICAL RULES:
1. Generate a realistic first name and last name. The name should sound like a real professional working in the SOFTWARE ENGINEERING field.
2. Create a display name in the format "FirstName LastName" (or a professional variant if appropriate).
3. Create a short, memorable nickname (1-2 words) that this professional might be known by among colleagues. Examples: "Dev", "The Architect", "Bug Hunter", "Pixel", "Ace", "Matrix", "Nova", "Zen". The nickname should relate to their role or personality — it should feel natural, like a real team member's handle or callsign.
4. Write a detailed specialization description (1-2 sentences) that captures what this professional excels at within software engineering.
5. Write a high-quality professional bio (3-5 paragraphs) that reads like a genuine professional resume/about page. The bio MUST include:
   - A compelling professional summary opening paragraph
   - Areas of deep expertise and domain knowledge in software engineering
   - Relevant educational background (university, degrees, certifications)
   - Years of experience and notable career milestones
   - Technical proficiencies and methodologies
   - Professional philosophy or approach to work
   - The bio should feel authentic — like reading a real LinkedIn profile or professional website

6. If a gender preference is provided, choose a name that matches. Otherwise, choose freely.
7. Vary ethnicity and cultural background naturally — do not default to any single demographic.

RESPOND WITH VALID JSON ONLY. No markdown, no code fences, no explanation. Just the JSON object:

{
  "firstName": "...",
  "lastName": "...",
  "displayName": "...",
  "nickname": "...",
  "specialization": "...",
  "bio": "..."
}`;

/**
 * Build the user prompt for identity generation.
 */
function buildUserPrompt(role: string, specialization?: string, gender?: string, firstName?: string): string {
  let prompt = `Generate a professional identity for an AI agent working in a software engineering orchestration platform.\n\nRole: "${role}"`;

  if (specialization) {
    prompt += `\n\nCapabilities and specialization: "${specialization}"`;
  }

  if (firstName) {
    prompt += `\n\nIMPORTANT: The first name MUST be "${firstName}". Generate only a matching last name, display name, specialization, and bio. The display name must be "${firstName} <LastName>".`;
  }

  if (gender) {
    prompt += `\n\nPreferred gender for the name: ${gender}`;
  }

  prompt += '\n\nRemember: respond with ONLY a valid JSON object, no other text.';
  return prompt;
}

/**
 * Parse the AI response, extracting JSON from potentially messy output.
 * Handles cases where the model wraps JSON in markdown code fences.
 */
function parseIdentityResponse(raw: string): GeneratedIdentity | null {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const firstName = typeof parsed.firstName === 'string' ? parsed.firstName.trim() : '';
    const lastName = typeof parsed.lastName === 'string' ? parsed.lastName.trim() : '';
    const displayName = typeof parsed.displayName === 'string' ? parsed.displayName.trim() : `${firstName} ${lastName}`;
    const nickname = typeof parsed.nickname === 'string' ? parsed.nickname.trim() : firstName;
    const bio = typeof parsed.bio === 'string' ? parsed.bio.trim() : '';
    const specialization = typeof parsed.specialization === 'string' ? parsed.specialization.trim() : '';

    if (!firstName || !lastName || !bio) {
      return null;
    }

    return { firstName, lastName, displayName, nickname, bio, specialization };
  } catch {
    return null;
  }
}

/**
 * Generate a professional identity for an AI agent using the configured AI provider.
 *
 * @param ai - The AI provider API (from initAI)
 * @param role - The agent's role (e.g., "Backend Engineer", "QA Lead")
 * @param specialization - Optional specialization hint
 * @param opts - Optional generation options (gender preference, provider override)
 * @returns Result containing GeneratedIdentity on success
 */
export async function generateAgentIdentity(
  ai: AIProviderAPI,
  role: string,
  specialization?: string,
  opts?: GenerateIdentityOpts,
): Promise<Result<GeneratedIdentity>> {
  const provider = opts?.provider || 'minimax';

  // Check if the provider adapter exists and is configured
  const adapter = ai.getAdapter(provider);
  if (!adapter) {
    log.warn({ provider }, 'AI provider not available for identity generation');
    return err('PROVIDER_UNAVAILABLE', `AI provider "${provider}" is not registered`, {
      retryable: false,
      context: { provider },
    });
  }

  if (!adapter.validateConfig()) {
    log.warn({ provider }, 'AI provider not configured for identity generation');
    return err('PROVIDER_NOT_CONFIGURED', `AI provider "${provider}" is not configured (missing API key?)`, {
      retryable: false,
      context: { provider },
    });
  }

  const userPrompt = buildUserPrompt(role, specialization, opts?.gender, opts?.firstName);

  log.info({ role, specialization, provider }, 'Generating agent identity via AI');

  const result = await ai.sendMessage({
    provider,
    messages: [
      { role: 'user', content: userPrompt },
    ],
    tools: [],
    options: {
      system: IDENTITY_SYSTEM_PROMPT,
      max_tokens: 2048,
      temperature: 0.9,
    },
  });

  if (!result.ok) {
    log.error({ error: result.error, role }, 'AI identity generation failed');
    return err('IDENTITY_GEN_FAILED', `Failed to generate identity: ${result.error.message}`, {
      retryable: result.error.retryable,
      context: { provider, role },
    });
  }

  // Extract text from the Anthropic-format response
  const response = result.data as {
    content: Array<{ type: string; text?: string }>;
  };

  const textBlock = response.content?.find((block) => block.type === 'text');
  if (!textBlock?.text) {
    log.error({ response: JSON.stringify(response).slice(0, 200) }, 'AI response contained no text block');
    return err('IDENTITY_PARSE_FAILED', 'AI response contained no text content', {
      retryable: true,
      context: { provider, role },
    });
  }

  const identity = parseIdentityResponse(textBlock.text);
  if (!identity) {
    log.error({ raw: textBlock.text.slice(0, 300) }, 'Failed to parse identity JSON from AI response');
    return err('IDENTITY_PARSE_FAILED', 'Could not parse identity JSON from AI response', {
      retryable: true,
      context: { provider, role, rawSnippet: textBlock.text.slice(0, 200) },
    });
  }

  log.info(
    { firstName: identity.firstName, lastName: identity.lastName, role, bioLength: identity.bio.length },
    'Agent identity generated successfully',
  );

  return ok(identity);
}
