/**
 * Agent Profile Photo Generator
 *
 * Orchestrates the creation of professional headshot images for agents
 * using the MiniMax image generation API. Builds role-appropriate prompts
 * and manages the generation lifecycle.
 *
 * Layer: AI (depends on Core only — sibling to minimax-image.ts)
 */

import { logger, broadcastLog } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import { generateAgentPhoto, isImageGenerationAvailable } from './minimax-image.js';
import type { Result } from '../core/contracts.js';

const log = logger.child({ module: 'ai:profile-generator' });

// ─── Types ───

export interface ProfilePhotoResult {
  base64: string;
  mimeType: 'image/jpeg';
  dataUri: string;
  prompt: string;
}

// ─── Prompt Construction ───

/**
 * Role-to-visual-archetype mapping.
 * Each role maps to a set of visual characteristics that produce
 * a distinctive, professional-looking headshot appropriate for
 * the agent's function within the Overlord system.
 */
const ROLE_ARCHETYPES: Record<string, string> = {
  // Strategy & leadership
  strategist: 'confident executive in a tailored dark suit, calm authoritative expression, subtle smile, standing in a modern glass office',
  'project-manager': 'organized professional in smart business casual, warm approachable expression, holding a tablet, modern workspace background',
  lead: 'senior tech lead in a crisp collared shirt, thoughtful focused expression, standing near a whiteboard with diagrams',
  director: 'seasoned director in elegant business attire, poised confident posture, corner office with city skyline',
  architect: 'systems architect in a clean minimalist outfit, analytical gaze, surrounded by abstract technical diagrams',

  // Engineering
  developer: 'software engineer in a modern henley shirt, focused determined expression, dual monitor setup visible in background',
  engineer: 'engineer in a clean polo shirt, problem-solving expression, technical workspace with organized tools',
  'frontend-developer': 'creative frontend developer in a stylish casual outfit, enthusiastic expression, colorful UI mockups on screen behind',
  'backend-developer': 'backend engineer in a comfortable dark sweater, concentrated expression, server rack lights glowing softly in background',
  'full-stack': 'versatile full-stack developer in layered casual wear, adaptive confident expression, multiple screens showing code and design',
  devops: 'DevOps engineer in a technical vest over a t-shirt, alert monitoring expression, dashboard screens with green indicators',

  // Quality & testing
  tester: 'QA specialist in professional casual attire, meticulous observant expression, test reports and checklists visible',
  'qa-engineer': 'quality assurance engineer in smart casual, detail-oriented expression, systematic testing environment',
  reviewer: 'code reviewer in reading glasses and a button-down shirt, analytical discerning expression, code diff on screen',

  // Design & UX
  designer: 'UX designer in creative contemporary outfit, inspired expression, design tools and color swatches in background',
  'ux-researcher': 'UX researcher in approachable professional attire, empathetic listening expression, research notes and user journey maps',

  // Security & compliance
  security: 'cybersecurity specialist in dark professional attire, vigilant sharp expression, security operations center background',
  'security-analyst': 'security analyst in formal dark clothing, alert perceptive expression, threat monitoring dashboards',
  auditor: 'compliance auditor in formal business suit, thorough methodical expression, organized documentation on desk',

  // Operations & deployment
  'release-manager': 'release manager in polished business casual, organized calm expression, deployment pipeline dashboard',
  'site-reliability': 'SRE in a comfortable technical hoodie, steady reliable expression, uptime monitoring screens',
  operator: 'operations specialist in practical professional attire, steady hands-on expression, control panel environment',

  // Data & analysis
  analyst: 'data analyst in smart glasses and professional attire, curious analytical expression, data visualizations and charts',
  researcher: 'research scientist in a clean lab coat over casual wear, investigative curious expression, research papers and notes',

  // General / fallback
  assistant: 'professional AI assistant persona, clean modern business casual, helpful welcoming expression, minimalist tech office',
  agent: 'autonomous agent persona in sleek modern attire, purposeful determined expression, high-tech minimalist environment',
};

/**
 * Specialization modifiers that add distinctive details to the base prompt.
 * These are appended when the agent has a specific specialization field.
 */
const SPECIALIZATION_MODIFIERS: Record<string, string> = {
  // Languages & frameworks
  python: 'subtle python logo pin on collar',
  javascript: 'warm yellow-toned ambient lighting',
  typescript: 'cool blue-toned ambient lighting',
  rust: 'industrial-chic workspace with copper accents',
  go: 'clean minimalist workspace with teal accents',
  react: 'vibrant modern creative workspace',
  node: 'green-tinted ambient server room glow',

  // Domains
  database: 'structured organized environment with data flow diagrams',
  cloud: 'sky-themed ambient lighting and cloud architecture diagrams',
  mobile: 'sleek devices and mobile interfaces visible',
  ai: 'neural network visualizations in the background',
  'machine-learning': 'mathematical equations and model graphs faintly visible',
  blockchain: 'cryptographic hash visualizations in background',
  networking: 'network topology diagrams and connection maps',

  // Soft skills
  leadership: 'commanding presence with team collaboration visible',
  mentoring: 'warm teaching environment with collaborative setup',
  documentation: 'well-organized reference materials and style guides',
  communication: 'open collaborative meeting space',
};

