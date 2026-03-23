/**
 * Overlord v2 — DOM & Utility Helpers
 */

/** Hyperscript — create DOM elements declaratively */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, val] of Object.entries(attrs)) {
      if (key.startsWith('on') && typeof val === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), val);
      } else if (key === 'style' && typeof val === 'object') {
        Object.assign(el.style, val);
      } else if (key === 'className' || key === 'class') {
        el.className = val;
      } else if (key === 'dataset' && typeof val === 'object') {
        Object.assign(el.dataset, val);
      } else if (val === true) {
        el.setAttribute(key, '');
      } else if (val !== false && val != null) {
        el.setAttribute(key, val);
      }
    }
  }
  const append = (child) => {
    if (child == null || child === false) return;
    if (Array.isArray(child)) { child.forEach(append); return; }
    if (child instanceof Node) { el.appendChild(child); return; }
    el.appendChild(document.createTextNode(String(child)));
  };
  children.forEach(append);
  return el;
}

/** Set content safely (textContent for strings, appendChild for nodes) */
export function setContent(el, content) {
  el.textContent = '';
  if (content == null) return;
  if (content instanceof Node) {
    el.appendChild(content);
  } else if (Array.isArray(content)) {
    const frag = document.createDocumentFragment();
    content.forEach(c => {
      if (c instanceof Node) frag.appendChild(c);
      else frag.appendChild(document.createTextNode(String(c)));
    });
    el.appendChild(frag);
  } else {
    el.textContent = String(content);
  }
}

/** Set trusted HTML content with sanitization (#code-scanning) */
export function setTrustedContent(el, htmlString) {
  if (typeof el.setHTML === 'function') {
    // Sanitizer API — safe by design
    el.setHTML(htmlString);
  } else {
    // Fallback: parse then strip dangerous elements before inserting
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    // Remove script, style, iframe, object, embed, form elements
    for (const tag of ['script', 'style', 'iframe', 'object', 'embed', 'form', 'link']) {
      doc.querySelectorAll(tag).forEach(n => n.remove());
    }
    // Remove event handler attributes (onclick, onerror, etc.)
    doc.querySelectorAll('*').forEach(n => {
      for (const attr of [...n.attributes]) {
        if (attr.name.startsWith('on') || attr.value.startsWith('javascript:')) {
          n.removeAttribute(attr.name);
        }
      }
    });
    el.textContent = '';
    while (doc.body.firstChild) {
      el.appendChild(document.adoptNode(doc.body.firstChild));
    }
  }
}

/** Debounce a function */
export function debounce(fn, delay = 150) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Throttle a function (trailing edge) */
export function throttle(fn, limit = 100) {
  let waiting = false;
  let lastArgs = null;
  return (...args) => {
    if (!waiting) {
      fn(...args);
      waiting = true;
      setTimeout(() => {
        waiting = false;
        if (lastArgs) { fn(...lastArgs); lastArgs = null; }
      }, limit);
    } else {
      lastArgs = args;
    }
  };
}

/** Escape HTML to prevent XSS */
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** Generate a short unique id */
export function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 9);
}

/**
 * Format a timestamp with relative context.
 *   Same day, < 1 min:   "Just now"
 *   Same day, < 1 hour:  "12m ago"
 *   Same day, older:     "3h ago"
 *   Yesterday:           "Yesterday, 2:30 PM"
 *   This year:           "Mar 10, 2:30 PM"
 *   Older:               "Mar 10, 2025"
 */
