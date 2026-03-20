/**
 * Overlord v2 — Onboarding Wizard
 *
 * Guided first-run experience for new users. Replaces the technical
 * Strategist view with a friendly, step-by-step setup flow.
 *
 * Steps:
 *   1. Welcome  — greeting + value proposition
 *   2. Name     — project name + short description
 *   3. Type     — what kind of project (plain language)
 *   4. Scale    — how big is this project
 *   5. Review   — summary of what we'll create
 *   6. Creating — spinner while building is provisioned
 *
 * All technical concepts (floors, rooms, blueprints) are hidden.
 * Users see "team members", "workspaces", and "your project".
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h } from '../engine/helpers.js';
import { Toast } from '../components/toast.js';

// ─── Project Type Templates (plain-language wrappers) ───

const PROJECT_TYPES = [
  {
    id: 'web-app',
    label: 'Website or Web App',
    icon: '\u{1F310}',
    tagline: 'A website, dashboard, or online tool',
    examples: 'Marketing site, SaaS platform, admin panel, e-commerce store',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'governance', 'operations', 'integration'],
    roomConfig: [
      { floor: 'strategy', rooms: ['strategist'] },
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab', 'code-lab'] },
      { floor: 'governance', rooms: ['review'] },
      { floor: 'operations', rooms: ['deploy'] },
      { floor: 'integration', rooms: ['monitoring'] }
    ],
    agentRoster: [
      { name: 'Strategist', role: 'strategist', rooms: ['strategist', 'discovery'] },
      { name: 'Architect', role: 'architect', rooms: ['architecture', 'discovery'] },
      { name: 'Frontend Dev', role: 'developer', rooms: ['code-lab'] },
      { name: 'Backend Dev', role: 'developer', rooms: ['code-lab'] },
      { name: 'Reviewer', role: 'reviewer', rooms: ['review'] },
      { name: 'DevOps', role: 'devops', rooms: ['deploy', 'monitoring'] }
    ]
  },
  {
    id: 'mobile-app',
    label: 'Mobile App',
    icon: '\u{1F4F1}',
    tagline: 'An app for phones or tablets',
    examples: 'iOS app, Android app, cross-platform app',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'governance', 'operations'],
    roomConfig: [
      { floor: 'strategy', rooms: ['strategist'] },
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab', 'code-lab'] },
      { floor: 'governance', rooms: ['review'] },
      { floor: 'operations', rooms: ['deploy'] }
    ],
    agentRoster: [
      { name: 'Strategist', role: 'strategist', rooms: ['strategist', 'discovery'] },
      { name: 'App Architect', role: 'architect', rooms: ['architecture', 'discovery'] },
      { name: 'Mobile Dev', role: 'developer', rooms: ['code-lab'] },
      { name: 'API Dev', role: 'developer', rooms: ['code-lab'] },
      { name: 'QA Reviewer', role: 'reviewer', rooms: ['review'] },
      { name: 'Release Manager', role: 'devops', rooms: ['deploy'] }
    ]
  },
  {
    id: 'api-service',
    label: 'Backend or API',
    icon: '\u{1F517}',
    tagline: 'A service that powers other apps',
    examples: 'REST API, GraphQL service, webhook handler, integration layer',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'governance', 'operations', 'integration'],
    roomConfig: [
      { floor: 'strategy', rooms: ['strategist'] },
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab'] },
      { floor: 'governance', rooms: ['review'] },
      { floor: 'operations', rooms: ['deploy'] },
      { floor: 'integration', rooms: ['monitoring'] }
    ],
    agentRoster: [
      { name: 'Strategist', role: 'strategist', rooms: ['strategist', 'discovery'] },
      { name: 'API Architect', role: 'architect', rooms: ['architecture', 'discovery'] },
      { name: 'Backend Dev', role: 'developer', rooms: ['code-lab'] },
      { name: 'API Reviewer', role: 'reviewer', rooms: ['review'] },
      { name: 'DevOps', role: 'devops', rooms: ['deploy', 'monitoring'] }
    ]
  },
  {
    id: 'data-pipeline',
    label: 'Data or Analytics',
    icon: '\u{1F4CA}',
    tagline: 'Data processing, reports, or dashboards',
    examples: 'Data pipeline, analytics dashboard, ML model, reporting tool',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'governance', 'operations'],
    roomConfig: [
      { floor: 'strategy', rooms: ['strategist'] },
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab', 'code-lab'] },
      { floor: 'governance', rooms: ['review'] },
      { floor: 'operations', rooms: ['deploy'] }
    ],
    agentRoster: [
      { name: 'Strategist', role: 'strategist', rooms: ['strategist', 'discovery'] },
      { name: 'Data Architect', role: 'architect', rooms: ['architecture', 'discovery'] },
      { name: 'Data Engineer', role: 'developer', rooms: ['code-lab'] },
      { name: 'ML Engineer', role: 'developer', rooms: ['code-lab'] },
      { name: 'Data Reviewer', role: 'reviewer', rooms: ['review'] },
      { name: 'Infra Engineer', role: 'devops', rooms: ['deploy'] }
    ]
  },
  {
    id: 'desktop-app',
    label: 'Desktop Application',
    icon: '\u{1F5A5}\uFE0F',
    tagline: 'Native desktop app for macOS, Windows, or Linux',
    examples: 'Electron app, native utility, productivity tool, media player',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'governance', 'operations'],
    roomConfig: [
      { floor: 'strategy', rooms: ['strategist'] },
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab', 'code-lab'] },
      { floor: 'governance', rooms: ['review'] },
      { floor: 'operations', rooms: ['deploy'] }
    ],
    agentRoster: [
      { name: 'Strategist', role: 'strategist', rooms: ['strategist', 'discovery'] },
      { name: 'App Architect', role: 'architect', rooms: ['architecture', 'discovery'] },
      { name: 'UI Developer', role: 'developer', rooms: ['code-lab'] },
      { name: 'Systems Developer', role: 'developer', rooms: ['code-lab'] },
      { name: 'QA Reviewer', role: 'reviewer', rooms: ['review'] },
      { name: 'Build Engineer', role: 'devops', rooms: ['deploy'] }
    ]
  },
  {
    id: 'tauri-app',
    label: 'Tauri Desktop App',
    icon: '\u26A1',
    tagline: 'Lightweight native app with Rust backend and web frontend',
    examples: 'Tauri + Svelte, Tauri + React, lightweight desktop tool',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'governance', 'operations'],
    roomConfig: [
      { floor: 'strategy', rooms: ['strategist'] },
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab', 'code-lab'] },
      { floor: 'governance', rooms: ['review'] },
      { floor: 'operations', rooms: ['deploy'] }
    ],
    agentRoster: [
      { name: 'Strategist', role: 'strategist', rooms: ['strategist', 'discovery'] },
      { name: 'App Architect', role: 'architect', rooms: ['architecture', 'discovery'] },
      { name: 'Frontend Dev', role: 'developer', rooms: ['code-lab'] },
      { name: 'Rust Dev', role: 'developer', rooms: ['code-lab'] },
      { name: 'QA Reviewer', role: 'reviewer', rooms: ['review'] },
      { name: 'Build Engineer', role: 'devops', rooms: ['deploy'] }
    ]
  },
  {
    id: 'mobile-app-native',
    label: 'Mobile Application',
    icon: '\u{1F4F1}',
    tagline: 'iOS/Android app using React Native, Flutter, or native frameworks',
    examples: 'React Native app, Flutter app, SwiftUI, Kotlin Multiplatform',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'governance', 'operations'],
    roomConfig: [
      { floor: 'strategy', rooms: ['strategist'] },
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab', 'code-lab'] },
      { floor: 'governance', rooms: ['review'] },
      { floor: 'operations', rooms: ['deploy'] }
    ],
    agentRoster: [
      { name: 'Strategist', role: 'strategist', rooms: ['strategist', 'discovery'] },
      { name: 'Mobile Architect', role: 'architect', rooms: ['architecture', 'discovery'] },
      { name: 'Mobile Dev', role: 'developer', rooms: ['code-lab'] },
      { name: 'UI Dev', role: 'developer', rooms: ['code-lab'] },
      { name: 'QA Reviewer', role: 'reviewer', rooms: ['review'] },
      { name: 'Release Manager', role: 'devops', rooms: ['deploy'] }
    ]
  },
  {
    id: 'macos-widget',
    label: 'macOS Widget',
    icon: '\u{1F5A5}\uFE0F',
    tagline: 'macOS widget or menu bar utility with system integration',
    examples: 'Menu bar app, system monitor widget, notification center widget',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'governance', 'operations'],
    roomConfig: [
      { floor: 'strategy', rooms: ['strategist'] },
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab'] },
      { floor: 'governance', rooms: ['review'] },
      { floor: 'operations', rooms: ['deploy'] }
    ],
    agentRoster: [
      { name: 'Strategist', role: 'strategist', rooms: ['strategist', 'discovery'] },
      { name: 'Desktop Architect', role: 'architect', rooms: ['architecture', 'discovery'] },
      { name: 'Desktop Dev', role: 'developer', rooms: ['code-lab'] },
      { name: 'Reviewer', role: 'reviewer', rooms: ['review'] },
      { name: 'Build Engineer', role: 'devops', rooms: ['deploy'] }
    ]
  },
  {
    id: 'other',
    label: 'Something Else',
    icon: '\u{1F4A1}',
    tagline: 'CLI tool, game, library, or anything custom',
    examples: 'Command-line tool, desktop app, game, open-source library',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'governance'],
    roomConfig: [
      { floor: 'strategy', rooms: ['strategist'] },
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab'] },
      { floor: 'governance', rooms: ['review'] }
    ],
    agentRoster: [
      { name: 'Strategist', role: 'strategist', rooms: ['strategist', 'discovery'] },
      { name: 'Architect', role: 'architect', rooms: ['architecture', 'discovery'] },
      { name: 'Developer', role: 'developer', rooms: ['code-lab'] },
      { name: 'Reviewer', role: 'reviewer', rooms: ['review'] }
    ]
  }
];

// ─── Effort Levels ───

const EFFORT_LEVELS = [
  {
    id: 'easy',
    label: 'Easy',
    icon: '\u2728',
    title: 'Hands-Off',
    description: 'Just tell me what you want. I\u2019ll handle everything.'
  },
  {
    id: 'medium',
    label: 'Medium',
    icon: '\u{1F4AC}',
    title: 'Guided',
    description: 'I\u2019ll ask a few questions to understand your needs.'
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: '\u2699\uFE0F',
    title: 'Full Control',
    description: 'Configure every detail yourself.'
  }
];

// ─── Scale Options ───

const SCALE_OPTIONS = [
  {
    id: 'small',
    label: 'Small',
    icon: '\u{1F331}',
    description: 'A focused project with a small team',
    detail: '3\u20134 AI team members',
    agentMultiplier: 0.7
  },
  {
    id: 'medium',
    label: 'Medium',
    icon: '\u{1F333}',
    description: 'A typical project with a balanced team',
    detail: '5\u20136 AI team members',
    agentMultiplier: 1.0
  },
  {
    id: 'large',
    label: 'Large',
    icon: '\u{1F3D7}\uFE0F',
    description: 'A complex project with a larger team',
    detail: '7+ AI team members',
    agentMultiplier: 1.3
  }
];

const TOTAL_STEPS = 6;


export class OnboardingWizard extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    this._step = 1;
    this._projectName = '';
    this._projectDescription = '';
    this._selectedEffort = null;
    this._selectedType = null;
    this._selectedScale = null;
    this._creating = false;
    this._codebasePath = '';
    this._codebaseAnalyzing = false;
  }

  mount() {
    this._mounted = true;
    this.render();

    this._listeners.push(
      OverlordUI.subscribe('navigate:onboarding', () => {
        this._step = 1;
        this._creating = false;
        this.render();
      })
    );
  }

  render() {
    this.el.textContent = '';
    this.el.className = 'onboarding-wizard';

    if (this._creating) {
      this._renderCreating();
      return;
    }

    // Progress indicator
    if (this._step > 1) {
      this.el.appendChild(this._renderProgress());
    }

    switch (this._step) {
      case 1: this._renderWelcome(); break;
      case 2: this._renderNameStep(); break;
      case 3: this._renderEffortStep(); break;
      case 4: this._renderTypeStep(); break;
      case 5: this._renderScaleStep(); break;
      case 6: this._renderReviewStep(); break;
    }
  }

  // ─── Progress Bar ───

  _renderProgress() {
    const bar = h('div', { class: 'wizard-progress' });
    const labels = ['Name', 'Effort', 'Type', 'Scale', 'Review'];
    for (let i = 0; i < labels.length; i++) {
      const stepNum = i + 2; // Steps 2-5
      const dot = h('div', {
        class: `wizard-progress-step${stepNum < this._step ? ' completed' : ''}${stepNum === this._step ? ' active' : ''}`
      },
        h('div', { class: 'wizard-progress-dot' }, stepNum < this._step ? '\u2713' : String(i + 1)),
        h('span', { class: 'wizard-progress-label' }, labels[i])
      );
      bar.appendChild(dot);

      if (i < labels.length - 1) {
        bar.appendChild(h('div', {
          class: `wizard-progress-line${stepNum < this._step ? ' completed' : ''}`
        }));
      }
    }
    return bar;
  }

  // ─── Project Name Extraction (for one-shot) ───

  /**
   * Parse a user's free-text description to extract a project name.
   * Tries several heuristics in order:
   *   1. "called X" / "named X" pattern
   *   2. "X app" / "X tool" / "X platform" / "X site" / "X dashboard" pattern
   *   3. First capitalized multi-word phrase (2+ words starting uppercase)
   *   4. Fallback: first 3 words of the description
   */
  _extractProjectName(description) {
    const text = (description || '').trim();
    if (!text) return 'My Project';

    // 1. "called X" or "named X" — capture consecutive Capitalized Words only
    // Stops at clause boundary words (that, which, with, for, to, it, and, or, the)
    const calledMatch = text.match(/(?:called|named)\s+["']?([A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*)*)/);
    if (calledMatch) return calledMatch[1].trim();

    // 1b. Quoted name fallback: "My App" or 'My App'
    const quotedMatch = text.match(/["']([A-Z][A-Za-z0-9]*(?:\s+[A-Za-z0-9]+){0,4})["']/);
    if (quotedMatch) return quotedMatch[1].trim();

    // 2. "X app/tool/platform/site/dashboard/service/system" pattern
    const productMatch = text.match(/([A-Z][A-Za-z0-9]+(?: [A-Za-z0-9]+){0,3})\s+(?:app|tool|platform|site|website|dashboard|service|system|portal|manager)/i);
    if (productMatch) {
      const candidate = productMatch[1].trim();
      // Only use if the first word is capitalized (proper noun feel)
      if (/^[A-Z]/.test(candidate)) return candidate;
    }

    // 3. First capitalized multi-word phrase (at least 2 words starting with uppercase)
    const capsMatch = text.match(/\b([A-Z][A-Za-z0-9]+(?: [A-Z][A-Za-z0-9]+)+)/);
    if (capsMatch) return capsMatch[1].trim();

    // 4. Fallback: first 3 meaningful words
    const words = text.replace(/^(I want|I need|Build me|Create|Make)\s+/i, '').split(/\s+/).slice(0, 3);
    const fallback = words.join(' ');
    // Capitalize first letter
    return fallback.charAt(0).toUpperCase() + fallback.slice(1);
  }

  // ─── Step 1: Welcome ───

  _renderWelcome() {
    const content = h('div', { class: 'wizard-welcome' },
      h('div', { class: 'wizard-welcome-icon' }, '\u{1F3D7}\uFE0F'),
      h('h1', { class: 'wizard-welcome-title' }, 'Welcome to Overlord'),
      h('p', { class: 'wizard-welcome-subtitle' },
        'Your AI-powered project management team. Let\u2019s set up your first project in under a minute.'
      ),
      h('div', { class: 'wizard-welcome-features' },
        this._featureItem('\u{1F916}', 'AI Team Members', 'Specialized assistants that plan, build, review, and deploy your project'),
        this._featureItem('\u{1F4CB}', 'Automated Workflow', 'From idea to launch, every step is tracked and managed'),
        this._featureItem('\u{1F50D}', 'Full Visibility', 'See what\u2019s happening across your entire project at a glance')
      )
    );

    // ─── "Use Existing Codebase" section (#872) ───
    const existingSection = h('div', { class: 'wizard-existing-codebase' },
      h('div', { class: 'wizard-oneshot-divider' },
        h('span', null, 'already have a project?')
      ),
    );
    const existingCard = h('div', { class: 'onboarding-path-card onboarding-path-primary' });
    existingCard.appendChild(h('div', { class: 'onboarding-path-body' },
      h('h3', { class: 'onboarding-path-title' }, '\u{1F4C2} Use Existing Codebase'),
      h('p', { class: 'onboarding-path-desc' }, 'Point to a folder on your machine and I\'ll figure out what kind of project it is and set everything up for you.'),
    ));
    const existingInput = h('div', { class: 'onboarding-path-input' });
    const codebasePathInput = h('input', {
      class: 'wizard-input',
      type: 'text',
      placeholder: '/path/to/your/project',
      value: this._codebasePath,
    });
    codebasePathInput.addEventListener('input', (e) => { this._codebasePath = e.target.value; });
    codebasePathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._handleCodebaseAnalyze();
      }
    });
    existingInput.appendChild(codebasePathInput);
    const analyzeBtn = h('button', {
      class: 'wizard-btn wizard-btn-primary',
      disabled: this._codebaseAnalyzing,
    }, this._codebaseAnalyzing ? 'Analyzing...' : 'Analyze');
    analyzeBtn.addEventListener('click', () => this._handleCodebaseAnalyze());
    existingInput.appendChild(analyzeBtn);
    existingCard.appendChild(existingInput);
    if (this._codebaseAnalyzing) {
      existingCard.appendChild(h('div', { class: 'onboarding-analyzing' },
        h('div', { class: 'spinner' }),
        h('span', null, 'Scanning your project...'),
      ));
    }
    existingSection.appendChild(existingCard);
    content.appendChild(existingSection);

    // ─── "Just Build It" one-shot section ───
    const oneShotSection = h('div', { class: 'wizard-oneshot' },
      h('div', { class: 'wizard-oneshot-divider' },
        h('span', null, 'or just tell me what you want')
      )
    );

    const oneShotInput = h('textarea', {
      class: 'wizard-textarea wizard-oneshot-input',
      placeholder: 'e.g. "Build me a customer portal called ClientHub" or "I need a mobile app for tracking fitness goals"...',
      rows: '3',
      maxlength: '500'
    });
    oneShotSection.appendChild(oneShotInput);

    const oneShotBtn = h('button', {
      class: 'wizard-btn wizard-btn-accent wizard-btn-lg'
    }, '\u26A1 Just Build It');
    oneShotBtn.addEventListener('click', () => {
      const description = oneShotInput.value.trim();
      if (!description) {
        Toast.error('Please describe what you want to build.');
        oneShotInput.focus();
        return;
      }
      this._handleOneShot(description);
    });
    oneShotInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const description = oneShotInput.value.trim();
        if (description) this._handleOneShot(description);
      }
    });
    oneShotSection.appendChild(oneShotBtn);
    content.appendChild(oneShotSection);

    // ─── Standard wizard actions ───
    const actions = h('div', { class: 'wizard-actions' });
    const startBtn = h('button', {
      class: 'wizard-btn wizard-btn-primary wizard-btn-lg'
    }, 'Get Started');
    startBtn.addEventListener('click', () => {
      this._step = 2;
      this.render();
    });
    actions.appendChild(startBtn);

    const skipBtn = h('button', {
      class: 'wizard-btn wizard-btn-ghost'
    }, 'Skip \u2014 I\u2019ll set up manually');
    skipBtn.addEventListener('click', () => {
      OverlordUI.dispatch('navigate:strategist');
    });
    actions.appendChild(skipBtn);

    content.appendChild(actions);
    this.el.appendChild(content);
  }

  _featureItem(icon, title, desc) {
    return h('div', { class: 'wizard-feature' },
      h('span', { class: 'wizard-feature-icon' }, icon),
      h('div', null,
        h('strong', null, title),
        h('p', null, desc)
      )
    );
  }

  // ─── Step 2: Project Name ───

  _renderNameStep() {
    const content = h('div', { class: 'wizard-step' },
      h('h2', { class: 'wizard-step-title' }, 'What\u2019s your project called?'),
      h('p', { class: 'wizard-step-subtitle' }, 'Give your project a name and a short description. You can always change these later.')
    );

    const form = h('div', { class: 'wizard-form' });

    // Project name
    const nameInput = h('input', {
      class: 'wizard-input',
      type: 'text',
      placeholder: 'e.g. Customer Portal, Marketing Website, Mobile App...',
      value: this._projectName,
      maxlength: '100',
      autofocus: ''
    });
    nameInput.addEventListener('input', (e) => {
      this._projectName = e.target.value;
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this._projectName.trim()) {
        this._step = 3; // Effort step
        this.render();
      }
    });
    form.appendChild(h('label', { class: 'wizard-label' }, 'Project Name'));
    form.appendChild(nameInput);

    // Description
    const descInput = h('textarea', {
      class: 'wizard-textarea',
      placeholder: 'Briefly describe what you\u2019re building and who it\u2019s for...',
      rows: '3',
      maxlength: '500'
    }, this._projectDescription);
    descInput.addEventListener('input', (e) => {
      this._projectDescription = e.target.value;
    });
    form.appendChild(h('label', { class: 'wizard-label', style: { marginTop: '1.5rem' } }, 'Description (optional)'));
    form.appendChild(descInput);

    content.appendChild(form);

    // Actions
    const actions = h('div', { class: 'wizard-actions wizard-actions-row' });
    const backBtn = h('button', { class: 'wizard-btn wizard-btn-ghost' }, '\u2190 Back');
    backBtn.addEventListener('click', () => { this._step = 1; this.render(); });
    actions.appendChild(backBtn);

    const hasName = this._projectName.trim().length > 0;
    const nextBtn = h('button', {
      class: `wizard-btn wizard-btn-primary${hasName ? '' : ' wizard-btn-muted'}`
    }, 'Next \u2192');
    nextBtn.addEventListener('click', () => {
      if (this._projectName.trim()) {
        this._step = 3; // Effort step
        this.render();
      }
    });
    actions.appendChild(nextBtn);

    content.appendChild(actions);
    this.el.appendChild(content);

    // Focus the input
    requestAnimationFrame(() => nameInput.focus());
  }

  // ─── Step 3: Effort Level ───

  _renderEffortStep() {
    const content = h('div', { class: 'wizard-step' },
      h('h2', { class: 'wizard-step-title' }, 'How much control do you want?'),
      h('p', { class: 'wizard-step-subtitle' }, 'Choose how involved you\u2019d like to be. You can change this later in project settings.')
    );

    const cards = h('div', { class: 'effort-level-choices' });

    for (const level of EFFORT_LEVELS) {
      const card = h('div', {
        class: `effort-level-card${this._selectedEffort?.id === level.id ? ' selected' : ''}`,
        tabindex: '0',
        role: 'option',
      });

      card.appendChild(h('div', { class: 'effort-level-icon' }, level.icon));
      card.appendChild(h('div', { class: 'effort-level-title' }, level.title));
      card.appendChild(h('div', { class: 'effort-level-desc' }, level.description));

      card.addEventListener('click', () => {
        this._selectedEffort = level;
        this._step = 4; // Type step
        this.render();
      });

      cards.appendChild(card);
    }

    cards.setAttribute('role', 'listbox');
    cards.setAttribute('aria-label', 'Effort level options');
    this._setupCardKeyboard(cards, 2);
    content.appendChild(cards);

    // Actions
    const actions = h('div', { class: 'wizard-actions wizard-actions-row' });
    const backBtn = h('button', { class: 'wizard-btn wizard-btn-ghost' }, '\u2190 Back');
    backBtn.addEventListener('click', () => { this._step = 2; this.render(); }); // Back to Name
    actions.appendChild(backBtn);
    content.appendChild(actions);

    this.el.appendChild(content);
    requestAnimationFrame(() => cards.querySelector('[tabindex="0"]')?.focus());
  }

  // ─── Step 4: Project Type ───

  _renderTypeStep() {
    const content = h('div', { class: 'wizard-step' },
      h('h2', { class: 'wizard-step-title' }, 'What kind of project is this?'),
      h('p', { class: 'wizard-step-subtitle' }, 'This helps us assign the right team members and workspaces for your project.')
    );

    const grid = h('div', { class: 'wizard-type-grid' });

    for (const type of PROJECT_TYPES) {
      const card = h('div', {
        class: `wizard-type-card${this._selectedType?.id === type.id ? ' selected' : ''}`,
        tabindex: '0',
        role: 'option',
      });

      card.appendChild(h('div', { class: 'wizard-type-icon' }, type.icon));
      card.appendChild(h('div', { class: 'wizard-type-label' }, type.label));
      card.appendChild(h('div', { class: 'wizard-type-tagline' }, type.tagline));
      card.appendChild(h('div', { class: 'wizard-type-examples' }, type.examples));

      card.addEventListener('click', () => {
        this._selectedType = type;
        this._step = 5; // Scale step
        this.render();
      });

      grid.appendChild(card);
    }

    grid.setAttribute('role', 'listbox');
    grid.setAttribute('aria-label', 'Project type options');
    this._setupCardKeyboard(grid, 3);
    content.appendChild(grid);

    // Actions
    const actions = h('div', { class: 'wizard-actions wizard-actions-row' });
    const backBtn = h('button', { class: 'wizard-btn wizard-btn-ghost' }, '\u2190 Back');
    backBtn.addEventListener('click', () => { this._step = 3; this.render(); }); // Back to Effort
    actions.appendChild(backBtn);
    content.appendChild(actions);

    this.el.appendChild(content);
    requestAnimationFrame(() => grid.querySelector('[tabindex="0"]')?.focus());
  }

  // ─── Step 5: Scale ───

  _renderScaleStep() {
    const content = h('div', { class: 'wizard-step' },
      h('h2', { class: 'wizard-step-title' }, 'How big is this project?'),
      h('p', { class: 'wizard-step-subtitle' }, 'This determines how many AI team members will work on your project.')
    );

    const grid = h('div', { class: 'wizard-scale-grid' });

    for (const scale of SCALE_OPTIONS) {
      const card = h('div', {
        class: `wizard-scale-card${this._selectedScale?.id === scale.id ? ' selected' : ''}`,
        tabindex: '0',
        role: 'option',
      });

      card.appendChild(h('div', { class: 'wizard-scale-icon' }, scale.icon));
      card.appendChild(h('div', { class: 'wizard-scale-label' }, scale.label));
      card.appendChild(h('div', { class: 'wizard-scale-desc' }, scale.description));
      card.appendChild(h('div', { class: 'wizard-scale-detail' }, scale.detail));

      card.addEventListener('click', () => {
        this._selectedScale = scale;
        this._step = 6; // Review step
        this.render();
      });

      grid.appendChild(card);
    }

    grid.setAttribute('role', 'listbox');
    grid.setAttribute('aria-label', 'Project scale options');
    this._setupCardKeyboard(grid, 4);
    content.appendChild(grid);

    // Actions
    const actions = h('div', { class: 'wizard-actions wizard-actions-row' });
    const backBtn = h('button', { class: 'wizard-btn wizard-btn-ghost' }, '\u2190 Back');
    backBtn.addEventListener('click', () => { this._step = 4; this.render(); }); // Back to Type
    actions.appendChild(backBtn);
    content.appendChild(actions);

    this.el.appendChild(content);
    requestAnimationFrame(() => grid.querySelector('[tabindex="0"]')?.focus());
  }

  // ─── Card Keyboard Navigation ───

  /**
   * Add arrow-key, Enter, and Escape handling to a card grid container.
   * @param {HTMLElement} container — the grid/flex parent holding focusable cards
   * @param {number} prevStep — step number to go back to on Escape
   */
  _setupCardKeyboard(container, prevStep) {
    container.addEventListener('keydown', (e) => {
      const cards = Array.from(container.querySelectorAll('[tabindex="0"]'));
      const idx = cards.indexOf(document.activeElement);

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = idx < cards.length - 1 ? idx + 1 : 0;
        cards[next].focus();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = idx > 0 ? idx - 1 : cards.length - 1;
        cards[prev].focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (idx >= 0) cards[idx].click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this._step = prevStep;
        this.render();
      }
    });
  }

  // ─── Step 6: Review ───

  _renderReviewStep() {
    const type = this._selectedType;
    const scale = this._selectedScale;
    if (!type || !scale) return;

    const teamSize = this._getAdjustedRoster().length;

    const content = h('div', { class: 'wizard-step' },
      h('h2', { class: 'wizard-step-title' }, 'Ready to launch!'),
      h('p', { class: 'wizard-step-subtitle' }, 'Here\u2019s a summary of your project setup. You can adjust everything later.')
    );

    // Summary cards
    const summary = h('div', { class: 'wizard-summary' });

    const effort = this._selectedEffort || EFFORT_LEVELS[0]; // default Easy
    summary.appendChild(this._summaryRow('\u{1F4DD}', 'Project', this._projectName));
    summary.appendChild(this._summaryRow(effort.icon, 'Effort', `${effort.title} \u2014 ${effort.description}`));
    summary.appendChild(this._summaryRow(type.icon, 'Type', type.label));
    summary.appendChild(this._summaryRow(scale.icon, 'Scale', `${scale.label} \u2014 ${teamSize} AI team members`));

    if (this._projectDescription) {
      summary.appendChild(this._summaryRow('\u{1F4AC}', 'Description', this._projectDescription));
    }

    // Team preview
    const teamSection = h('div', { class: 'wizard-team-preview' },
      h('h3', null, 'Your AI Team')
    );

    const roster = this._getAdjustedRoster();
    const teamGrid = h('div', { class: 'wizard-team-grid' });
    for (const agent of roster) {
      teamGrid.appendChild(h('div', { class: 'wizard-team-member' },
        h('div', { class: 'wizard-team-avatar' }, agent.name.charAt(0)),
        h('div', { class: 'wizard-team-name' }, agent.name),
        h('div', { class: 'wizard-team-role' }, this._friendlyRole(agent.role))
      ));
    }
    teamSection.appendChild(teamGrid);
    summary.appendChild(teamSection);

    content.appendChild(summary);

    // Actions
    const actions = h('div', { class: 'wizard-actions wizard-actions-row' });
    const backBtn = h('button', { class: 'wizard-btn wizard-btn-ghost' }, '\u2190 Back');
    backBtn.addEventListener('click', () => { this._step = 5; this.render(); }); // Back to Scale
    actions.appendChild(backBtn);

    const launchBtn = h('button', {
      class: 'wizard-btn wizard-btn-primary wizard-btn-lg'
    }, '\u{1F680} Launch Project');
    launchBtn.addEventListener('click', () => this._createProject());
    actions.appendChild(launchBtn);

    content.appendChild(actions);
    this.el.appendChild(content);
  }

  _summaryRow(icon, label, value) {
    return h('div', { class: 'wizard-summary-row' },
      h('span', { class: 'wizard-summary-icon' }, icon),
      h('span', { class: 'wizard-summary-label' }, label),
      h('span', { class: 'wizard-summary-value' }, value)
    );
  }

  _friendlyRole(role) {
    const map = {
      strategist: 'Planner',
      architect: 'Designer',
      developer: 'Builder',
      reviewer: 'Quality Checker',
      devops: 'Deployment Manager'
    };
    return map[role] || role;
  }

  // ─── Step 6: Creating ───

  _renderCreating() {
    this.el.appendChild(h('div', { class: 'wizard-creating' },
      h('div', { class: 'wizard-spinner' }),
      h('h2', null, 'Setting up your project...'),
      h('p', null, 'Creating your AI team and workspaces. This only takes a moment.')
    ));
  }

  // ─── Team Adjustment Logic ───

  _getAdjustedRoster() {
    const type = this._selectedType;
    const scale = this._selectedScale;
    if (!type || !scale) return [];

    const base = [...type.agentRoster];

    if (scale.id === 'small') {
      // Remove extra developers, keep at least one of each role
      const seen = new Set();
      return base.filter(a => {
        if (seen.has(a.role)) return false;
        seen.add(a.role);
        return true;
      });
    }

    if (scale.id === 'large') {
      // Add extra developer and a tester
      return [
        ...base,
        { name: 'Senior Dev', role: 'developer', rooms: ['code-lab'] },
        { name: 'Tester', role: 'reviewer', rooms: ['review'] }
      ];
    }

    return base; // medium = base roster
  }

  // ─── One-Shot "Just Build It" Handler ───

  /** Handle "Use Existing Codebase" — analyze and create (#872) */
  async _handleCodebaseAnalyze() {
    const dirPath = this._codebasePath.trim();
    if (!dirPath) {
      Toast.error('Please enter a path to your project folder.');
      return;
    }
    if (!window.overlordSocket) {
      Toast.error('Not connected to server.');
      return;
    }

    this._codebaseAnalyzing = true;
    this.render();

    try {
      const result = await window.overlordSocket.analyzeCodebase(dirPath, true);

      if (!result?.ok || !result.data) {
        Toast.error(result?.error?.message || 'Analysis failed. Check that the path is correct.');
        this._codebaseAnalyzing = false;
        this.render();
        return;
      }

      const analysis = result.data;

      // Navigate to the strategist view with analysis pre-loaded
      // Use OverlordUI dispatch to switch views, then the strategist
      // will pick up the analysis from a global handoff
      window._pendingCodebaseAnalysis = {
        analysis,
        localPath: dirPath,
      };

      OverlordUI.dispatch('navigate:strategist');

      // The strategist view will check for window._pendingCodebaseAnalysis
      // and auto-navigate to the analyze-results step

    } catch (err) {
      Toast.error(`Analysis failed: ${err.message}`);
    } finally {
      this._codebaseAnalyzing = false;
    }
  }

  async _handleOneShot(description) {
    // Extract a project name from the user's description
    const projectName = this._extractProjectName(description);

    // Default to web-app template, medium scale
    const type = PROJECT_TYPES[0]; // web-app
    const scale = SCALE_OPTIONS[1]; // medium

    this._projectName = projectName;
    this._projectDescription = description;
    this._selectedType = type;
    this._selectedScale = scale;
    this._selectedEffort = EFFORT_LEVELS[0]; // easy (hands-off)
    this._creating = true;
    this.render();

    // Suppress individual error toasts during creation — show one summary instead
    window._suppressOperationErrors = true;
    window._suppressedErrors = [];

    try {
      if (!window.overlordSocket) {
        throw new Error('Not connected to server');
      }

      // Create building with the extracted name
      const buildResult = await window.overlordSocket.createBuilding({
        name: projectName,
        config: {
          projectDescription: description,
          template: type.id,
          effortLevel: 'easy'
        }
      });

      if (!buildResult || !buildResult.ok) {
        throw new Error(buildResult?.error?.message || 'Failed to create project');
      }

      const buildingId = buildResult.data.id;

      // Apply blueprint with default roster
      const roster = this._getAdjustedRoster();
      const blueprintResult = await window.overlordSocket.applyBlueprint({
        buildingId,
        blueprint: {
          mode: 'quickStart',
          floorsNeeded: type.floorsNeeded,
          roomConfig: type.roomConfig,
          agentRoster: roster,
          projectGoals: description,
          successCriteria: ''
        },
        agentId: 'user'
      });

      if (!blueprintResult || !blueprintResult.ok) {
        throw new Error(blueprintResult?.error?.message || 'Failed to set up project');
      }

      // Auto-create milestones matching estimated phases (#536)
      await this._createPhaseMilestones(buildingId);

      Toast.success(`"${projectName}" is ready! Your AI team is standing by.`);

      await window.overlordSocket.selectBuilding(buildingId);

      // Navigate to chat view so the user can immediately start talking
      OverlordUI.dispatch('building:selected', { buildingId });
      OverlordUI.dispatch('navigate:chat');

      // Forward the user's description as the first chat message
      // Use a short delay to let the chat view mount and the room activate
      setTimeout(() => {
        if (window.overlordSocket) {
          const store = OverlordUI.getStore();
          const roomId = store?.get('rooms.active') || '';
          window.overlordSocket.sendMessage({
            text: description,
            buildingId,
            roomId,
            tokens: [],
            attachments: []
          });
        }
      }, 500);

    } catch (err) {
      console.error('[OnboardingWizard] One-shot creation failed:', err);
      Toast.error(`Something went wrong: ${err.message}`);
      this._creating = false;
      this._step = 1;
      this.render();
    } finally {
      // Re-enable error toasts and show summary if any were suppressed
      window._suppressOperationErrors = false;
      const suppressed = window._suppressedErrors || [];
      window._suppressedErrors = [];
      if (suppressed.length > 0) {
        Toast.warning(`Project created with ${suppressed.length} warning${suppressed.length > 1 ? 's' : ''} (non-critical)`);
      }
    }
  }

  // ─── Project Creation ───

  async _createProject() {
    const type = this._selectedType;
    const scale = this._selectedScale;
    if (!type || !scale) return;

    const projectName = this._projectName.trim() || 'My Project';

    this._creating = true;
    this.render();

    // Suppress individual error toasts during creation — show one summary instead
    window._suppressOperationErrors = true;
    window._suppressedErrors = [];

    try {
      if (!window.overlordSocket) {
        throw new Error('Not connected to server');
      }

      // Create building
      const effortLevel = (this._selectedEffort || EFFORT_LEVELS[0]).id; // default 'easy'
      const buildResult = await window.overlordSocket.createBuilding({
        name: projectName,
        config: {
          projectDescription: this._projectDescription || `${type.label} project`,
          template: type.id,
          effortLevel
        }
      });

      if (!buildResult || !buildResult.ok) {
        throw new Error(buildResult?.error?.message || 'Failed to create project');
      }

      const buildingId = buildResult.data.id;

      // Apply blueprint with adjusted roster
      const roster = this._getAdjustedRoster();
      const blueprintResult = await window.overlordSocket.applyBlueprint({
        buildingId,
        blueprint: {
          mode: 'quickStart',
          floorsNeeded: type.floorsNeeded,
          roomConfig: type.roomConfig,
          agentRoster: roster,
          projectGoals: this._projectDescription,
          successCriteria: ''
        },
        agentId: 'user'
      });

      if (!blueprintResult || !blueprintResult.ok) {
        throw new Error(blueprintResult?.error?.message || 'Failed to set up project');
      }

      // Auto-create milestones matching estimated phases (#536)
      await this._createPhaseMilestones(buildingId);

      Toast.success(`"${projectName}" is ready! Your AI team is standing by.`);

      await window.overlordSocket.selectBuilding(buildingId);

      OverlordUI.dispatch('navigate:dashboard');
      OverlordUI.dispatch('building:selected', { buildingId });

    } catch (err) {
      console.error('[OnboardingWizard] Project creation failed:', err);
      Toast.error(`Something went wrong: ${err.message}`);
      this._creating = false;
      this._step = 6; // Back to Review
      this.render();
    } finally {
      window._suppressOperationErrors = false;
      const suppressed = window._suppressedErrors || [];
      window._suppressedErrors = [];
      if (suppressed.length > 0) {
        Toast.warning(`Project created with ${suppressed.length} warning${suppressed.length > 1 ? 's' : ''} (non-critical)`);
      }
    }
  }

  // ─── Auto-Create Phase Milestones (#536) ───

  async _createPhaseMilestones(buildingId) {
    if (!window.overlordSocket?.createMilestone) return;

    const phases = [
      { title: 'Phase 1: Discovery',    description: 'Research requirements, gather information, identify unknowns and risks.' },
      { title: 'Phase 2: Architecture', description: 'Design system architecture, create task breakdown, define interfaces.' },
      { title: 'Phase 3: Execution',    description: 'Build the solution. Write code, create tests, implement features.' },
      { title: 'Phase 4: Review',       description: 'Review all deliverables. Code review, testing, documentation check.' },
      { title: 'Phase 5: Deploy',       description: 'Deploy to production. CI/CD pipeline, release management, monitoring.' },
    ];

    for (const phase of phases) {
      try {
        await window.overlordSocket.createMilestone({
          buildingId,
          title: phase.title,
          description: phase.description,
          status: 'open',
        });
      } catch {
        // Non-blocking — milestone creation failure shouldn't stop onboarding
      }
    }
  }
}