/**
 * Build a detailed, professional headshot prompt for an agent.
 *
 * The prompt is constructed in layers:
 * 1. Base photography style and quality directives
 * 2. Role-specific archetype (appearance, expression, environment)
 * 3. Specialization modifier (optional visual accent)
 * 4. Technical photography constraints (lighting, composition, format)
 */
export function buildProfilePrompt(
  agentName: string,
  role: string,
  specialization?: string,
): string {
  const parts: string[] = [];

  // 1. Base photography directive
  parts.push(
    'Professional corporate headshot photograph, high-end studio quality',
    'realistic photographic style, NOT illustration or cartoon',
    'single person, head and shoulders portrait, centered composition',
  );

  // 2. Role archetype — normalize role to find best match
  const normalizedRole = role.toLowerCase().replace(/[_\s]+/g, '-');
  const archetype = ROLE_ARCHETYPES[normalizedRole]
    || findClosestArchetype(normalizedRole)
    || ROLE_ARCHETYPES['agent'];

  parts.push(archetype);

  // 3. Specialization modifier (if present and recognized)
  if (specialization) {
    const normalizedSpec = specialization.toLowerCase().replace(/[_\s]+/g, '-');
    const modifier = SPECIALIZATION_MODIFIERS[normalizedSpec]
      || findClosestSpecialization(normalizedSpec);
    if (modifier) {
      parts.push(modifier);
    }
  }

  // 4. Technical photography constraints
  parts.push(
    'soft professional studio lighting, shallow depth of field',
    'neutral to warm color grade, clean background',
    'high resolution, sharp focus on face, professional retouching',
    'suitable for corporate directory or team page',
  );

  return parts.join(', ');
}

/**
 * Try to find the closest matching role archetype by checking if any
 * archetype key is contained within the role string, or vice versa.
 */
function findClosestArchetype(role: string): string | null {
  // First pass: check if role contains an archetype key
  for (const [key, value] of Object.entries(ROLE_ARCHETYPES)) {
    if (role.includes(key) || key.includes(role)) {
      return value;
    }
  }

  // Second pass: check individual words in the role
  const words = role.split('-');
  for (const word of words) {
    if (word.length < 3) continue; // skip short words like "qa", "ai"
    for (const [key, value] of Object.entries(ROLE_ARCHETYPES)) {
      if (key.includes(word)) {
        return value;
      }
    }
  }

  return null;
}

/**
 * Try to find the closest matching specialization modifier.
 */
function findClosestSpecialization(spec: string): string | null {
  for (const [key, value] of Object.entries(SPECIALIZATION_MODIFIERS)) {
    if (spec.includes(key) || key.includes(spec)) {
      return value;
    }
  }
  return null;
}

// ─── Public API ───

/**
 * Generate a professional profile photo for an agent.
 *
 * Constructs a role-appropriate prompt and calls the MiniMax image
 * generation API. Returns the image as base64 data along with a
 * data URI suitable for direct use in <img> tags or database storage.
 *
 * @param agentName - The agent's name (used for logging)
 * @param role - The agent's role (drives visual archetype selection)
 * @param specialization - Optional specialization for visual accents
 * @returns Result containing the generated photo data
 */
export async function generateAgentProfilePhoto(
  agentName: string,
  role: string,
  specialization?: string,
): Promise<Result<ProfilePhotoResult>> {
  // Check availability first
  if (!isImageGenerationAvailable()) {
    log.info(
      { agentName, role },
      'Skipping profile photo generation — MiniMax API key not configured',
    );
    return err(
      'IMAGE_GEN_NOT_AVAILABLE',
      'Image generation is not available. MINIMAX_API_KEY is not configured.',
      { retryable: false },
    );
  }

  log.info({ agentName, role, specialization }, 'Generating agent profile photo');
  broadcastLog('info', `Generating profile photo for agent "${agentName}" (${role})`, 'ai:profile-generator');

  // Build the prompt
  const prompt = buildProfilePrompt(agentName, role, specialization);
  log.debug({ agentName, promptLength: prompt.length }, 'Profile photo prompt constructed');

  // Call the image generation API
  const result = await generateAgentPhoto(prompt);

  if (!result.ok) {
    log.warn(
      { agentName, role, error: result.error },
      'Profile photo generation failed',
    );
    broadcastLog('warn', `Profile photo generation failed for "${agentName}": ${result.error.message}`, 'ai:profile-generator');
    return result as Result<ProfilePhotoResult>;
  }

  // Build the data URI for direct embedding
  const dataUri = `data:${result.data.mimeType};base64,${result.data.base64}`;

  log.info(
    { agentName, role, base64Length: result.data.base64.length },
    'Agent profile photo generated successfully',
  );
  broadcastLog('info', `Profile photo generated for "${agentName}"`, 'ai:profile-generator');

  return ok({
    base64: result.data.base64,
    mimeType: result.data.mimeType,
    dataUri,
    prompt,
  });
}
