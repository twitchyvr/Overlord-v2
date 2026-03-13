/**
 * Agent Profile Service — Full Profile Orchestrator
 *
 * Combines identity generation (name + bio) with photo generation to produce
 * a complete AgentProfileFields object. Handles partial failures gracefully:
 * if photo generation fails but name/bio succeed, returns what worked.
 *
 * Layer: AI (imports only from Core + sibling AI modules)
 */

import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result, AIProviderAPI, AgentProfileFields } from '../core/contracts.js';
import { generateAgentIdentity } from './profile-name-generator.js';
import type { GeneratedIdentity } from './profile-name-generator.js';
import { generateAgentProfilePhoto } from './profile-generator.js';
import { isImageGenerationAvailable } from './minimax-image.js';

const log = logger.child({ module: 'ai:profile-service' });

// ─── Types ───

export interface GenerateFullProfileOpts {
  /** Skip bio/name generation (use existing or manual values) */
  skipBio?: boolean;
  /** Skip photo generation */
  skipPhoto?: boolean;
  /** Gender preference for name generation */
  gender?: string;
  /** AI provider to use (defaults to 'minimax') */
  provider?: string;
  /** Existing profile fields to preserve (won't be overwritten) */
  existing?: Partial<AgentProfileFields>;
}

export interface FullProfileResult {
  profile: AgentProfileFields;
  /** Which parts were generated vs skipped vs failed */
  generation: {
    identity: 'generated' | 'skipped' | 'failed';
    photo: 'generated' | 'skipped' | 'failed' | 'not-configured';
  };
  /** Any non-fatal warnings during generation */
  warnings: string[];
}

/**
 * Generate a complete agent profile by orchestrating identity (name + bio)
 * and photo generation. Handles partial failures gracefully.
 *
 * @param ai - The AI provider API
 * @param role - The agent's role
 * @param capabilities - Optional list of agent capabilities (used for richer bio)
 * @param opts - Generation options
 * @returns Result containing FullProfileResult
 */
export async function generateFullProfile(
  ai: AIProviderAPI,
  role: string,
  capabilities?: string[],
  opts?: GenerateFullProfileOpts,
): Promise<Result<FullProfileResult>> {
  const options = opts || {};
  const warnings: string[] = [];
  const profile: AgentProfileFields = {};

  const generation: FullProfileResult['generation'] = {
    identity: 'skipped',
    photo: 'skipped',
  };

  log.info(
    { role, capabilities, skipBio: options.skipBio, skipPhoto: options.skipPhoto },
    'Generating full agent profile',
  );

  // ─── Step 1: Generate Identity (name + bio) ───

  if (!options.skipBio) {
    // Build a richer specialization hint from capabilities if provided
    const specializationHint = capabilities && capabilities.length > 0
      ? `Specializes in: ${capabilities.join(', ')}`
      : undefined;

    const identityResult = await generateAgentIdentity(
      ai,
      role,
      specializationHint,
      {
        gender: options.gender,
        provider: options.provider,
        firstName: options.existing?.firstName ?? undefined,
      },
    );

    if (identityResult.ok) {
      const identity: GeneratedIdentity = identityResult.data;
      generation.identity = 'generated';

      // Apply generated values, but don't overwrite existing fields
      profile.firstName = options.existing?.firstName ?? identity.firstName;
      profile.lastName = options.existing?.lastName ?? identity.lastName;
      profile.nickname = options.existing?.nickname ?? identity.nickname;
      profile.bio = options.existing?.bio ?? identity.bio;
      profile.specialization = options.existing?.specialization ?? identity.specialization;

      // Always compute displayName from the final first+last names.
      // This ensures consistency: if firstName was preserved from existing and lastName
      // was AI-generated, displayName reflects both (e.g., "Aria Chen" not just "Aria").
      profile.displayName = `${profile.firstName} ${profile.lastName}`.trim() || identity.displayName;
    } else {
      generation.identity = 'failed';
      const errorMsg = `Identity generation failed: ${identityResult.error.message}`;
      warnings.push(errorMsg);
      log.warn({ error: identityResult.error, role }, errorMsg);

      // Preserve any existing fields even on failure
      if (options.existing) {
        profile.firstName = options.existing.firstName;
        profile.lastName = options.existing.lastName;
        profile.displayName = options.existing.displayName;
        profile.nickname = options.existing.nickname;
        profile.bio = options.existing.bio;
        profile.specialization = options.existing.specialization;
      }
    }
  } else {
    // skipBio: preserve existing fields
    if (options.existing) {
      profile.firstName = options.existing.firstName;
      profile.lastName = options.existing.lastName;
      profile.displayName = options.existing.displayName;
      profile.nickname = options.existing.nickname;
      profile.bio = options.existing.bio;
      profile.specialization = options.existing.specialization;
    }
  }

  // ─── Step 2: Generate Photo (MiniMax image-01) ───

  if (!options.skipPhoto && isImageGenerationAvailable()) {
    const photoName = profile.displayName || role;
    const photoSpecialization = profile.specialization || undefined;

    // Pass existing subject reference for visual consistency (#384)
    const existingSubjectRef = options.existing?.subjectReference ?? undefined;

    log.info({ role, photoName, hasSubjectRef: !!existingSubjectRef }, 'Generating profile photo via MiniMax');

    const photoResult = await generateAgentProfilePhoto(
      photoName, role, photoSpecialization, options.gender, existingSubjectRef ?? undefined,
    );

    if (photoResult.ok) {
      // Write to disk and get serving URL.
      // Use a temporary ID based on the displayName since we don't have the agentId here.
      // The caller (socket handler) will update the agent profile with the real URL.
      // We store the data URI directly so it works even without a disk write.
      profile.photoUrl = photoResult.data.dataUri;
      // Store subject reference for future regeneration consistency (#384)
      profile.subjectReference = photoResult.data.subjectReference;
      generation.photo = 'generated';
      log.info({ role }, 'Profile photo generated successfully');
    } else {
      generation.photo = 'failed';
      const errorMsg = `Photo generation failed: ${photoResult.error.message}`;
      warnings.push(errorMsg);
      log.warn({ error: photoResult.error, role }, errorMsg);
      profile.photoUrl = options.existing?.photoUrl ?? null;
      // Preserve existing subject reference even on photo failure
      profile.subjectReference = options.existing?.subjectReference ?? null;
    }
  } else if (!options.skipPhoto) {
    // MiniMax not configured — preserve existing photo
    generation.photo = 'not-configured';
    profile.photoUrl = options.existing?.photoUrl ?? null;
    profile.subjectReference = options.existing?.subjectReference ?? null;
  } else {
    profile.photoUrl = options.existing?.photoUrl ?? null;
    profile.subjectReference = options.existing?.subjectReference ?? null;
  }

  // ─── Mark as profile-generated if identity succeeded ───

  profile.profileGenerated = generation.identity === 'generated';

  // If everything failed and we have no useful data, return an error
  const hasUsefulData = profile.firstName || profile.lastName || profile.bio;
  if (!hasUsefulData && generation.identity === 'failed') {
    return err('PROFILE_GEN_FAILED', 'All profile generation steps failed', {
      retryable: true,
      context: { role, warnings },
    });
  }

  log.info(
    {
      role,
      identity: generation.identity,
      photo: generation.photo,
      warningCount: warnings.length,
      hasName: !!(profile.firstName && profile.lastName),
      hasBio: !!profile.bio,
    },
    'Full profile generation complete',
  );

  return ok({ profile, generation, warnings });
}
