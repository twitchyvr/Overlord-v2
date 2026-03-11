// @vitest-environment jsdom
/**
 * Tests for public/ui/components/search-input.js
 *
 * Covers: SearchInput construction, mount rendering, getQuery/setQuery,
 *         clear, filter chips, toggleFilter, getActiveFilters,
 *         initial active filters, and onChange callback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const searchInputPath = '../../../public/ui/components/search-input.js';

let SearchInput: any;

beforeEach(async () => {
  document.body.textContent = '';

  const mod = await import(searchInputPath);
  SearchInput = mod.SearchInput;
});

// ─── Constructor ─────────────────────────────────────────────

describe('SearchInput — constructor', () => {
  it('initializes with default opts', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el);

    expect(si.el).toBe(el);
    expect(si.opts.placeholder).toBe('Search...');
    expect(si.opts.filters).toEqual([]);
    expect(si.opts.onSearch).toBeNull();
    expect(si.opts.onChange).toBeNull();
    expect(si.opts.debounceMs).toBe(200);
    expect(si.opts.className).toBe('');
  });

  it('merges custom opts with defaults', () => {
    const el = document.createElement('div');
    const onChange = vi.fn();
    const si = new SearchInput(el, {
      placeholder: 'Find...',
      debounceMs: 500,
      onChange,
    });

    expect(si.opts.placeholder).toBe('Find...');
    expect(si.opts.debounceMs).toBe(500);
    expect(si.opts.onChange).toBe(onChange);
    // Defaults still apply
    expect(si.opts.filters).toEqual([]);
    expect(si.opts.onSearch).toBeNull();
  });

  it('initializes _query to empty string', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el);

    expect(si._query).toBe('');
  });

  it('initializes _inputEl to null before mount', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el);

    expect(si._inputEl).toBeNull();
  });

  it('initializes _activeFilters from filters with active:true', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [
        { id: 'risk', label: 'Risk', active: true },
        { id: 'issue', label: 'Issue' },
        { id: 'dep', label: 'Dependency', active: true },
      ],
    });

    expect(si._activeFilters.has('risk')).toBe(true);
    expect(si._activeFilters.has('dep')).toBe(true);
    expect(si._activeFilters.has('issue')).toBe(false);
  });
});

// ─── mount() ─────────────────────────────────────────────────

describe('SearchInput — mount()', () => {
  it('sets _mounted to true', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el);

    expect(si._mounted).toBe(false);
    si.mount();
    expect(si._mounted).toBe(true);
  });

  it('renders search UI structure', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const si = new SearchInput(el);
    si.mount();

    // Container class
    expect(el.className).toContain('search-input-container');

    // Search row with icon, input, and clear button
    const searchRow = el.querySelector('.search-input-row');
    expect(searchRow).not.toBeNull();

    const icon = el.querySelector('.search-input-icon');
    expect(icon).not.toBeNull();

    const input = el.querySelector('.search-input');
    expect(input).not.toBeNull();
    expect(input!.getAttribute('type')).toBe('text');

    const clearBtn = el.querySelector('.search-input-clear');
    expect(clearBtn).not.toBeNull();
  });

  it('sets placeholder on the input', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, { placeholder: 'Type to filter...' });
    si.mount();

    const input = el.querySelector('.search-input') as HTMLInputElement;
    expect(input.placeholder).toBe('Type to filter...');
  });

  it('sets aria-label on the input', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, { placeholder: 'Search agents' });
    si.mount();

    const input = el.querySelector('.search-input') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('Search agents');
  });

  it('applies custom className', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, { className: 'raid-search' });
    si.mount();

    expect(el.className).toContain('search-input-container');
    expect(el.className).toContain('raid-search');
  });
});

// ─── getQuery() ──────────────────────────────────────────────

describe('SearchInput — getQuery()', () => {
  it('returns empty string initially', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el);
    si.mount();

    expect(si.getQuery()).toBe('');
  });

  it('returns the current query after setQuery()', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el);
    si.mount();

    si.setQuery('hello');
    expect(si.getQuery()).toBe('hello');
  });
});

// ─── setQuery() ──────────────────────────────────────────────

describe('SearchInput — setQuery()', () => {
  it('updates internal _query', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el);
    si.mount();

    si.setQuery('test query');
    expect(si._query).toBe('test query');
  });

  it('updates the input element value', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el);
    si.mount();

    si.setQuery('foobar');
    const input = el.querySelector('.search-input') as HTMLInputElement;
    expect(input.value).toBe('foobar');
  });

  it('works before mount (input not yet created)', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el);

    // Should not throw
    expect(() => si.setQuery('pre-mount')).not.toThrow();
    expect(si._query).toBe('pre-mount');
  });
});

// ─── clear() ─────────────────────────────────────────────────

describe('SearchInput — clear()', () => {
  it('resets query to empty string', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el);
    si.mount();

    si.setQuery('something');
    si.clear();
    expect(si.getQuery()).toBe('');
  });

  it('clears all active filters', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [
        { id: 'a', label: 'A', active: true },
        { id: 'b', label: 'B', active: true },
      ],
    });
    si.mount();

    expect(si.getActiveFilters().length).toBe(2);
    si.clear();
    expect(si.getActiveFilters().length).toBe(0);
  });

  it('fires onChange callback', () => {
    const onChange = vi.fn();
    const el = document.createElement('div');
    const si = new SearchInput(el, { onChange });
    si.mount();

    si.setQuery('x');
    si.clear();
    expect(onChange).toHaveBeenCalled();
    // Last call should have empty query and empty filters
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(lastCall[0]).toBe('');
    expect(lastCall[1]).toEqual([]);
  });

  it('re-renders the component (input value reset)', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el);
    si.mount();

    si.setQuery('something');
    si.clear();

    const input = el.querySelector('.search-input') as HTMLInputElement;
    expect(input.value).toBe('');
  });
});

// ─── Filter chips rendering ──────────────────────────────────

describe('SearchInput — filter chips', () => {
  it('renders filter chips when filters are provided', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [
        { id: 'risk', label: 'Risk' },
        { id: 'issue', label: 'Issue' },
        { id: 'dep', label: 'Dependency' },
      ],
    });
    si.mount();

    const chips = el.querySelectorAll('.filter-chip');
    expect(chips.length).toBe(3);
  });

  it('does not render chip container when no filters', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el);
    si.mount();

    const chipContainer = el.querySelector('.search-filter-chips');
    expect(chipContainer).toBeNull();
  });

  it('renders chip labels correctly', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [
        { id: 'risk', label: 'Risk' },
        { id: 'issue', label: 'Issue' },
      ],
    });
    si.mount();

    const chips = el.querySelectorAll('.filter-chip');
    expect(chips[0].textContent).toBe('Risk');
    expect(chips[1].textContent).toBe('Issue');
  });

  it('sets data-filter-id on chips', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [{ id: 'risk', label: 'Risk' }],
    });
    si.mount();

    const chip = el.querySelector('.filter-chip') as HTMLElement;
    expect(chip.dataset.filterId).toBe('risk');
  });

  it('marks initially active filters with "active" class', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [
        { id: 'risk', label: 'Risk', active: true },
        { id: 'issue', label: 'Issue' },
      ],
    });
    si.mount();

    const chips = el.querySelectorAll('.filter-chip');
    expect(chips[0].classList.contains('active')).toBe(true);
    expect(chips[1].classList.contains('active')).toBe(false);
  });

  it('sets aria-pressed on chips', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [
        { id: 'risk', label: 'Risk', active: true },
        { id: 'issue', label: 'Issue' },
      ],
    });
    si.mount();

    const chips = el.querySelectorAll('.filter-chip');
    expect(chips[0].getAttribute('aria-pressed')).toBe('true');
    expect(chips[1].getAttribute('aria-pressed')).toBe('false');
  });
});

// ─── toggleFilter() ──────────────────────────────────────────

describe('SearchInput — toggleFilter()', () => {
  it('activates an inactive filter', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [{ id: 'risk', label: 'Risk' }],
    });
    si.mount();

    expect(si._activeFilters.has('risk')).toBe(false);
    si.toggleFilter('risk');
    expect(si._activeFilters.has('risk')).toBe(true);
  });

  it('deactivates an active filter', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [{ id: 'risk', label: 'Risk', active: true }],
    });
    si.mount();

    expect(si._activeFilters.has('risk')).toBe(true);
    si.toggleFilter('risk');
    expect(si._activeFilters.has('risk')).toBe(false);
  });

  it('updates chip CSS class after toggle', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [{ id: 'risk', label: 'Risk' }],
    });
    si.mount();

    const chip = el.querySelector('.filter-chip') as HTMLElement;
    expect(chip.classList.contains('active')).toBe(false);

    si.toggleFilter('risk');
    expect(chip.classList.contains('active')).toBe(true);

    si.toggleFilter('risk');
    expect(chip.classList.contains('active')).toBe(false);
  });

  it('updates aria-pressed after toggle', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [{ id: 'risk', label: 'Risk' }],
    });
    si.mount();

    const chip = el.querySelector('.filter-chip') as HTMLElement;
    expect(chip.getAttribute('aria-pressed')).toBe('false');

    si.toggleFilter('risk');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });

  it('fires onChange callback', () => {
    const onChange = vi.fn();
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [{ id: 'risk', label: 'Risk' }],
      onChange,
    });
    si.mount();

    si.toggleFilter('risk');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('', ['risk']);
  });
});

// ─── getActiveFilters() ──────────────────────────────────────

describe('SearchInput — getActiveFilters()', () => {
  it('returns empty array when no filters active', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [
        { id: 'risk', label: 'Risk' },
        { id: 'issue', label: 'Issue' },
      ],
    });
    si.mount();

    expect(si.getActiveFilters()).toEqual([]);
  });

  it('returns array of active filter IDs', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [
        { id: 'risk', label: 'Risk', active: true },
        { id: 'issue', label: 'Issue' },
        { id: 'dep', label: 'Dependency', active: true },
      ],
    });
    si.mount();

    const active = si.getActiveFilters();
    expect(active).toContain('risk');
    expect(active).toContain('dep');
    expect(active).not.toContain('issue');
    expect(active.length).toBe(2);
  });

  it('reflects changes after toggleFilter', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [
        { id: 'risk', label: 'Risk' },
        { id: 'issue', label: 'Issue' },
      ],
    });
    si.mount();

    si.toggleFilter('issue');
    expect(si.getActiveFilters()).toEqual(['issue']);

    si.toggleFilter('risk');
    const active = si.getActiveFilters();
    expect(active).toContain('issue');
    expect(active).toContain('risk');
  });
});

// ─── Active filters from initial config ──────────────────────

describe('SearchInput — initial active filters', () => {
  it('pre-populates _activeFilters from opts.filters[].active', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [
        { id: 'a', label: 'A', active: true },
        { id: 'b', label: 'B', active: false },
        { id: 'c', label: 'C', active: true },
        { id: 'd', label: 'D' },
      ],
    });

    expect(si.getActiveFilters().sort()).toEqual(['a', 'c']);
  });

  it('handles no initially active filters', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    });

    expect(si.getActiveFilters()).toEqual([]);
  });

  it('handles all filters initially active', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [
        { id: 'a', label: 'A', active: true },
        { id: 'b', label: 'B', active: true },
      ],
    });

    expect(si.getActiveFilters().length).toBe(2);
  });
});

// ─── onChange callback ───────────────────────────────────────

describe('SearchInput — onChange callback', () => {
  it('fires onChange on clear()', () => {
    const onChange = vi.fn();
    const el = document.createElement('div');
    const si = new SearchInput(el, { onChange });
    si.mount();

    si.clear();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('', []);
  });

  it('fires onChange on toggleFilter()', () => {
    const onChange = vi.fn();
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [{ id: 'risk', label: 'Risk' }],
      onChange,
    });
    si.mount();

    si.toggleFilter('risk');
    expect(onChange).toHaveBeenCalledTimes(1);

    si.toggleFilter('risk');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('does not fire if onChange is not provided', () => {
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      filters: [{ id: 'risk', label: 'Risk' }],
    });
    si.mount();

    // Should not throw when onChange is null
    expect(() => si.toggleFilter('risk')).not.toThrow();
    expect(() => si.clear()).not.toThrow();
  });

  it('fires onChange via debounced input event', async () => {
    vi.useFakeTimers();

    const onChange = vi.fn();
    const el = document.createElement('div');
    const si = new SearchInput(el, {
      onChange,
      debounceMs: 100,
    });
    si.mount();

    const input = el.querySelector('.search-input') as HTMLInputElement;
    input.value = 'hello';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Not called yet (debounced)
    expect(onChange).not.toHaveBeenCalled();

    // Advance past debounce delay
    vi.advanceTimersByTime(150);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('hello', []);

    vi.useRealTimers();
  });
});
