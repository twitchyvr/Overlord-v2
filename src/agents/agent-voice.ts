/**
 * Agent Voice System
 *
 * Each agent gets a unique synthesized voice that matches their persona.
 * Uses MiniMax MCP multimodal server for TTS when available.
 *
 * Voice assignment is deterministic — the same agent always gets the same
 * voice based on their name + role hash. This ensures consistency across
 * sessions without storing voice IDs.
 *
 * When TTS is unavailable, the system degrades gracefully — text is shown
 * without audio. No errors, no broken UI.
 */

import { logger } from '../core/logger.js';
import type { Bus } from '../core/bus.js';

const log = logger.child({ module: 'agent-voice' });

// ─── Voice Profiles ───

export interface VoiceProfile {
  voiceId: string;
  name: string;
  gender: 'male' | 'female' | 'neutral';
  tone: string;
  speed: number;  // 0.5 - 2.0
}

/**
 * Built-in voice profiles. Agents are assigned a voice deterministically
 * based on a hash of their name + role.
 */
const VOICE_PROFILES: VoiceProfile[] = [
  { voiceId: 'vocal-1', name: 'Professional', gender: 'male', tone: 'confident', speed: 1.0 },
  { voiceId: 'vocal-2', name: 'Friendly', gender: 'female', tone: 'warm', speed: 1.0 },
  { voiceId: 'vocal-3', name: 'Analytical', gender: 'neutral', tone: 'measured', speed: 0.9 },
  { voiceId: 'vocal-4', name: 'Energetic', gender: 'male', tone: 'enthusiastic', speed: 1.1 },
  { voiceId: 'vocal-5', name: 'Calm', gender: 'female', tone: 'soothing', speed: 0.9 },
  { voiceId: 'vocal-6', name: 'Authoritative', gender: 'male', tone: 'commanding', speed: 0.95 },
  { voiceId: 'vocal-7', name: 'Creative', gender: 'female', tone: 'expressive', speed: 1.05 },
  { voiceId: 'vocal-8', name: 'Technical', gender: 'neutral', tone: 'precise', speed: 1.0 },
];

// ─── Voice Assignment ───

const agentVoices = new Map<string, VoiceProfile>();

/**
 * Simple hash for deterministic voice assignment.
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Custom voice configuration stored in agent config JSON.
 */
export interface CustomVoiceConfig {
  voiceId: string;
  type: 'cloned' | 'designed' | 'system';
  tone?: string;
  speed?: number;
  assignedAt?: string;
}

/**
 * Get (or assign) a voice profile for an agent.
 *
 * If the agent has a custom voice configured (cloned or designed),
 * that takes priority. Otherwise, falls back to deterministic
 * assignment based on name + role hash.
 *
 * @param agentId - Agent identifier
 * @param name - Agent name
 * @param role - Agent role
 * @param config - Optional agent config object (may contain voice settings)
 */
export function getAgentVoice(agentId: string, name: string, role: string, config?: Record<string, unknown>): VoiceProfile {
  // Check for custom voice in agent config
  const voiceConfig = config?.voice as CustomVoiceConfig | undefined;
  if (voiceConfig?.voiceId && voiceConfig.type !== 'system') {
    const customProfile: VoiceProfile = {
      voiceId: voiceConfig.voiceId,
      name: 'Custom',
      gender: 'neutral',
      tone: voiceConfig.tone ?? 'custom',
      speed: voiceConfig.speed ?? 1.0,
    };
    agentVoices.set(agentId, customProfile);
    log.debug({ agentId, name, voiceId: customProfile.voiceId, type: voiceConfig.type }, 'Custom voice assigned to agent');
    return customProfile;
  }

  if (agentVoices.has(agentId)) {
    return agentVoices.get(agentId)!;
  }

  const hash = simpleHash(`${name}:${role}`);
  const index = hash % VOICE_PROFILES.length;
  const profile = VOICE_PROFILES[index];

  agentVoices.set(agentId, profile);
  log.debug({ agentId, name, voiceId: profile.voiceId }, 'Voice assigned to agent');

  return profile;
}

/**
 * Get all available voice profiles.
 */
export function getVoiceProfiles(): VoiceProfile[] {
  return [...VOICE_PROFILES];
}

// ─── TTS Integration ───

let busRef: Bus | null = null;
let ttsAvailable = false;

/**
 * Initialize the voice system. Checks if MiniMax MCP multimodal server
 * is available for TTS.
 */
export function initVoiceSystem(bus: Bus): void {
  busRef = bus;

  // Listen for MCP server status to detect TTS availability
  bus.on('mcp:server:connected', (data: Record<string, unknown>) => {
    if (data.serverName === 'minimax_multimodal') {
      ttsAvailable = true;
      log.info('TTS available via MiniMax MCP multimodal server');
    }
  });

  bus.on('mcp:server:disconnected', (data: Record<string, unknown>) => {
    if (data.serverName === 'minimax_multimodal') {
      ttsAvailable = false;
      log.info('TTS no longer available');
    }
  });

  log.info('Agent voice system initialized');
}

/**
 * Check if TTS is currently available.
 */
export function isTtsAvailable(): boolean {
  return ttsAvailable;
}

/**
 * Request TTS for a message. Emits a bus event that the UI can pick up.
 * If TTS is unavailable, this is a no-op (graceful degradation).
 */
export function speakMessage(agentId: string, text: string, name: string, role: string): void {
  if (!ttsAvailable || !busRef) return;

  const voice = getAgentVoice(agentId, name, role);

  busRef.emit('voice:speak', {
    agentId,
    text,
    voiceId: voice.voiceId,
    speed: voice.speed,
    tone: voice.tone,
  });
}
