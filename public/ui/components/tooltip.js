/**
 * Overlord v2 — Tooltip Component
 * Accessible tooltips + jargon glossary for non-technical users.
 */
import { h } from '../engine/helpers.js';

const GLOSSARY = {
  'phase gate': 'A checkpoint between project stages — work must be reviewed before moving forward',
  'exit document': 'A summary of what was accomplished in a room — like a report card',
  'raid log': 'A record of Risks, Assumptions, Issues, and Decisions made during the project',
  'room': 'A workspace where agents do specific types of work (coding, testing, reviewing)',
  'agent': 'An AI worker that performs tasks in rooms — think of them as team members',
  'building': 'Your project — it contains floors and rooms where work happens',
  'floor': 'A section of your project grouped by purpose (planning, building, reviewing)',
  'tool': 'A capability an agent can use, like reading files or running commands',
  'escalation': 'When a problem needs to be sent to a different room or team for help',
  'deployment': 'Making your finished project available for people to use',
  'repository': 'Where your project files are stored and version-tracked',
  'milestone': 'A major goal or deadline in your project timeline',
  'pipeline': 'An automated series of steps that check and deliver your project',
  'sandbox': 'A safe, isolated environment where code runs without affecting anything else',
  'plugin': 'An add-on script that extends what Overlord can do',
  'hook': 'A trigger point where plugins can add custom behavior',
  'lint': 'An automated check that finds style and quality issues in code',
  'scope': 'The boundaries of what a project or task includes',
  'artifact': 'A file produced by building your project (like an app installer)',
  'schema': 'A blueprint that defines the structure of data',
  'api': 'A way for programs to talk to each other',
};

let tooltipEl = null;

function ensureTooltipEl() {
  if (tooltipEl) return tooltipEl;
  tooltipEl = h('div', { class: 'tooltip-popup', role: 'tooltip', 'aria-hidden': 'true' });
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

export const Tooltip = {
  show(target, text) {
    const el = ensureTooltipEl();
    el.textContent = text;
    el.setAttribute('aria-hidden', 'false');
    el.classList.add('visible');
    const rect = target.getBoundingClientRect();
    el.style.left = `${rect.left + rect.width / 2}px`;
    el.style.top = `${rect.top - 8}px`;
  },
  hide() {
    if (!tooltipEl) return;
    tooltipEl.classList.remove('visible');
    tooltipEl.setAttribute('aria-hidden', 'true');
  },
};

export function attachTooltips(container) {
  container.querySelectorAll('[data-tooltip]').forEach((el) => {
    el.addEventListener('mouseenter', () => Tooltip.show(el, el.dataset.tooltip));
    el.addEventListener('mouseleave', () => Tooltip.hide());
    el.addEventListener('focus', () => Tooltip.show(el, el.dataset.tooltip));
    el.addEventListener('blur', () => Tooltip.hide());
    if (!el.getAttribute('tabindex')) el.setAttribute('tabindex', '0');
  });
}

export function annotateJargon(text) {
  let result = text;
  for (const [term, explanation] of Object.entries(GLOSSARY)) {
    const regex = new RegExp(`\\b(${term})\\b`, 'gi');
    result = result.replace(regex, `<span class="jargon-term" data-tooltip="${explanation}" tabindex="0">$1</span>`);
  }
  return result;
}

export function getGlossary() {
  return { ...GLOSSARY };
}
