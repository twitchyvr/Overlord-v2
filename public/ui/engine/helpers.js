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

/** Set trusted HTML content with sanitization */
export function setTrustedContent(el, htmlString) {
  if (typeof el.setHTML === 'function') {
    el.setHTML(htmlString);
  } else {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
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
  const d = date instanceof Date ? date : new Date(date);
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

/** Scoped querySelector */
export function $(selector, scope = document) {
  return scope.querySelector(selector);
}

/** Scoped querySelectorAll (returns real Array) */
export function $$(selector, scope = document) {
  return [...scope.querySelectorAll(selector)];
}
