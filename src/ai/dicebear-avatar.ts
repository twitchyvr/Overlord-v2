/**
 * DiceBear Avatar Generator (#1012)
 *
 * Generates deterministic SVG avatars from agent names using DiceBear.
 * Free, instant, no API calls, works offline.
 *
 * Attribution: DiceBear by Florian Körner, MIT License
 * https://github.com/dicebear/dicebear
 */

import { createAvatar } from '@dicebear/core';
import { personas } from '@dicebear/collection';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result } from '../core/contracts.js';

const log = logger.child({ module: 'dicebear' });

/**
 * Generate an SVG avatar for an agent.
 * Uses the "personas" style — friendly illustrated characters.
 * @param seed — agent name or ID for deterministic generation
 */
export function generateDiceBearAvatar(seed: string): Result {
  try {
    const avatar = createAvatar(personas, {
      seed,
      size: 128,
    });

    const svg = avatar.toString();
    log.debug({ seed, svgLength: svg.length }, 'DiceBear avatar generated');

    return ok({ svg });
  } catch (error) {
    log.error({ error, seed }, 'Failed to generate DiceBear avatar');
    return err('AVATAR_FAILED', `DiceBear generation failed: ${error}`);
  }
}
