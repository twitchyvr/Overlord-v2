/**
 * Overlord v2 — Exit Document Form
 *
 * Dynamic form generator that reads a room's exitRequired config
 * and renders input fields for each required field.
 * Opens as a modal when triggered from Room View or agent workflow.
 *
 * Submits via overlordSocket.submitExitDoc() → backend validates
 * against room contract, stores in DB, and creates RAID entry.
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h } from '../engine/helpers.js';
import { Modal } from '../components/modal.js';
import { Toast } from '../components/toast.js';


/**
 * Human-readable label for a camelCase field name.
 * e.g., "filesModified" → "Files Modified"
 */
function humanize(field) {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, c => c.toUpperCase())
    .trim();
}

/**
 * Hint text for known field names.
 * Falls back to a generic prompt for unrecognized fields.
 */
const FIELD_HINTS = {
  // Strategist / building-blueprint
  projectGoals: 'What is this project trying to achieve? List primary goals.',
  successCriteria: 'How will you know when the project is complete? Measurable outcomes.',
  floorsNeeded: 'Which organizational floors are required? (strategy, collaboration, execution, integration, ...)',
  roomConfig: 'Room layout per floor in JSON format.',
  agentRoster: 'List of agents, their roles, and room assignments.',
  estimatedPhases: 'How many phases and rough timeline for each.',

  // Discovery / requirements-document
  businessOutcomes: 'Expected business outcomes and value delivered.',
  constraints: 'Technical, budgetary, or timeline constraints.',
  unknowns: 'Known unknowns and areas requiring further research.',
  gapAnalysis: 'Gaps between current state and desired state.',
  riskAssessment: 'Identified risks with severity and mitigation strategies.',
  acceptanceCriteria: 'Criteria that must be met for the work to be accepted.',

  // Architecture / architecture-document
  milestones: 'Key milestones and their target dates.',
  taskBreakdown: 'Tasks broken down by component or feature area.',
  dependencyGraph: 'Dependencies between tasks and external systems.',
  techDecisions: 'Key technology decisions and their rationale.',
  fileAssignments: 'Which files/modules are assigned to which agents.',

  // Code Lab / implementation-report
  filesModified: 'List all files that were created or modified.',
  testsAdded: 'List of test files or test cases added.',
  changesDescription: 'Description of what was changed and why.',

  // Testing Lab / test-report
  testsRun: 'Total number of tests executed.',
  testsPassed: 'Number of tests that passed.',
  testsFailed: 'Number of tests that failed (with details).',
  coverage: 'Code coverage percentage or summary.',
  lintErrors: 'Lint errors found and whether they were resolved.',
  recommendations: 'Recommendations for improvements or follow-up work.',

  // Review / gate-review
  verdict: 'GO / NO-GO / CONDITIONAL verdict.',
  evidence: 'Evidence supporting the verdict. One item per line, or JSON: [{"claim":"...","proof":"...","citation":"file:line"}]',
  conditions: 'Conditions that must be met (if CONDITIONAL). One per line.',
  riskQuestionnaire: 'Risk questionnaire responses. One per line, or JSON: [{"question":"...","answer":"...","risk":"low|medium|high"}]',

  // Deploy / deployment-report
  environment: 'Target deployment environment (staging, production, etc.).',
  version: 'Version being deployed.',
  deployedAt: 'Deployment timestamp or date.',
  healthCheck: 'Health check results after deployment.',
  rollbackPlan: 'Rollback plan if deployment fails.',

  // War Room / incident-report
  incidentSummary: 'Summary of the incident.',
  rootCause: 'Root cause analysis.',
  resolution: 'How the incident was resolved.',
  preventionPlan: 'Plan to prevent recurrence.',
  timeToResolve: 'Time taken to resolve the incident.',

  // Data Exchange / data-flow-summary
  sources: 'Data sources used.',
  transformationsApplied: 'Transformations applied to the data.',
  outputs: 'Output artifacts produced.',
  validationResults: 'Results of data validation checks.',

  // Plugin Bay / plugin-inventory
  installedPlugins: 'List of plugins installed.',
  configuredPlugins: 'Plugin configurations applied.',
  testResults: 'Test results for plugin integrations.',
  removedPlugins: 'Plugins that were removed and why.',

  // Provider Hub / provider-configuration-summary
  activeProviders: 'Currently active AI providers.',
  fallbackChains: 'Fallback provider chain configuration.',
  comparisonResults: 'Results of provider comparisons.',
  configurationChanges: 'Configuration changes made.',

  // Building Architect / custom-building-plan
  floors: 'Custom floor definitions.',
  roomAssignments: 'Room assignments per floor.',
  agentDefinitions: 'Agent definitions and capabilities.',
  toolOverrides: 'Tool configuration overrides.',
  phaseConfig: 'Phase progression configuration.',
};