export function formatTime(date) {
  if (!date) return '';
  // Normalize SQLite datetime format (no timezone) to UTC (#707)
  let input = date;
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(input) && !input.includes('T') && !input.includes('Z')) {
    input = input.replace(' ', 'T') + 'Z';
  }
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return '';

  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();

  if (isToday) {
    const diffMin = Math.floor((now - d) / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    return `${Math.floor(diffMin / 60)}h ago`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (d.toDateString() === yesterday.toDateString()) {
    return `Yesterday, ${timeStr}`;
  }

  const month = d.toLocaleString('default', { month: 'short' });
  const day = d.getDate();

  if (d.getFullYear() === now.getFullYear()) {
    return `${month} ${day}, ${timeStr}`;
  }
  return `${month} ${day}, ${d.getFullYear()}`;
}

/** Clamp a number between min and max */
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Glossary of plain-English explanations for technical jargon.
 * Used by `tip()` to add hover tooltips that help non-technical users.
 */
const GLOSSARY = {
  'File Scope':            'Controls which project files agents in this room can access',
  'Exit Document':         'A summary report agents must complete before leaving this room',
  'Cross-Room Citations':  'References linking work done in one room to related work in another',
  'AI Provider':           'Which AI service powers the agents in this room',
  'Foundation':            'The base infrastructure that supports all floors and rooms',
  'RAID Log':              'A project journal tracking Risks, Assumptions, Issues, and Decisions',
  'RAID':                  'Risks, Assumptions, Issues, and Decisions — a project tracking method',
  'Phase Gate':            'A checkpoint where work must be reviewed before moving to the next phase',
  'Strategist':            'Planning room where project goals, phases, and resources are defined',
  'Building Architect':    'Design room that creates the blueprint for your project structure',
  'Discovery':             'Research room where requirements are gathered and analyzed',
  'Architecture':          'Design room for system structure and technical decisions',
  'Code Lab':              'Development room where agents write and modify code',
  'Testing Lab':           'Quality room where agents run tests and verify correctness',
  'Review':                'Governance room for code review and quality standards',
  'Deploy':                'Operations room for releasing and deploying your project',
  'War Room':              'Emergency room activated when critical issues need immediate attention',
  'Data Exchange':         'Transfer room for sharing files and data between other rooms',
  'Plugin Bay':            'Extension room for managing add-ons, scripts, and custom tools',
  'Provider Hub':          'Configuration room for AI service settings',
};

/**
 * Create a label with a tooltip hint for non-technical users.
 * Looks up the term in the GLOSSARY; if found, wraps it with a dotted underline
 * and a hover tooltip. If not found, returns plain text.
 *
 * @param {string} term - The jargon term to explain
 * @param {string} [override] - Custom tooltip text (skips glossary lookup)
 * @returns {HTMLElement}
 */
export function tip(term, override) {
  const explanation = override || GLOSSARY[term];
  if (!explanation) return document.createTextNode(term);

  return h('span', {
    class: 'has-tooltip',
    dataset: { tooltip: explanation },
  }, term);
}

/**
 * Convert @agentName mentions to clickable spans and #123 to issue-style links.
 * Returns a DocumentFragment with mixed text nodes and clickable spans.
 *
 * @param {string} text — raw message text
 * @returns {DocumentFragment}
 */
export function linkEntities(text) {
  const frag = document.createDocumentFragment();
  if (!text) return frag;

  // Match @word (agent mention) or #digits (issue/task ref)
  const pattern = /(@[\w.-]+|#\d+)/g;
  let lastIdx = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    // Append preceding plain text
    if (match.index > lastIdx) {
      frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
    }

    const token = match[0];
    if (token.startsWith('@')) {
      const agentName = token.slice(1);
      const span = h('span', {
        class: 'entity-link entity-link-agent',
        dataset: { agentName },
        tabindex: '0',
        role: 'button',
        title: `View agent: ${agentName}`
      }, token);
      span.addEventListener('click', () => {
        // Attempt to find the agent in the store and navigate
        const store = window.overlordUI?.getStore?.() || null;
        const agents = store?.get?.('agents.list') || [];
        const agent = agents.find(a =>
          (a.name || '').toLowerCase() === agentName.toLowerCase() ||
          (a.display_name || '').toLowerCase() === agentName.toLowerCase()
        );
        if (agent) {
          const OUI = window.OverlordUI;
          if (typeof OUI?.dispatch === 'function') {
            OUI.dispatch('navigate:entity', { type: 'agent', id: agent.id });
          }
        }
      });
      frag.appendChild(span);
    } else {
      // #123 — task/issue reference
      const refNum = token.slice(1);
      const span = h('span', {
        class: 'entity-link entity-link-ref',
        dataset: { refNumber: refNum },
        tabindex: '0',
        role: 'button',
        title: `Task/Issue #${refNum}`
      }, token);
      span.addEventListener('click', () => {
        const OUI = window.OverlordUI;
        if (typeof OUI?.dispatch === 'function') {
          OUI.dispatch('navigate:entity', { type: 'task', id: refNum });
        }
      });
      frag.appendChild(span);
    }

    lastIdx = pattern.lastIndex;
  }

  // Append trailing plain text
  if (lastIdx < text.length) {
    frag.appendChild(document.createTextNode(text.slice(lastIdx)));
  }

  return frag;
}

/** Scoped querySelector */
export function $(selector, scope = document) {
  return scope.querySelector(selector);
}

/** Scoped querySelectorAll (returns real Array) */
export function $$(selector, scope = document) {
  return [...scope.querySelectorAll(selector)];
}
