/**
 * Overlord v2 — Strategist View (Phase Zero)
 *
 * New-user onboarding wizard. Presents Quick Start templates
 * for project creation, collects project goals and success criteria,
 * then triggers Phase Zero (building creation + blueprint application).
 *
 * Shown when the user has no buildings (first time, or after reset).
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h } from '../engine/helpers.js';
import { Button } from '../components/button.js';
import { Toast } from '../components/toast.js';


// ─── Template Inference ───
// Maps plain-language keywords to template IDs for one-shot prompting.
// Each template has a set of trigger words. The template with the most
// keyword hits wins. Ties go to 'web-app' (the most common project type).

const TEMPLATE_KEYWORDS = {
  'web-app': [
    'website', 'web app', 'webapp', 'web application', 'frontend', 'landing page',
    'dashboard', 'portal', 'shop', 'store', 'e-commerce', 'ecommerce', 'blog',
    'cms', 'saas', 'online', 'booking', 'marketplace', 'platform', 'bakery',
    'restaurant', 'portfolio', 'social', 'forum', 'wiki',
  ],
  'microservices': [
    'microservice', 'distributed', 'multiple services', 'event-driven', 'kafka',
    'message queue', 'service mesh', 'api gateway', 'container', 'kubernetes',
    'scalable', 'multi-service',
  ],
  'data-pipeline': [
    'data', 'pipeline', 'etl', 'analytics', 'dashboard', 'report', 'chart',
    'visualization', 'machine learning', 'ml', 'ai model', 'prediction',
    'warehouse', 'database', 'sales data', 'metrics', 'tracking',
  ],
  'cli-tool': [
    'cli', 'command line', 'command-line', 'terminal', 'script', 'automation',
    'batch', 'cron', 'utility', 'tool',
  ],
  'api-service': [
    'api', 'rest', 'graphql', 'endpoint', 'webhook', 'integration',
    'authentication', 'auth', 'backend service', 'server',
  ],
  'unity-game': [
    'unity', 'c# game', 'csharp game', '3d game', 'mobile game',
    'ar app', 'vr app', 'augmented reality', 'virtual reality',
  ],
  'js-game': [
    'browser game', 'html5 game', 'phaser', 'three.js', 'threejs',
    'pixijs', 'pixi', 'babylon', 'canvas game', 'webgl',
    '2d game', 'html game', 'web game',
  ],
  'unreal-game': [
    'unreal', 'ue5', 'ue4', 'c++ game', 'aaa game', 'fps game',
    'first person', 'high fidelity', 'photorealistic',
  ],
};

/**
 * Infer the best-matching template from a plain-language project description.
 * Returns the template object, or the default 'web-app' if no strong match.
 */
export function inferTemplate(prompt, templates) {
  if (!prompt || typeof prompt !== 'string') return templates[0]; // web-app default

  const lower = prompt.toLowerCase();
  const scores = {};

  for (const [templateId, keywords] of Object.entries(TEMPLATE_KEYWORDS)) {
    scores[templateId] = 0;
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        scores[templateId]++;
      }
    }
  }

  // Find the template with the highest score
  let bestId = 'web-app';
  let bestScore = 0;
  for (const [id, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }

  return templates.find(t => t.id === bestId) || templates[0];
}

/**
 * Extract a project name from a plain-language prompt.
 * Looks for patterns like "build me a X", "create a X", "make a X", "I need a X".
 */
export function extractProjectName(prompt) {
  if (!prompt || typeof prompt !== 'string') return '';

  // Try to extract a noun phrase after common trigger patterns
  const patterns = [
    /(?:build|create|make|develop|design)\s+(?:me\s+)?(?:a|an)\s+(.+?)(?:\s+(?:with|that|for|using|which|like|where|and)\b|$)/i,
    /(?:i\s+(?:need|want))\s+(?:a|an)\s+(.+?)(?:\s+(?:with|that|for|using|which|like|where|and)\b|$)/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match && match[1]) {
      // Capitalize first letter, trim, limit length
      const name = match[1].trim();
      if (name.length > 2 && name.length < 100) {
        return name.charAt(0).toUpperCase() + name.slice(1);
      }
    }
  }

  // Fallback: use first 50 chars of the prompt as the name
  const trimmed = prompt.trim();
  if (trimmed.length > 50) return trimmed.slice(0, 50) + '...';
  return trimmed;
}