/**
 * Determine whether a field should use a textarea or input.
 * Fields with "description", "summary", "plan", "criteria", etc. get textareas.
 */
function isLongField(field) {
  const longPatterns = [
    'description', 'summary', 'plan', 'criteria', 'assessment',
    'analysis', 'report', 'evidence', 'questionnaire', 'recommendations',
    'rootCause', 'resolution', 'preventionPlan', 'conditions',
    'unknowns', 'constraints', 'businessOutcomes',
    'changesDescription', 'riskAssessment', 'incidentSummary',
  ];
  const lower = field.toLowerCase();
  return longPatterns.some(p => lower.includes(p.toLowerCase()));
}

/**
 * Determine whether a field expects structured data (JSON/list).
 */
function isStructuredField(field) {
  const structuredPatterns = [
    'config', 'roster', 'graph', 'assignments', 'breakdown',
    'milestones', 'sources', 'outputs', 'plugins', 'providers',
    'chains', 'overrides', 'definitions', 'floors',
    'roomConfig', 'agentRoster', 'floorsNeeded', 'roomAssignments',
    'agentDefinitions', 'toolOverrides', 'phaseConfig',
    'filesModified', 'testsAdded', 'installedPlugins',
    'configuredPlugins', 'removedPlugins', 'transformationsApplied',
    'validationResults', 'testResults', 'comparisonResults',
    'configurationChanges', 'activeProviders', 'fallbackChains',
    // Review room
    'evidence', 'conditions', 'riskQuestionnaire',
    // Architecture room
    'techDecisions', 'dependencyGraph', 'fileAssignments',
    // Discovery room
    'businessOutcomes', 'constraints', 'unknowns', 'acceptanceCriteria',
    'gapAnalysis', 'riskAssessment',
    // Testing Lab
    'failures', 'coverage', 'recommendations',
    // War Room
    'preventionPlan',
    // Deploy
    'healthCheck',
    // Strategist
    'projectGoals', 'successCriteria', 'estimatedPhases',
  ];
  // Use exact match only — substring matching causes false positives
  // (e.g. field 'changesDescription' matching pattern 'definitions')
  return structuredPatterns.some(p => field === p);
}

/**
 * Determine whether a field expects a numeric value.
 * Backend validates typeof === 'number' for these fields.
 */
function isNumericField(field) {
  const numericFields = [
    'testsRun', 'testsPassed', 'testsFailed', 'lintErrors',
    'coverage', 'errorCount', 'warningCount',
  ];
  return numericFields.includes(field);
}


