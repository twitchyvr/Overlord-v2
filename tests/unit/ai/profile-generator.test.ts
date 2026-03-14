/**
 * Profile Generator Tests
 *
 * Tests the profile photo prompt builder and subject reference
 * generation for visual consistency.
 *
 * @see Issue #384
 */

import { describe, it, expect } from 'vitest';
import {
  buildProfilePrompt,
  buildSubjectReference,
} from '../../../src/ai/profile-generator.js';

describe('Profile Generator', () => {
  describe('buildProfilePrompt', () => {
    it('builds a prompt with base photography directives', () => {
      const prompt = buildProfilePrompt('Alice', 'developer');

      expect(prompt).toContain('Professional corporate headshot');
      expect(prompt).toContain('realistic photographic');
      expect(prompt).toContain('single person');
    });

    it('includes role-specific archetype for known roles', () => {
      const prompt = buildProfilePrompt('Bob', 'developer');

      expect(prompt).toContain('software engineer');
    });

    it('falls back to agent archetype for unknown roles', () => {
      const prompt = buildProfilePrompt('Eve', 'quantum-physicist');

      // Should get the 'agent' fallback or a partial match
      expect(prompt).toContain('Professional corporate headshot');
    });

    it('includes gender cues for male', () => {
      const prompt = buildProfilePrompt('Charles', 'developer', undefined, 'male');

      expect(prompt).toContain('male professional');
    });

    it('includes gender cues for female', () => {
      const prompt = buildProfilePrompt('Diana', 'designer', undefined, 'female');

      expect(prompt).toContain('female professional');
    });

    it('includes gender cues for non-binary', () => {
      const prompt = buildProfilePrompt('Sam', 'engineer', undefined, 'nonbinary');

      expect(prompt).toContain('androgynous');
    });

    it('includes specialization modifier when recognized', () => {
      const prompt = buildProfilePrompt('Rust Dev', 'developer', 'rust');

      expect(prompt).toContain('copper accents');
    });

    it('includes technical photography constraints', () => {
      const prompt = buildProfilePrompt('Test', 'developer');

      expect(prompt).toContain('soft professional studio lighting');
      expect(prompt).toContain('high resolution');
    });
  });

  describe('buildSubjectReference', () => {
    it('includes agent name and role', () => {
      const ref = buildSubjectReference('Alice', 'developer');

      expect(ref).toContain('agent:Alice');
      expect(ref).toContain('role:developer');
    });

    it('includes gender when provided', () => {
      const ref = buildSubjectReference('Bob', 'engineer', undefined, 'male');

      expect(ref).toContain('gender:male');
    });

    it('includes specialization when provided', () => {
      const ref = buildSubjectReference('Eve', 'developer', 'typescript');

      expect(ref).toContain('spec:typescript');
    });

    it('includes role archetype reference', () => {
      const ref = buildSubjectReference('Charlie', 'developer');

      expect(ref).toContain('archetype:');
      // The developer archetype should contain 'software engineer'
      expect(ref).toContain('software engineer');
    });

    it('omits gender field when not provided', () => {
      const ref = buildSubjectReference('Alice', 'developer');

      expect(ref).not.toContain('gender:');
    });

    it('omits specialization field when not provided', () => {
      const ref = buildSubjectReference('Alice', 'developer');

      expect(ref).not.toContain('spec:');
    });

    it('produces pipe-separated format', () => {
      const ref = buildSubjectReference('Alice', 'developer', 'python', 'female');

      const parts = ref.split('|');
      expect(parts.length).toBeGreaterThanOrEqual(4); // agent, role, gender, spec, archetype
      expect(parts[0]).toBe('agent:Alice');
      expect(parts[1]).toBe('role:developer');
    });

    it('handles unknown roles gracefully (no archetype)', () => {
      const ref = buildSubjectReference('Test', 'xyzzy-unknown');

      expect(ref).toContain('agent:Test');
      expect(ref).toContain('role:xyzzy-unknown');
      // May or may not have archetype depending on partial matching
    });
  });
});
