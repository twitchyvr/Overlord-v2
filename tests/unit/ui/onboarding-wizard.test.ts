// @vitest-environment jsdom
/**
 * Onboarding Wizard Tests
 *
 * Tests the guided first-run experience for new users.
 * Verifies step navigation, form inputs, project creation,
 * team adjustment logic, and skip functionality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──

let mockDispatch: ReturnType<typeof vi.fn>;
let mockSubscribe: ReturnType<typeof vi.fn>;
const subscribeCbs: Record<string, (...args: unknown[]) => void> = {};

vi.mock('../../../public/ui/engine/engine.js', () => ({
  OverlordUI: {
    dispatch: (...args: unknown[]) => mockDispatch(...args),
    subscribe: (event: string, cb: (...args: unknown[]) => void) => {
      subscribeCbs[event] = cb;
      mockSubscribe(event, cb);
      return () => { delete subscribeCbs[event]; };
    },
    getStore: () => null,
    init: vi.fn()
  }
}));

vi.mock('../../../public/ui/engine/helpers.js', () => ({
  h: (tag: string, attrs: Record<string, unknown> | null, ...children: unknown[]) => {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') el.className = v as string;
        else if (k === 'style' && typeof v === 'object') {
          for (const [sk, sv] of Object.entries(v as Record<string, string>)) {
            (el.style as unknown as Record<string, string>)[sk] = sv;
          }
        } else if (k.startsWith('on')) {
          el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
        } else {
          el.setAttribute(k, String(v));
        }
      }
    }
    for (const child of children) {
      if (child instanceof Node) el.appendChild(child);
      else if (child !== null && child !== undefined) el.appendChild(document.createTextNode(String(child)));
    }
    return el;
  },
  setContent: vi.fn()
}));

vi.mock('../../../public/ui/components/toast.js', () => ({
  Toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn()
  }
}));

// ── Import after mocks ──

import { OnboardingWizard } from '../../../public/ui/views/onboarding-wizard.js';
import { Toast } from '../../../public/ui/components/toast.js';

// ── Helpers ──

function createWizard() {
  const container = document.createElement('div');
  const wizard = new OnboardingWizard(container);
  wizard.mount();
  return { container, wizard };
}

function clickButton(container: HTMLElement, text: string) {
  const buttons = container.querySelectorAll('button');
  for (const btn of buttons) {
    if (btn.textContent?.includes(text)) {
      btn.click();
      return true;
    }
  }
  return false;
}

function clickCard(container: HTMLElement, text: string) {
  const cards = container.querySelectorAll('[class*="card"]');
  for (const card of cards) {
    if (card.textContent?.includes(text)) {
      (card as HTMLElement).click();
      return true;
    }
  }
  return false;
}

// ── Tests ──

describe('OnboardingWizard', () => {
  beforeEach(() => {
    mockDispatch = vi.fn();
    mockSubscribe = vi.fn();
    vi.clearAllMocks();
  });

  describe('Step 1: Welcome', () => {
    it('renders the welcome screen on mount', () => {
      const { container } = createWizard();
      expect(container.textContent).toContain('Welcome to Overlord');
      expect(container.textContent).toContain('Get Started');
    });

    it('shows feature highlights', () => {
      const { container } = createWizard();
      expect(container.textContent).toContain('AI Team Members');
      expect(container.textContent).toContain('Automated Workflow');
      expect(container.textContent).toContain('Full Visibility');
    });

    it('has a skip button that navigates to strategist', () => {
      const { container } = createWizard();
      clickButton(container, 'Skip');
      expect(mockDispatch).toHaveBeenCalledWith('navigate:strategist');
    });

    it('advances to step 2 on Get Started click', () => {
      const { container } = createWizard();
      clickButton(container, 'Get Started');
      expect(container.textContent).toContain('project called');
    });

    it('does not show progress bar on welcome step', () => {
      const { container } = createWizard();
      expect(container.querySelector('.wizard-progress')).toBeNull();
    });
  });

  describe('Step 2: Name', () => {
    function goToStep2() {
      const { container, wizard } = createWizard();
      clickButton(container, 'Get Started');
      return { container, wizard };
    }

    it('shows name input and description textarea', () => {
      const { container } = goToStep2();
      expect(container.querySelector('input[type="text"]')).toBeTruthy();
      expect(container.querySelector('textarea')).toBeTruthy();
    });

    it('shows progress bar starting at step 2', () => {
      const { container } = goToStep2();
      expect(container.querySelector('.wizard-progress')).toBeTruthy();
      const activeStep = container.querySelector('.wizard-progress-step.active');
      expect(activeStep?.textContent).toContain('Name');
    });

    it('shows muted style on Next when name is empty', () => {
      const { container } = goToStep2();
      const buttons = container.querySelectorAll('.wizard-btn-primary');
      for (const btn of buttons) {
        if (btn.textContent?.includes('Next')) {
          expect(btn.classList.contains('wizard-btn-muted')).toBe(true);
        }
      }
    });

    it('navigates back to welcome on Back click', () => {
      const { container } = goToStep2();
      clickButton(container, 'Back');
      expect(container.textContent).toContain('Welcome to Overlord');
    });

    it('advances to step 3 after entering name and clicking Next', () => {
      const { container } = goToStep2();
      const input = container.querySelector('input[type="text"]') as HTMLInputElement;
      input.value = 'Test Project';
      input.dispatchEvent(new Event('input'));

      clickButton(container, 'Next');
      expect(container.textContent).toContain('What kind of project');
    });
  });

  describe('Step 3: Type Selection', () => {
    function goToStep3() {
      const { container, wizard } = createWizard();
      clickButton(container, 'Get Started');
      const input = container.querySelector('input[type="text"]') as HTMLInputElement;
      input.value = 'My App';
      input.dispatchEvent(new Event('input'));
      clickButton(container, 'Next');
      return { container, wizard };
    }

    it('shows project type options', () => {
      const { container } = goToStep3();
      expect(container.textContent).toContain('Website or Web App');
      expect(container.textContent).toContain('Mobile App');
      expect(container.textContent).toContain('Backend or API');
      expect(container.textContent).toContain('Data or Analytics');
      expect(container.textContent).toContain('Something Else');
    });

    it('uses non-technical language', () => {
      const { container } = goToStep3();
      // Should NOT contain technical jargon
      expect(container.textContent).not.toContain('floors');
      expect(container.textContent).not.toContain('blueprint');
      // Should use friendly terms
      expect(container.textContent).toContain('team members');
    });

    it('advances to scale step on card click', () => {
      const { container } = goToStep3();
      clickCard(container, 'Website or Web App');
      expect(container.textContent).toContain('How big is this project');
    });

    it('navigates back to name step on Back click', () => {
      const { container } = goToStep3();
      clickButton(container, 'Back');
      expect(container.textContent).toContain('project called');
    });
  });

  describe('Step 4: Scale Selection', () => {
    function goToStep4() {
      const { container, wizard } = createWizard();
      clickButton(container, 'Get Started');
      const input = container.querySelector('input[type="text"]') as HTMLInputElement;
      input.value = 'My App';
      input.dispatchEvent(new Event('input'));
      clickButton(container, 'Next');
      clickCard(container, 'Website or Web App');
      return { container, wizard };
    }

    it('shows scale options', () => {
      const { container } = goToStep4();
      expect(container.textContent).toContain('Small');
      expect(container.textContent).toContain('Medium');
      expect(container.textContent).toContain('Large');
    });

    it('shows team member counts', () => {
      const { container } = goToStep4();
      expect(container.textContent).toContain('AI team members');
    });

    it('advances to review step on card click', () => {
      const { container } = goToStep4();
      clickCard(container, 'Medium');
      expect(container.textContent).toContain('Ready to launch');
    });
  });

  describe('Step 5: Review', () => {
    function goToStep5(scale = 'Medium') {
      const { container, wizard } = createWizard();
      clickButton(container, 'Get Started');
      const input = container.querySelector('input[type="text"]') as HTMLInputElement;
      input.value = 'Customer Portal';
      input.dispatchEvent(new Event('input'));
      clickButton(container, 'Next');
      clickCard(container, 'Website or Web App');
      clickCard(container, scale);
      return { container, wizard };
    }

    it('shows project summary', () => {
      const { container } = goToStep5();
      expect(container.textContent).toContain('Customer Portal');
      expect(container.textContent).toContain('Website or Web App');
    });

    it('shows team preview with friendly roles', () => {
      const { container } = goToStep5();
      expect(container.textContent).toContain('Your AI Team');
      // Should show friendly role names, not technical ones
      expect(container.textContent).toContain('Planner');
      expect(container.textContent).toContain('Designer');
      expect(container.textContent).toContain('Builder');
    });

    it('shows launch button', () => {
      const { container } = goToStep5();
      const buttons = container.querySelectorAll('button');
      const launchBtn = Array.from(buttons).find(b => b.textContent?.includes('Launch'));
      expect(launchBtn).toBeTruthy();
    });

    it('shows fewer team members for small scale', () => {
      const { container: smallContainer } = goToStep5('Small');
      const { container: mediumContainer } = goToStep5('Medium');
      const smallMembers = smallContainer.querySelectorAll('.wizard-team-member');
      const mediumMembers = mediumContainer.querySelectorAll('.wizard-team-member');
      expect(smallMembers.length).toBeLessThan(mediumMembers.length);
    });

    it('shows more team members for large scale', () => {
      const { container: largeContainer } = goToStep5('Large');
      const { container: mediumContainer } = goToStep5('Medium');
      const largeMembers = largeContainer.querySelectorAll('.wizard-team-member');
      const mediumMembers = mediumContainer.querySelectorAll('.wizard-team-member');
      expect(largeMembers.length).toBeGreaterThan(mediumMembers.length);
    });
  });

  describe('Project Creation', () => {
    function goToReview() {
      const { container, wizard } = createWizard();
      clickButton(container, 'Get Started');
      const input = container.querySelector('input[type="text"]') as HTMLInputElement;
      input.value = 'My Project';
      input.dispatchEvent(new Event('input'));
      clickButton(container, 'Next');
      clickCard(container, 'Website or Web App');
      clickCard(container, 'Medium');
      return { container, wizard };
    }

    it('shows creating state when launch is clicked', async () => {
      const mockSocket = {
        createBuilding: vi.fn().mockResolvedValue({ ok: true, data: { id: 'b1' } }),
        applyBlueprint: vi.fn().mockResolvedValue({ ok: true }),
        selectBuilding: vi.fn().mockResolvedValue(undefined)
      };
      Object.defineProperty(window, 'overlordSocket', { value: mockSocket, writable: true, configurable: true });

      const { container } = goToReview();
      clickButton(container, 'Launch');

      // Should show creating state
      expect(container.textContent).toContain('Setting up your project');
    });

    it('calls createBuilding and applyBlueprint on launch', async () => {
      const mockSocket = {
        createBuilding: vi.fn().mockResolvedValue({ ok: true, data: { id: 'b123' } }),
        applyBlueprint: vi.fn().mockResolvedValue({ ok: true }),
        selectBuilding: vi.fn().mockResolvedValue(undefined)
      };
      Object.defineProperty(window, 'overlordSocket', { value: mockSocket, writable: true, configurable: true });

      const { container } = goToReview();
      clickButton(container, 'Launch');

      await vi.waitFor(() => {
        expect(mockSocket.createBuilding).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'My Project' })
        );
      });

      expect(mockSocket.applyBlueprint).toHaveBeenCalledWith(
        expect.objectContaining({
          buildingId: 'b123',
          blueprint: expect.objectContaining({
            mode: 'quickStart',
            agentRoster: expect.any(Array)
          })
        })
      );
    });

    it('shows toast and navigates on success', async () => {
      const mockSocket = {
        createBuilding: vi.fn().mockResolvedValue({ ok: true, data: { id: 'b1' } }),
        applyBlueprint: vi.fn().mockResolvedValue({ ok: true }),
        selectBuilding: vi.fn().mockResolvedValue(undefined)
      };
      Object.defineProperty(window, 'overlordSocket', { value: mockSocket, writable: true, configurable: true });

      const { container } = goToReview();
      clickButton(container, 'Launch');

      await vi.waitFor(() => {
        expect(Toast.success).toHaveBeenCalledWith(expect.stringContaining('My Project'));
      });

      expect(mockDispatch).toHaveBeenCalledWith('navigate:dashboard');
      expect(mockDispatch).toHaveBeenCalledWith('building:selected', expect.objectContaining({ buildingId: 'b1' }));
    });

    it('shows error toast on failure and returns to review', async () => {
      const mockSocket = {
        createBuilding: vi.fn().mockResolvedValue({ ok: false, error: { message: 'Server error' } }),
        applyBlueprint: vi.fn(),
        selectBuilding: vi.fn()
      };
      Object.defineProperty(window, 'overlordSocket', { value: mockSocket, writable: true, configurable: true });

      const { container } = goToReview();
      clickButton(container, 'Launch');

      await vi.waitFor(() => {
        expect(Toast.error).toHaveBeenCalledWith(expect.stringContaining('Server error'));
      });

      // Should return to review step
      expect(container.textContent).toContain('Ready to launch');
    });

    it('handles missing socket gracefully', async () => {
      Object.defineProperty(window, 'overlordSocket', { value: null, writable: true, configurable: true });

      const { container } = goToReview();
      clickButton(container, 'Launch');

      await vi.waitFor(() => {
        expect(Toast.error).toHaveBeenCalledWith(expect.stringContaining('Not connected'));
      });
    });
  });

  describe('Team Adjustment', () => {
    it('small scale removes duplicate roles', () => {
      const { wizard } = createWizard();

      // Set up type and scale
      (wizard as unknown as Record<string, unknown>)._selectedType = {
        id: 'web-app',
        agentRoster: [
          { name: 'Strategist', role: 'strategist', rooms: ['strategist'] },
          { name: 'Architect', role: 'architect', rooms: ['architecture'] },
          { name: 'Frontend Dev', role: 'developer', rooms: ['code-lab'] },
          { name: 'Backend Dev', role: 'developer', rooms: ['code-lab'] },
          { name: 'Reviewer', role: 'reviewer', rooms: ['review'] },
          { name: 'DevOps', role: 'devops', rooms: ['deploy'] }
        ]
      };
      (wizard as unknown as Record<string, unknown>)._selectedScale = { id: 'small', agentMultiplier: 0.7 };

      const roster = (wizard as unknown as Record<string, (...args: unknown[]) => unknown[]>)._getAdjustedRoster();
      // Should have one of each role (no duplicate developers)
      const roles = roster.map((a: Record<string, unknown>) => a.role);
      const uniqueRoles = new Set(roles);
      expect(roles.length).toBe(uniqueRoles.size);
    });

    it('medium scale returns base roster unchanged', () => {
      const { wizard } = createWizard();
      const roster = [
        { name: 'A', role: 'strategist', rooms: [] },
        { name: 'B', role: 'developer', rooms: [] },
        { name: 'C', role: 'developer', rooms: [] }
      ];
      (wizard as unknown as Record<string, unknown>)._selectedType = { id: 'test', agentRoster: roster };
      (wizard as unknown as Record<string, unknown>)._selectedScale = { id: 'medium', agentMultiplier: 1.0 };

      const result = (wizard as unknown as Record<string, (...args: unknown[]) => unknown[]>)._getAdjustedRoster();
      expect(result.length).toBe(3);
    });

    it('large scale adds extra team members', () => {
      const { wizard } = createWizard();
      const roster = [
        { name: 'A', role: 'strategist', rooms: [] },
        { name: 'B', role: 'developer', rooms: [] }
      ];
      (wizard as unknown as Record<string, unknown>)._selectedType = { id: 'test', agentRoster: roster };
      (wizard as unknown as Record<string, unknown>)._selectedScale = { id: 'large', agentMultiplier: 1.3 };

      const result = (wizard as unknown as Record<string, (...args: unknown[]) => unknown[]>)._getAdjustedRoster();
      expect(result.length).toBe(4); // 2 base + Senior Dev + Tester
    });
  });

  describe('Navigation events', () => {
    it('resets to step 1 on navigate:onboarding event', () => {
      const { container } = createWizard();
      // Advance to step 2
      clickButton(container, 'Get Started');
      expect(container.textContent).toContain('project called');

      // Simulate navigate event
      if (subscribeCbs['navigate:onboarding']) {
        subscribeCbs['navigate:onboarding']();
      }
      expect(container.textContent).toContain('Welcome to Overlord');
    });
  });
});