// Quick Start project templates
const TEMPLATES = [
  {
    id: 'web-app',
    name: 'Web Application',
    icon: '\u{1F310}',
    description: 'Full-stack web app with frontend, backend, database, and deployment pipeline.',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'integration'],
    roomConfig: [
      { floor: 'strategy', rooms: ['strategist'] },
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab', 'code-lab', 'review'] },
      { floor: 'integration', rooms: ['deploy', 'monitoring'] }
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
    id: 'microservices',
    name: 'Microservices',
    icon: '\u{1F9E9}',
    description: 'Distributed architecture with multiple services, API gateways, and event-driven communication.',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'integration'],
    roomConfig: [
      { floor: 'strategy', rooms: ['strategist'] },
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab', 'code-lab', 'code-lab', 'review'] },
      { floor: 'integration', rooms: ['deploy', 'monitoring'] }
    ],
    agentRoster: [
      { name: 'Strategist', role: 'strategist', rooms: ['strategist', 'discovery'] },
      { name: 'System Architect', role: 'architect', rooms: ['architecture', 'discovery'] },
      { name: 'Service Dev A', role: 'developer', rooms: ['code-lab'] },
      { name: 'Service Dev B', role: 'developer', rooms: ['code-lab'] },
      { name: 'API Specialist', role: 'developer', rooms: ['code-lab'] },
      { name: 'QA Lead', role: 'reviewer', rooms: ['review'] },
      { name: 'Platform Engineer', role: 'devops', rooms: ['deploy', 'monitoring'] }
    ]
  },
  {
    id: 'data-pipeline',
    name: 'Data Pipeline',
    icon: '\u{1F4CA}',
    description: 'ETL pipelines, data warehousing, analytics dashboards, and ML model deployment.',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'integration'],
    roomConfig: [
      { floor: 'strategy', rooms: ['strategist'] },
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab', 'code-lab', 'review'] },
      { floor: 'integration', rooms: ['deploy'] }
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
    id: 'cli-tool',
    name: 'CLI Tool',
    icon: '\u{1F4BB}',
    description: 'Command-line application with argument parsing, subcommands, and cross-platform packaging.',
    floorsNeeded: ['strategy', 'collaboration', 'execution'],
    roomConfig: [
      { floor: 'strategy', rooms: ['strategist'] },
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab', 'review'] }
    ],
    agentRoster: [
      { name: 'Strategist', role: 'strategist', rooms: ['strategist', 'discovery'] },
      { name: 'CLI Architect', role: 'architect', rooms: ['architecture', 'discovery'] },
      { name: 'CLI Developer', role: 'developer', rooms: ['code-lab'] },
      { name: 'Reviewer', role: 'reviewer', rooms: ['review'] }
    ]
  },
  {
    id: 'api-service',
    name: 'API Service',
    icon: '\u{1F517}',
    description: 'REST or GraphQL API with authentication, rate limiting, documentation, and monitoring.',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'integration'],
    roomConfig: [
      { floor: 'strategy', rooms: ['strategist'] },
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab', 'review'] },
      { floor: 'integration', rooms: ['deploy', 'monitoring'] }
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
    id: 'unity-game',
    name: 'Unity Game',
    icon: '\u{1F3AE}',
    description: 'Unity game project with C# scripting, scene management, and asset pipeline.',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'integration'],
    roomConfig: [
      { floor: 'strategy', rooms: ['strategist'] },
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab', 'code-lab', 'review'] },
      { floor: 'integration', rooms: ['deploy'] }
    ],
    agentRoster: [
      { name: 'Strategist', role: 'strategist', rooms: ['strategist', 'discovery'] },
      { name: 'Game Designer', role: 'architect', rooms: ['architecture', 'discovery'] },
      { name: 'Gameplay Dev', role: 'developer', rooms: ['code-lab'] },
      { name: 'Systems Dev', role: 'developer', rooms: ['code-lab'] },
      { name: 'QA Tester', role: 'reviewer', rooms: ['review'] },
      { name: 'Build Engineer', role: 'devops', rooms: ['deploy'] }
    ]
  },
  {
    id: 'js-game',
    name: 'JavaScript Game',
    icon: '\u{1F579}\u{FE0F}',
    description: 'Browser-based game using Phaser, Three.js, PixiJS, or Babylon.js with web deployment.',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'integration'],
    roomConfig: [
      { floor: 'strategy', rooms: ['strategist'] },
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab', 'review'] },
      { floor: 'integration', rooms: ['deploy'] }
    ],
    agentRoster: [
      { name: 'Strategist', role: 'strategist', rooms: ['strategist', 'discovery'] },
      { name: 'Game Designer', role: 'architect', rooms: ['architecture', 'discovery'] },
      { name: 'Game Developer', role: 'developer', rooms: ['code-lab'] },
      { name: 'Reviewer', role: 'reviewer', rooms: ['review'] },
      { name: 'Deploy Engineer', role: 'devops', rooms: ['deploy'] }
    ]
  },
  {
    id: 'unreal-game',
    name: 'Unreal Engine Game',
    icon: '\u{1F525}',
    description: 'Unreal Engine project with C++ and Blueprints for high-fidelity 3D games.',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'integration'],
    roomConfig: [
      { floor: 'strategy', rooms: ['strategist'] },
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab', 'code-lab', 'review'] },
      { floor: 'integration', rooms: ['deploy'] }
    ],
    agentRoster: [
      { name: 'Strategist', role: 'strategist', rooms: ['strategist', 'discovery'] },
      { name: 'Game Designer', role: 'architect', rooms: ['architecture', 'discovery'] },
      { name: 'Gameplay Programmer', role: 'developer', rooms: ['code-lab'] },
      { name: 'Engine Programmer', role: 'developer', rooms: ['code-lab'] },
      { name: 'QA Tester', role: 'reviewer', rooms: ['review'] },
      { name: 'Build Engineer', role: 'devops', rooms: ['deploy'] }
    ]
  }
];