export class ExitDocForm extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    this._roomId = null;
    this._roomData = null;
    this._agentId = null;
    this._buildingId = null;
    this._phase = null;
    this._fieldValues = {};
    this._submitting = false;
  }

  mount() {
    this._mounted = true;

    // Listen for exit-doc-form open events
    this._listeners.push(
      OverlordUI.subscribe('exit-doc:open-form', (data) => {
        this._openForm(data);
      })
    );
  }

  /**
   * Open the exit document form modal.
   * @param {object} data
   * @param {string} data.roomId    — room to submit exit doc for
   * @param {object} data.roomData  — full room data (with exitRequired)
   * @param {string} [data.agentId] — agent submitting (defaults to 'user')
   * @param {string} [data.buildingId]
   * @param {string} [data.phase]
   */
  _openForm(data) {
    this._roomId = data.roomId;
    this._roomData = data.roomData;
    this._agentId = data.agentId || 'user';
    this._buildingId = data.buildingId || OverlordUI.getStore()?.get('building.active');
    this._phase = data.phase || OverlordUI.getStore()?.get('building.activePhase') || 'strategy';
    this._fieldValues = {};
    this._submitting = false;

    const exitReq = this._roomData?.exitRequired;
    if (!exitReq || !exitReq.fields || exitReq.fields.length === 0) {
      Toast.warning('This room has no exit document requirements.');
      return;
    }

    // Pre-populate field values with empty strings
    for (const field of exitReq.fields) {
      this._fieldValues[field] = '';
    }

    this._showModal();
  }

  _showModal() {
    const exitReq = this._roomData.exitRequired;
    const content = this._buildFormContent(exitReq);

    Modal.open('exit-doc-form', {
      title: `Exit Document: ${humanize(exitReq.type)}`,
      content,
      size: 'lg',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
      onClose: () => {
        this._fieldValues = {};
        this._submitting = false;
      }
    });
  }

  _buildFormContent(exitReq) {
    const container = h('div', { class: 'exit-doc-form' });

    // Room context header
    const roomType = this._roomData?.type || 'unknown';
    container.appendChild(h('div', { class: 'exit-doc-context' },
      h('div', { class: 'exit-doc-context-row' },
        h('span', { class: 'exit-doc-context-label' }, 'Room'),
        h('span', { class: 'exit-doc-context-value' },
          this._roomData?.name || humanize(roomType))
      ),
      h('div', { class: 'exit-doc-context-row' },
        h('span', { class: 'exit-doc-context-label' }, 'Document Type'),
        h('span', { class: 'exit-doc-context-value badge' }, exitReq.type)
      ),
      h('div', { class: 'exit-doc-context-row' },
        h('span', { class: 'exit-doc-context-label' }, 'Required Fields'),
        h('span', { class: 'exit-doc-context-value' }, `${exitReq.fields.length}`)
      )
    ));

    // Progress indicator
    const progressBar = h('div', { class: 'exit-doc-progress', 'data-testid': 'exit-doc-progress' });
    const progressFill = h('div', { class: 'exit-doc-progress-fill', style: { width: '0%' } });
    progressBar.appendChild(progressFill);
    container.appendChild(progressBar);

    // Field inputs
    const fieldsContainer = h('div', { class: 'exit-doc-fields' });

    for (let i = 0; i < exitReq.fields.length; i++) {
      const field = exitReq.fields[i];
      const label = humanize(field);
      const hint = FIELD_HINTS[field] || `Enter ${label.toLowerCase()} details.`;
      const isLong = isLongField(field);
      const isStruct = isStructuredField(field);

      const fieldGroup = h('div', { class: 'exit-doc-field-group' });

      // Label + field number
      fieldGroup.appendChild(h('div', { class: 'exit-doc-field-header' },
        h('span', { class: 'exit-doc-field-number' }, `${i + 1}`),
        h('label', { class: 'exit-doc-field-label', for: `exit-field-${field}` }, label),
        h('span', { class: 'exit-doc-field-required' }, 'Required')
      ));

      // Hint text
      fieldGroup.appendChild(h('p', { class: 'exit-doc-field-hint' }, hint));

      // Input element
      let inputEl;
      if (isLong || isStruct) {
        const structPlaceholder = isStruct && hint !== `Provide the ${label.toLowerCase()} for this document.`
          ? hint
          : `Enter ${label.toLowerCase()} (JSON array or one item per line)`;
        inputEl = h('textarea', {
          class: `form-input exit-doc-textarea${isStruct ? ' exit-doc-structured' : ''}`,
          id: `exit-field-${field}`,
          rows: isStruct ? '6' : '4',
          placeholder: isStruct ? structPlaceholder : `Enter ${label.toLowerCase()}...`,
          'data-field': field
        });
      } else {
        inputEl = h('input', {
          class: 'form-input',
          id: `exit-field-${field}`,
          type: 'text',
          placeholder: `Enter ${label.toLowerCase()}...`,
          'data-field': field
        });
      }

      // Update field value on input
      inputEl.addEventListener('input', (e) => {
        this._fieldValues[field] = e.target.value;
        this._updateProgress(progressFill, exitReq.fields);
      });

      fieldGroup.appendChild(inputEl);
      fieldsContainer.appendChild(fieldGroup);
    }

    container.appendChild(fieldsContainer);

    // Action buttons
    const actions = h('div', { class: 'exit-doc-actions' });

    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => {
      Modal.close('exit-doc-form');
    });

    const submitBtn = h('button', {
      class: 'btn btn-primary btn-md',
      id: 'exit-doc-submit-btn'
    }, 'Submit Exit Document');
    submitBtn.addEventListener('click', () => this._handleSubmit());

    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    container.appendChild(actions);

    return container;
  }

  _updateProgress(progressFill, fields) {
    const filled = fields.filter(f => (this._fieldValues[f] || '').trim().length > 0).length;
    const pct = Math.round((filled / fields.length) * 100);
    progressFill.style.width = `${pct}%`;
    progressFill.textContent = pct > 0 ? `${pct}%` : '';
  }

  async _handleSubmit() {
    if (this._submitting) return;

    const exitReq = this._roomData?.exitRequired;
    if (!exitReq) return;

    // Validate all fields are filled
    const missing = exitReq.fields.filter(f => !(this._fieldValues[f] || '').trim());
    if (missing.length > 0) {
      Toast.warning(`Please fill in all required fields. Missing: ${missing.map(humanize).join(', ')}`);
      // Highlight missing fields
      for (const field of missing) {
        const el = document.getElementById(`exit-field-${field}`);
        if (el) {
          el.classList.add('field-error');
          el.addEventListener('input', function handler() {
            el.classList.remove('field-error');
            el.removeEventListener('input', handler);
          });
        }
      }
      return;
    }

    this._submitting = true;
    const submitBtn = document.getElementById('exit-doc-submit-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
    }

    // Build the exit doc payload — parse structured/numeric fields appropriately
    const exitDoc = {};
    for (const field of exitReq.fields) {
      const raw = (this._fieldValues[field] || '').trim();
      if (isNumericField(field)) {
        // Parse as number — backend validates typeof === 'number'
        const num = Number(raw);
        exitDoc[field] = isNaN(num) ? 0 : num;
      } else if (isStructuredField(field)) {
        try {
          exitDoc[field] = JSON.parse(raw);
        } catch {
          // Try splitting by newlines for list-like fields
          if (raw.includes('\n')) {
            exitDoc[field] = raw.split('\n').map(l => l.trim()).filter(Boolean);
          } else {
            // Wrap single plain-text values in an array so server
            // validation doesn't reject them for non-array type
            exitDoc[field] = [raw];
          }
        }
      } else {
        exitDoc[field] = raw;
      }
    }

    try {
      if (!window.overlordSocket) {
        throw new Error('Socket not connected');
      }

      const result = await window.overlordSocket.submitExitDoc({
        roomId: this._roomId,
        agentId: this._agentId,
        buildingId: this._buildingId,
        phase: this._phase,
        document: exitDoc,
      });

      if (result && result.ok) {
        Toast.success(`Exit document submitted for ${humanize(exitReq.type)}`);
        Modal.close('exit-doc-form');

        // Notify other components
        OverlordUI.dispatch('exit-doc:submitted', {
          roomId: this._roomId,
          type: exitReq.type,
          document: exitDoc,
        });
      } else {
        throw new Error(result?.error?.message || 'Failed to submit exit document');
      }
    } catch (err) {
      console.error('[ExitDocForm] Submit failed:', err);
      Toast.error(`Submit failed: ${err.message}`);

      this._submitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Exit Document';
      }
    }
  }
}