export class StrategistView extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    this._selectedTemplate = null;
    this._step = 'select'; // 'select' | 'effort' | 'configure' | 'creating'
    this._effortLevel = 'medium'; // 'easy' | 'medium' | 'advanced'
    this._oneShotPrompt = '';
    this._projectName = '';
    this._projectGoals = '';
    this._successCriteria = '';
    this._projectSource = 'fresh'; // 'fresh' | 'local' | 'clone'
    this._localPath = '';
    this._cloneUrl = '';
    this._pendingRepos = []; // Array of { url, name, relationship }
    this._analysisResult = null; // AI analysis result
    this._analyzing = false;
  }

  mount() {
    this._mounted = true;
    this.render();

    // Listen for navigate events
    this._listeners.push(
      OverlordUI.subscribe('navigate:strategist', () => {
        this._step = 'select';
        this._selectedTemplate = null;
        this.render();
      })
    );
  }

  render() {
    this.el.textContent = '';
    this.el.className = 'strategist-view';

    switch (this._step) {
      case 'select':
        this._renderTemplateSelection();
        break;
      case 'effort':
        this._renderEffortSelection();
        break;
      case 'configure':
        this._renderConfiguration();
        break;
      case 'creating':
        this._renderCreating();
        break;
    }
  }

  _renderTemplateSelection() {
    // Header
    const header = h('div', { class: 'strategist-header' },
      h('h2', null, 'New Project'),
      h('p', { class: 'strategist-subtitle' }, 'Describe what you want to build, or choose a template below.')
    );
    this.el.appendChild(header);

    // ── One-shot prompt input ──
    const promptSection = h('div', { class: 'one-shot-section' });
    const promptInput = h('textarea', {
      class: 'one-shot-input',
      placeholder: 'Just tell me what you want to build...\ne.g. "Build me a website for my bakery with online ordering"',
      rows: '3',
      'aria-label': 'Describe your project in plain language',
    }, this._oneShotPrompt);

    promptInput.addEventListener('input', (e) => {
      this._oneShotPrompt = e.target.value;
    });

    // Submit via Enter (but allow Shift+Enter for newlines)
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (this._oneShotPrompt.trim().length > 0) {
          this._handleOneShotSubmit();
        }
      }
    });

    const promptActions = h('div', { class: 'one-shot-actions' });
    const goBtn = Button.create('Just Build It', {
      variant: 'primary',
      size: 'md',
      icon: '\u{1F680}',
      onClick: () => {
        if (this._oneShotPrompt.trim().length > 0) {
          this._handleOneShotSubmit();
        }
      }
    });
    promptActions.appendChild(goBtn);
    promptSection.appendChild(promptInput);
    promptSection.appendChild(promptActions);
    this.el.appendChild(promptSection);

    // ── Divider ──
    const divider = h('div', { class: 'one-shot-divider' },
      h('span', null, 'or choose a template')
    );
    this.el.appendChild(divider);

    // Template grid
    const grid = h('div', { class: 'template-grid' });

    for (const template of TEMPLATES) {
      const card = h('div', {
        class: 'template-card glass-card',
        'data-template-id': template.id
      });

      const icon = h('div', { class: 'template-card-icon' }, template.icon);
      const info = h('div', { class: 'template-card-info' },
        h('h3', { class: 'template-card-name' }, template.name),
        h('p', { class: 'template-card-desc' }, template.description)
      );

      // Blueprint preview
      const preview = h('div', { class: 'template-card-preview' },
        h('span', null, `${template.floorsNeeded.length} floors`),
        h('span', null, '\u2022'),
        h('span', null, `${template.agentRoster.length} agents`),
        h('span', null, '\u2022'),
        h('span', null, `${template.roomConfig.reduce((s, f) => s + f.rooms.length, 0)} rooms`)
      );

      card.appendChild(icon);
      card.appendChild(info);
      card.appendChild(preview);

      card.addEventListener('click', () => {
        this._selectedTemplate = template;
        this._step = 'effort';
        this.render();
      });

      grid.appendChild(card);
    }

    this.el.appendChild(grid);
  }

  _renderEffortSelection() {
    const template = this._selectedTemplate;
    if (!template) return;

    // Header with back button
    const header = h('div', { class: 'strategist-header' },
      h('button', {
        class: 'btn btn-ghost btn-sm',
        onClick: () => { this._step = 'select'; this.render(); }
      }, '\u2190 Back'),
      h('h2', null, 'How much control do you want?'),
      h('p', { class: 'strategist-subtitle' }, 'Choose how involved you want to be in the technical decisions.')
    );
    this.el.appendChild(header);

    // Effort level cards
    const LEVELS = [
      {
        id: 'easy',
        name: 'Just Build It',
        icon: '\u{1F7E2}',
        description: 'Describe what you want in plain language. Overlord makes all the technical decisions for you.',
        detail: 'Best for: Quick prototypes, non-technical users, "I know what I want but not how to build it"',
      },
      {
        id: 'medium',
        name: 'Guide Me',
        icon: '\u{1F7E1}',
        description: 'Overlord asks you targeted questions and explains options in simple terms. You make the key decisions.',
        detail: 'Best for: Most projects, users who want input without technical jargon',
      },
      {
        id: 'advanced',
        name: 'Full Control',
        icon: '\u{1F534}',
        description: 'Complete access to all configuration. You specify architecture, tech stack, and implementation details.',
        detail: 'Best for: Technical users, complex requirements, specific architectural needs',
      },
    ];

    const grid = h('div', { class: 'effort-grid' });

    for (const level of LEVELS) {
      const isSelected = this._effortLevel === level.id;
      const card = h('div', {
        class: `effort-card ${isSelected ? 'selected' : ''}`,
        role: 'radio',
        'aria-checked': String(isSelected),
        tabindex: '0',
        'aria-label': `${level.name}: ${level.description}`,
      },
        h('div', { class: 'effort-card-icon' }, level.icon),
        h('div', { class: 'effort-card-body' },
          h('h3', { class: 'effort-card-name' }, level.name),
          h('p', { class: 'effort-card-desc' }, level.description),
          h('p', { class: 'effort-card-detail' }, level.detail),
        ),
        isSelected
          ? h('div', { class: 'effort-card-check' }, '\u2713')
          : null,
      );

      card.addEventListener('click', () => {
        this._effortLevel = level.id;
        this._renderEffortCards(grid, LEVELS);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this._effortLevel = level.id;
          this._renderEffortCards(grid, LEVELS);
        }
      });

      grid.appendChild(card);
    }

    this.el.appendChild(grid);

    // Continue button
    const actions = h('div', { class: 'strategist-actions' });
    const continueBtn = Button.create('Continue', {
      variant: 'primary',
      size: 'lg',
      icon: '\u2192',
      onClick: () => {
        this._step = 'configure';
        this.render();
      }
    });
    actions.appendChild(continueBtn);
    this.el.appendChild(actions);
  }

  /** Re-render just the effort cards without rebuilding the whole page */
  _renderEffortCards(grid, levels) {
    grid.textContent = '';
    for (const level of levels) {
      const isSelected = this._effortLevel === level.id;
      const card = h('div', {
        class: `effort-card ${isSelected ? 'selected' : ''}`,
        role: 'radio',
        'aria-checked': String(isSelected),
        tabindex: '0',
        'aria-label': `${level.name}: ${level.description}`,
      },
        h('div', { class: 'effort-card-icon' }, level.icon),
        h('div', { class: 'effort-card-body' },
          h('h3', { class: 'effort-card-name' }, level.name),
          h('p', { class: 'effort-card-desc' }, level.description),
          h('p', { class: 'effort-card-detail' }, level.detail),
        ),
        isSelected
          ? h('div', { class: 'effort-card-check' }, '\u2713')
          : null,
      );

      card.addEventListener('click', () => {
        this._effortLevel = level.id;
        this._renderEffortCards(grid, levels);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this._effortLevel = level.id;
          this._renderEffortCards(grid, levels);
        }
      });
      grid.appendChild(card);
    }
  }

  /**
   * Handle one-shot prompt submission.
   * Infers the template, sets effort to easy, auto-fills goals, and creates the project.
   */
  _handleOneShotSubmit() {
    const prompt = this._oneShotPrompt.trim();
    if (!prompt) return;

    // Infer the best template from the description
    this._selectedTemplate = inferTemplate(prompt, TEMPLATES);
    this._effortLevel = 'easy';
    this._projectName = extractProjectName(prompt);
    this._projectGoals = prompt;
    this._successCriteria = `Project works as described: "${prompt.length > 100 ? prompt.slice(0, 100) + '...' : prompt}"`;

    // Skip straight to creating — "Just Build It" means zero extra steps
    this._createProject();
  }

  _renderConfiguration() {
    const template = this._selectedTemplate;
    if (!template) return;

    // Back button + header
    const header = h('div', { class: 'strategist-header' },
      h('button', {
        class: 'btn btn-ghost btn-sm',
        onClick: () => { this._step = 'effort'; this.render(); }
      }, '\u2190 Back'),
      h('h2', null, `Configure: ${template.name}`),
      h('p', { class: 'strategist-subtitle' }, template.description),
      h('div', { class: 'effort-level-badge' },
        h('span', { class: 'effort-level-badge-dot' },
          this._effortLevel === 'easy' ? '\u{1F7E2}'
            : this._effortLevel === 'advanced' ? '\u{1F534}'
            : '\u{1F7E1}'
        ),
        h('span', null,
          this._effortLevel === 'easy' ? 'Just Build It'
            : this._effortLevel === 'advanced' ? 'Full Control'
            : 'Guide Me'
        )
      )
    );
    this.el.appendChild(header);

    // Configuration form
    const form = h('div', { class: 'strategist-form' });

    // Project name
    const nameGroup = h('div', { class: 'form-group' },
      h('label', { class: 'form-label', for: 'project-name' }, 'Project Name'),
      h('input', {
        class: 'form-input',
        id: 'project-name',
        type: 'text',
        placeholder: 'My Awesome Project',
        value: this._projectName
      })
    );
    nameGroup.querySelector('input').addEventListener('input', (e) => {
      this._projectName = e.target.value;
    });
    form.appendChild(nameGroup);

    // Project goals
    const goalsGroup = h('div', { class: 'form-group' },
      h('label', { class: 'form-label', for: 'project-goals' }, 'Project Goals'),
      h('textarea', {
        class: 'form-input form-textarea',
        id: 'project-goals',
        placeholder: 'What are you building? What problem does it solve?',
        rows: '3'
      }, this._projectGoals)
    );
    goalsGroup.querySelector('textarea').addEventListener('input', (e) => {
      this._projectGoals = e.target.value;
    });
    form.appendChild(goalsGroup);

    // Success criteria
    const criteriaGroup = h('div', { class: 'form-group' },
      h('label', { class: 'form-label', for: 'success-criteria' }, 'Success Criteria'),
      h('textarea', {
        class: 'form-input form-textarea',
        id: 'success-criteria',
        placeholder: 'How will you know when the project is complete?',
        rows: '3'
      }, this._successCriteria)
    );
    criteriaGroup.querySelector('textarea').addEventListener('input', (e) => {
      this._successCriteria = e.target.value;
    });
    form.appendChild(criteriaGroup);

    // Project source (#614)
    const sourceGroup = h('div', { class: 'form-group' },
      h('label', { class: 'form-label' }, 'Project Source'),
      h('p', { class: 'form-hint' }, 'Where should the project files live?'),
    );
    const sourceOptions = h('div', { class: 'project-source-options' });

    for (const opt of [
      { id: 'fresh', icon: '\u2728', label: 'Start Fresh', desc: 'Create a new empty project directory' },
      { id: 'local', icon: '\u{1F4C2}', label: 'Link Local Directory', desc: 'Point to an existing folder on your machine' },
      { id: 'clone', icon: '\u{1F517}', label: 'Clone from URL', desc: 'Clone a Git repository by URL' },
    ]) {
      const isSelected = this._projectSource === opt.id;
      const card = h('div', {
        class: `project-source-card${isSelected ? ' selected' : ''}`,
        role: 'radio',
        'aria-checked': String(isSelected),
        tabindex: '0',
      },
        h('span', { class: 'project-source-icon' }, opt.icon),
        h('div', { class: 'project-source-info' },
          h('strong', null, opt.label),
          h('span', { class: 'project-source-desc' }, opt.desc),
        ),
        isSelected ? h('span', { class: 'project-source-check' }, '\u2713') : null,
      );
      card.addEventListener('click', () => {
        this._projectSource = opt.id;
        this._renderSourceOptions(sourceGroup, sourceOptions);
      });
      sourceOptions.appendChild(card);
    }
    sourceGroup.appendChild(sourceOptions);

    // Conditional input for local path or clone URL
    const sourceInput = h('div', { class: 'project-source-input' });
    if (this._projectSource === 'local') {
      const pathInput = h('input', {
        class: 'form-input mono',
        type: 'text',
        placeholder: '/path/to/your/project',
        value: this._localPath,
      });
      pathInput.addEventListener('input', (e) => { this._localPath = e.target.value; });
      sourceInput.appendChild(pathInput);
    } else if (this._projectSource === 'clone') {
      const urlInput = h('input', {
        class: 'form-input mono',
        type: 'text',
        placeholder: 'https://github.com/owner/repo.git',
        value: this._cloneUrl,
      });
      urlInput.addEventListener('input', (e) => { this._cloneUrl = e.target.value; });
      sourceInput.appendChild(urlInput);
    }
    sourceGroup.appendChild(sourceInput);
    form.appendChild(sourceGroup);

    // Component repositories (multi-repo picker) (#640)
    const repoGroup = h('div', { class: 'form-group' },
      h('label', { class: 'form-label' }, 'Component Repositories'),
      h('p', { class: 'form-hint' }, 'Add GitHub repos as building blocks for your project (optional).'),
    );

    // Add repo input row
    const repoInputRow = h('div', { class: 'repo-add-row' });
    const repoUrlInput = h('input', {
      class: 'form-input mono repo-url-input',
      type: 'text',
      placeholder: 'https://github.com/owner/repo',
    });
    const repoRelSelect = h('select', { class: 'form-input repo-rel-select' },
      h('option', { value: 'reference' }, 'Reference'),
      h('option', { value: 'dependency' }, 'Dependency'),
      h('option', { value: 'fork' }, 'Fork'),
      h('option', { value: 'submodule' }, 'Submodule'),
    );
    const repoAddBtn = Button.create('Add', {
      variant: 'secondary',
      size: 'sm',
      onClick: () => {
        const url = repoUrlInput.value.trim();
        if (!url) return;
        // Basic URL validation
        try {
          const parsed = new URL(url);
          if (!parsed.hostname || !['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid');
        } catch {
          repoUrlInput.classList.add('input-error');
          if (!repoInputRow.querySelector('.repo-error')) {
            repoInputRow.appendChild(h('span', { class: 'repo-error' }, 'Enter a valid URL'));
          }
          return;
        }
        repoUrlInput.classList.remove('input-error');
        const existingError = repoInputRow.querySelector('.repo-error');
        if (existingError) existingError.remove();

        // Extract name from URL (owner/repo)
        const pathParts = new URL(url).pathname.replace(/\.git$/, '').split('/').filter(Boolean);
        const name = pathParts.length >= 2 ? `${pathParts[0]}/${pathParts[1]}` : pathParts.join('/') || url;

        // Check for duplicates
        if (this._pendingRepos.some(r => r.url === url)) {
          repoUrlInput.classList.add('input-error');
          if (!repoInputRow.querySelector('.repo-error')) {
            repoInputRow.appendChild(h('span', { class: 'repo-error' }, 'Repo already added'));
          }
          return;
        }

        this._pendingRepos.push({ url, name, relationship: repoRelSelect.value });
        repoUrlInput.value = '';
        this._renderRepoList(repoListEl);
      }
    });
    repoUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); repoAddBtn.click(); }
    });
    repoInputRow.appendChild(repoUrlInput);
    repoInputRow.appendChild(repoRelSelect);
    repoInputRow.appendChild(repoAddBtn);
    repoGroup.appendChild(repoInputRow);

    // Pending repo list
    const repoListEl = h('div', { class: 'repo-list' });
    this._renderRepoList(repoListEl);
    repoGroup.appendChild(repoListEl);

    // Analyze button + results container (#642)
    const analyzeRow = h('div', { class: 'repo-analyze-row' });
    const analyzeBtn = Button.create('AI: Analyze & Suggest', {
      variant: 'secondary',
      size: 'sm',
      icon: '\u{1F916}',
      disabled: this._pendingRepos.length === 0 && !this._analysisResult,
      onClick: () => this._analyzeRepos(analyzeBtn, analysisContainer),
    });
    if (this._analyzing) {
      analyzeBtn.disabled = true;
      analyzeBtn.textContent = 'Analyzing...';
    }
    analyzeRow.appendChild(analyzeBtn);
    repoGroup.appendChild(analyzeRow);

    const analysisContainer = h('div', { class: 'repo-analysis-results' });
    if (this._analysisResult) {
      this._renderAnalysisResults(analysisContainer);
    }
    repoGroup.appendChild(analysisContainer);

    form.appendChild(repoGroup);

    // Blueprint preview
    const previewSection = h('div', { class: 'blueprint-preview' },
      h('h3', null, 'Blueprint Preview')
    );

    // Floors
    const floorList = h('div', { class: 'blueprint-floors' });
    for (const floorType of template.floorsNeeded) {
      const roomsOnFloor = template.roomConfig
        .filter(rc => rc.floor === floorType)
        .flatMap(rc => rc.rooms);

      floorList.appendChild(h('div', { class: 'blueprint-floor-row' },
        h('span', {
          class: 'blueprint-floor-dot',
          style: { background: `var(--floor-${floorType})` }
        }),
        h('span', { class: 'blueprint-floor-name' }, floorType),
        h('span', { class: 'blueprint-floor-rooms' },
          roomsOnFloor.map(r => r).join(', ')
        )
      ));
    }
    previewSection.appendChild(floorList);

    // Agents
    const agentList = h('div', { class: 'blueprint-agents' },
      h('h4', null, `${template.agentRoster.length} Agents`)
    );
    for (const agent of template.agentRoster) {
      agentList.appendChild(h('div', { class: 'blueprint-agent-row' },
        h('span', { class: 'blueprint-agent-name' }, agent.name),
        h('span', { class: 'blueprint-agent-role' }, agent.role),
        h('span', { class: 'blueprint-agent-rooms' }, agent.rooms.join(', '))
      ));
    }
    previewSection.appendChild(agentList);

    form.appendChild(previewSection);

    // Create button
    const actions = h('div', { class: 'strategist-actions' });
    const createBtn = Button.create('Create Project', {
      variant: 'primary',
      size: 'lg',
      icon: '\u{1F680}',
      onClick: () => this._createProject()
    });
    actions.appendChild(createBtn);
    form.appendChild(actions);

    this.el.appendChild(form);
  }

  _renderCreating() {
    this.el.appendChild(h('div', { class: 'empty-state' },
      h('div', { class: 'spinner' }),
      h('p', { class: 'empty-state-title', style: { marginTop: '1rem' } }, 'Creating Project...'),
      h('p', { class: 'empty-state-text' }, 'Setting up building, floors, rooms, and agents.')
    ));
  }

  /** Re-render source option cards without full page rebuild (preserves input focus) */
  _renderSourceOptions(group, optionsContainer) {
    // Update selected state on cards
    optionsContainer.querySelectorAll('.project-source-card').forEach(card => {
      const isSelected = card.querySelector('.project-source-info strong')?.textContent?.includes(
        this._projectSource === 'fresh' ? 'Start Fresh' :
        this._projectSource === 'local' ? 'Local Directory' : 'Clone'
      );
      card.classList.toggle('selected', !!isSelected);
      const check = card.querySelector('.project-source-check');
      if (check) check.remove();
      if (isSelected) card.appendChild(h('span', { class: 'project-source-check' }, '\u2713'));
    });

    // Update the conditional input area
    let inputArea = group.querySelector('.project-source-input');
    if (!inputArea) {
      inputArea = h('div', { class: 'project-source-input' });
      group.appendChild(inputArea);
    }
    inputArea.textContent = '';
    if (this._projectSource === 'local') {
      const pathInput = h('input', {
        class: 'form-input mono', type: 'text',
        placeholder: '/path/to/your/project', value: this._localPath,
      });
      pathInput.addEventListener('input', (e) => { this._localPath = e.target.value; });
      inputArea.appendChild(pathInput);
      requestAnimationFrame(() => pathInput.focus());
    } else if (this._projectSource === 'clone') {
      const urlInput = h('input', {
        class: 'form-input mono', type: 'text',
        placeholder: 'https://github.com/owner/repo.git', value: this._cloneUrl,
      });
      urlInput.addEventListener('input', (e) => { this._cloneUrl = e.target.value; });
      inputArea.appendChild(urlInput);
      requestAnimationFrame(() => urlInput.focus());
    }
  }

  /** Call AI to analyze pending repos and suggest integration strategies (#642) */
  async _analyzeRepos(btn, container) {
    if (this._pendingRepos.length === 0 || !window.overlordSocket) return;

    this._analyzing = true;
    btn.disabled = true;
    btn.textContent = 'Analyzing...';
    container.textContent = '';
    container.appendChild(h('div', { class: 'repo-analysis-loading' },
      h('div', { class: 'spinner' }),
      h('span', null, 'AI is analyzing your repos...')
    ));

    try {
      const result = await window.overlordSocket.analyzeRepos({
        repos: this._pendingRepos.map(r => ({ url: r.url, name: r.name })),
        projectName: this._projectName || 'New Project',
        projectGoals: this._projectGoals || '',
      });

      if (result?.ok && result.data?.suggestions) {
        this._analysisResult = result.data;

        // Apply AI suggestions to pending repos
        for (const suggestion of result.data.suggestions) {
          const pending = this._pendingRepos.find(r => r.url === suggestion.url || r.name === suggestion.name);
          if (pending) {
            pending.relationship = suggestion.relationship;
            pending.aiSuggestion = suggestion;
          }
        }
      } else {
        this._analysisResult = null;
        Toast.error(`Analysis failed: ${result?.error?.message || 'Unknown error'}`);
      }
    } catch (err) {
      this._analysisResult = null;
      Toast.error(`Analysis failed: ${err.message}`);
    } finally {
      this._analyzing = false;
      btn.disabled = false;
      btn.textContent = 'AI: Analyze & Suggest';
      container.textContent = '';
      if (this._analysisResult) {
        this._renderAnalysisResults(container);
      }
    }
  }

  /** Render AI analysis results (#642) */
  _renderAnalysisResults(container) {
    const result = this._analysisResult;
    if (!result) return;

    // Summary
    if (result.summary) {
      container.appendChild(h('div', { class: 'analysis-summary' },
        h('strong', null, 'Integration Strategy: '),
        h('span', null, result.summary),
      ));
    }

    // Per-repo suggestion cards
    for (const suggestion of result.suggestions) {
      const card = h('div', { class: 'analysis-card' },
        h('div', { class: 'analysis-card-header' },
          h('span', { class: 'analysis-card-name' }, suggestion.name),
          h('span', { class: `repo-list-badge rel-${suggestion.relationship}` }, suggestion.relationship),
        ),
        h('div', { class: 'analysis-card-body' },
          h('div', { class: 'analysis-field' },
            h('strong', null, 'Suggestion: '),
            h('span', null, suggestion.reason),
          ),
          h('div', { class: 'analysis-field' },
            h('strong', null, 'Action: '),
            h('span', null, suggestion.action),
          ),
        ),
      );

      // Tech stack badges
      if (suggestion.techStack?.length > 0) {
        const techRow = h('div', { class: 'analysis-tech-row' });
        for (const tech of suggestion.techStack) {
          techRow.appendChild(h('span', { class: 'analysis-tech-badge' }, tech));
        }
        card.querySelector('.analysis-card-body').appendChild(techRow);
      }

      // Key files
      if (suggestion.keyFiles?.length > 0) {
        const filesEl = h('div', { class: 'analysis-field' },
          h('strong', null, 'Key files: '),
          h('span', { class: 'mono' }, suggestion.keyFiles.join(', ')),
        );
        card.querySelector('.analysis-card-body').appendChild(filesEl);
      }

      // Override relationship dropdown
      const overrideRow = h('div', { class: 'analysis-override' },
        h('label', null, 'Override: '),
      );
      const overrideSelect = h('select', { class: 'form-input repo-rel-select' },
        h('option', { value: 'reference', selected: suggestion.relationship === 'reference' }, 'Reference'),
        h('option', { value: 'dependency', selected: suggestion.relationship === 'dependency' }, 'Dependency'),
        h('option', { value: 'fork', selected: suggestion.relationship === 'fork' }, 'Fork'),
        h('option', { value: 'submodule', selected: suggestion.relationship === 'submodule' }, 'Submodule'),
      );
      overrideSelect.value = suggestion.relationship;
      overrideSelect.addEventListener('change', () => {
        const pending = this._pendingRepos.find(r => r.url === suggestion.url || r.name === suggestion.name);
        if (pending) pending.relationship = overrideSelect.value;
        // Update the badge
        const badge = card.querySelector('.repo-list-badge');
        if (badge) {
          badge.textContent = overrideSelect.value;
          badge.className = `repo-list-badge rel-${overrideSelect.value}`;
        }
      });
      overrideRow.appendChild(overrideSelect);
      card.appendChild(overrideRow);

      container.appendChild(card);
    }
  }

  /** Render the list of pending repos below the add-repo input */
  _renderRepoList(listEl) {
    listEl.textContent = '';
    if (this._pendingRepos.length === 0) return;

    for (let i = 0; i < this._pendingRepos.length; i++) {
      const repo = this._pendingRepos[i];
      const row = h('div', { class: 'repo-list-item' },
        h('span', { class: 'repo-list-name' }, repo.name),
        h('span', { class: `repo-list-badge rel-${repo.relationship}` }, repo.relationship),
        h('span', { class: 'repo-list-url' }, repo.url),
      );
      const removeBtn = h('button', {
        class: 'repo-remove-btn',
        title: 'Remove',
        'aria-label': `Remove ${repo.name}`,
      }, '\u2715');
      removeBtn.addEventListener('click', () => {
        this._pendingRepos.splice(i, 1);
        this._renderRepoList(listEl);
      });
      row.appendChild(removeBtn);
      listEl.appendChild(row);
    }
  }

  async _createProject() {
    const template = this._selectedTemplate;
    if (!template) return;

    const projectName = this._projectName.trim() || template.name;

    this._step = 'creating';
    this.render();

    // Suppress individual error toasts during creation — show one summary instead
    window._suppressOperationErrors = true;
    window._suppressedErrors = [];

    try {
      if (!window.overlordSocket) {
        throw new Error('Socket not connected');
      }

      // Step 1: Create building with project source (#614)
      const buildParams = {
        name: projectName,
        effortLevel: this._effortLevel,
        config: {
          projectDescription: this._projectGoals || `${template.name} project`,
          template: template.id,
          effortLevel: this._effortLevel,
        },
      };
      if (this._projectSource === 'local' && this._localPath.trim()) {
        buildParams.workingDirectory = this._localPath.trim();
      }
      if (this._projectSource === 'clone' && this._cloneUrl.trim()) {
        buildParams.repoUrl = this._cloneUrl.trim();
      }
      const buildResult = await window.overlordSocket.createBuilding(buildParams);

      if (!buildResult || !buildResult.ok) {
        throw new Error(buildResult?.error?.message || 'Failed to create building');
      }

      const buildingId = buildResult.data.id;

      // Step 1b: Link pending repos (#640)
      if (this._pendingRepos.length > 0 && window.overlordSocket) {
        const repoPromises = this._pendingRepos.map(repo =>
          window.overlordSocket.addRepo({
            buildingId,
            repoUrl: repo.url,
            name: repo.name,
            relationship: repo.relationship,
          })
        );
        const repoResults = await Promise.allSettled(repoPromises);
        const failed = repoResults.filter(r => r.status === 'rejected' || (r.value && !r.value.ok));
        if (failed.length > 0) {
          console.warn(`[StrategistView] ${failed.length}/${this._pendingRepos.length} repos failed to link`);
        }
      }

      // Step 2: Apply blueprint
      const blueprintResult = await window.overlordSocket.applyBlueprint({
        buildingId,
        blueprint: {
          mode: 'quickStart',
          effortLevel: this._effortLevel,
          floorsNeeded: template.floorsNeeded,
          roomConfig: template.roomConfig,
          agentRoster: template.agentRoster,
          projectGoals: this._projectGoals,
          successCriteria: this._successCriteria
        },
        agentId: 'user'
      });

      if (!blueprintResult || !blueprintResult.ok) {
        throw new Error(blueprintResult?.error?.message || 'Failed to apply blueprint');
      }

      Toast.success(`Project "${projectName}" created successfully!`);

      // Select the new building (hydrates all data into store)
      await window.overlordSocket.selectBuilding(buildingId);

      OverlordUI.dispatch('navigate:dashboard');
      OverlordUI.dispatch('building:selected', { buildingId });

    } catch (err) {
      console.error('[StrategistView] Project creation failed:', err);
      Toast.error(`Failed to create project: ${err.message}`);
      this._step = 'configure';
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
}
