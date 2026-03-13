// @vitest-environment jsdom
/**
 * Tests for public/ui/components/token-input.js
 *
 * Covers: TokenInput construction, mount(), getText(), setText(), getTokens(),
 *         focus(), clear(), setSuggestions(), token triggers (/, @, #),
 *         autocomplete keyboard navigation (ArrowUp/Down, Enter, Escape, Tab),
 *         mouse selection, submit behavior (Enter vs Shift+Enter),
 *         input history (Ctrl+Up/Down), chip rendering and removal.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const tokenInputPath = '../../../public/ui/components/token-input.js';

let TokenInput: any;

beforeEach(async () => {
  document.body.textContent = '';
  const mod = await import(tokenInputPath);
  TokenInput = mod.TokenInput;
});

// ── Helpers ──────────────────────────────────────────────────

/** Create a mounted TokenInput with sensible defaults. */
function create(opts: Record<string, any> = {}): any {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ti = new TokenInput(el, opts);
  ti.mount();
  return ti;
}

/** Fire a KeyboardEvent on the textarea. */
function keydown(ti: any, key: string, extra: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...extra });
  ti._textareaEl.dispatchEvent(event);
}

/** Simulate typing text into the textarea (sets value + fires input event). */
function type(ti: any, text: string) {
  ti._textareaEl.value = text;
  ti._textareaEl.selectionStart = text.length;
  ti._textareaEl.selectionEnd = text.length;
  ti._textareaEl.dispatchEvent(new Event('input', { bubbles: true }));
}

// ─── Constructor ─────────────────────────────────────────────

describe('TokenInput — constructor', () => {
  it('stores opts with defaults merged', () => {
    const el = document.createElement('div');
    const onSubmit = vi.fn();
    const ti = new TokenInput(el, { onSubmit, maxRows: 10 });

    expect(ti.el).toBe(el);
    expect(ti.opts.onSubmit).toBe(onSubmit);
    expect(ti.opts.maxRows).toBe(10);
    // Defaults
    expect(ti.opts.placeholder).toBe('Type a message...');
    expect(ti.opts.onTokenTrigger).toBeNull();
  });

  it('initializes internal state', () => {
    const el = document.createElement('div');
    const ti = new TokenInput(el);

    expect(ti._textareaEl).toBeNull();
    expect(ti._autocompleteEl).toBeNull();
    expect(ti._tokens).toEqual([]);
    expect(ti._suggestions).toEqual([]);
    expect(ti._selectedIdx).toBe(-1);
    expect(ti._tokenTrigger).toBeNull();
    expect(ti._history).toEqual([]);
    expect(ti._historyIdx).toBe(-1);
    expect(ti._currentDraft).toBe('');
  });

  it('sets up trigger character map', () => {
    const el = document.createElement('div');
    const ti = new TokenInput(el);

    expect(ti._triggerChars).toEqual({
      '/': 'command',
      '@': 'agent',
      '#': 'reference',
    });
  });
});

// ─── mount() ─────────────────────────────────────────────────

describe('TokenInput — mount()', () => {
  it('sets _mounted to true', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const ti = new TokenInput(el);

    expect(ti._mounted).toBe(false);
    ti.mount();
    expect(ti._mounted).toBe(true);
  });

  it('creates textarea inside the container', () => {
    const ti = create();
    const textarea = ti.el.querySelector('textarea.token-input');
    expect(textarea).not.toBeNull();
    expect(ti._textareaEl).toBe(textarea);
  });

  it('creates autocomplete dropdown (hidden)', () => {
    const ti = create();
    expect(ti._autocompleteEl).not.toBeNull();
    expect(ti._autocompleteEl.style.display).toBe('none');
  });

  it('creates send button', () => {
    const ti = create();
    const btn = ti.el.querySelector('.token-input-send');
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-label')).toBe('Send message');
  });

  it('creates chip area', () => {
    const ti = create();
    const chipArea = ti.el.querySelector('.token-chips');
    expect(chipArea).not.toBeNull();
  });

  it('applies custom placeholder to textarea', () => {
    const ti = create({ placeholder: 'Ask me anything...' });
    expect(ti._textareaEl.placeholder).toBe('Ask me anything...');
  });

  it('sets aria-label matching placeholder', () => {
    const ti = create({ placeholder: 'Custom placeholder' });
    expect(ti._textareaEl.getAttribute('aria-label')).toBe('Custom placeholder');
  });
});

// ─── getText() / setText() ───────────────────────────────────

describe('TokenInput — getText() / setText()', () => {
  it('returns empty string initially', () => {
    const ti = create();
    expect(ti.getText()).toBe('');
  });

  it('returns current textarea value', () => {
    const ti = create();
    ti._textareaEl.value = 'hello world';
    expect(ti.getText()).toBe('hello world');
  });

  it('sets textarea value via setText()', () => {
    const ti = create();
    ti.setText('new content');
    expect(ti._textareaEl.value).toBe('new content');
  });

  it('getText() returns empty when not mounted', () => {
    const el = document.createElement('div');
    const ti = new TokenInput(el);
    expect(ti.getText()).toBe('');
  });
});

// ─── getTokens() ─────────────────────────────────────────────

describe('TokenInput — getTokens()', () => {
  it('returns empty array initially', () => {
    const ti = create();
    expect(ti.getTokens()).toEqual([]);
  });

  it('returns a copy of the tokens array', () => {
    const ti = create();
    ti._tokens = [{ type: 'command', id: 'help', label: 'help', char: '/' }];
    const tokens = ti.getTokens();

    expect(tokens).toEqual(ti._tokens);
    expect(tokens).not.toBe(ti._tokens); // different reference
  });
});

// ─── focus() ─────────────────────────────────────────────────

describe('TokenInput — focus()', () => {
  it('calls focus on the textarea', () => {
    const ti = create();
    const spy = vi.spyOn(ti._textareaEl, 'focus');
    ti.focus();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ─── clear() ─────────────────────────────────────────────────

describe('TokenInput — clear()', () => {
  it('resets textarea value to empty', () => {
    const ti = create();
    ti.setText('some text');
    ti.clear();
    expect(ti.getText()).toBe('');
  });

  it('resets tokens to empty', () => {
    const ti = create();
    ti._tokens = [{ type: 'agent', id: 'a1', label: 'strategist', char: '@' }];
    ti.clear();
    expect(ti.getTokens()).toEqual([]);
  });

  it('closes autocomplete dropdown', () => {
    const ti = create();
    ti._suggestions = [{ id: '1', label: 'test' }];
    ti._autocompleteEl.style.display = '';
    ti.clear();
    expect(ti._autocompleteEl.style.display).toBe('none');
    expect(ti._suggestions).toEqual([]);
  });
});

// ─── setSuggestions() ────────────────────────────────────────

describe('TokenInput — setSuggestions()', () => {
  it('stores suggestions and selects first item', () => {
    const ti = create();
    const suggestions = [
      { id: 'a', label: 'alpha' },
      { id: 'b', label: 'beta' },
    ];
    ti.setSuggestions(suggestions);

    expect(ti._suggestions).toBe(suggestions);
    expect(ti._selectedIdx).toBe(0);
  });

  it('renders autocomplete items in the dropdown', () => {
    const ti = create();
    ti.setSuggestions([
      { id: 'a', label: 'alpha', description: 'First letter' },
      { id: 'b', label: 'beta' },
    ]);

    const items = ti._autocompleteEl.querySelectorAll('.token-autocomplete-item');
    expect(items.length).toBe(2);
    expect(ti._autocompleteEl.style.display).not.toBe('none');
  });

  it('renders icon when provided', () => {
    const ti = create();
    ti.setSuggestions([{ id: 'a', label: 'alpha', icon: '\u2699' }]);

    const icon = ti._autocompleteEl.querySelector('.token-ac-icon');
    expect(icon).not.toBeNull();
    expect(icon.textContent).toBe('\u2699');
  });

  it('renders description when provided', () => {
    const ti = create();
    ti.setSuggestions([{ id: 'a', label: 'alpha', description: 'First' }]);

    const desc = ti._autocompleteEl.querySelector('.token-ac-desc');
    expect(desc).not.toBeNull();
    expect(desc.textContent).toBe('First');
  });

  it('closes autocomplete when given empty array', () => {
    const ti = create();
    ti.setSuggestions([{ id: 'a', label: 'alpha' }]);
    expect(ti._autocompleteEl.style.display).not.toBe('none');

    ti.setSuggestions([]);
    expect(ti._autocompleteEl.style.display).toBe('none');
    expect(ti._selectedIdx).toBe(-1);
  });

  it('handles null suggestions gracefully', () => {
    const ti = create();
    ti.setSuggestions(null);
    expect(ti._suggestions).toEqual([]);
    expect(ti._selectedIdx).toBe(-1);
  });
});

// ─── Token triggers ──────────────────────────────────────────

describe('TokenInput — token triggers', () => {
  it('detects / trigger at start of input', () => {
    const onTokenTrigger = vi.fn();
    const ti = create({ onTokenTrigger });

    type(ti, '/hel');

    expect(onTokenTrigger).toHaveBeenCalledWith('command', 'hel');
  });

  it('detects @ trigger at start of input', () => {
    const onTokenTrigger = vi.fn();
    const ti = create({ onTokenTrigger });

    type(ti, '@str');

    expect(onTokenTrigger).toHaveBeenCalledWith('agent', 'str');
  });

  it('detects # trigger at start of input', () => {
    const onTokenTrigger = vi.fn();
    const ti = create({ onTokenTrigger });

    type(ti, '#dis');

    expect(onTokenTrigger).toHaveBeenCalledWith('reference', 'dis');
  });

  it('detects trigger after a space', () => {
    const onTokenTrigger = vi.fn();
    const ti = create({ onTokenTrigger });

    type(ti, 'hello @arch');

    expect(onTokenTrigger).toHaveBeenCalledWith('agent', 'arch');
  });

  it('does not detect trigger in the middle of a word', () => {
    const onTokenTrigger = vi.fn();
    const ti = create({ onTokenTrigger });

    type(ti, 'email@test');

    expect(onTokenTrigger).not.toHaveBeenCalled();
  });

  it('clears trigger and closes autocomplete when no trigger found', () => {
    const ti = create();
    type(ti, '/help');
    ti.setSuggestions([{ id: '1', label: 'help' }]);

    // Now type something without a trigger
    type(ti, 'no trigger here');

    expect(ti._tokenTrigger).toBeNull();
    expect(ti._autocompleteEl.style.display).toBe('none');
  });
});

// ─── Autocomplete keyboard navigation ───────────────────────

describe('TokenInput — autocomplete keyboard navigation', () => {
  function setupWithSuggestions() {
    const ti = create();
    // Simulate an active trigger
    type(ti, '@');
    ti._tokenTrigger = { type: 'agent', char: '@', startPos: 0, query: '' };
    ti.setSuggestions([
      { id: 'a', label: 'alpha' },
      { id: 'b', label: 'beta' },
      { id: 'c', label: 'gamma' },
    ]);
    return ti;
  }

  it('ArrowDown moves selection down', () => {
    const ti = setupWithSuggestions();
    expect(ti._selectedIdx).toBe(0);

    keydown(ti, 'ArrowDown');
    expect(ti._selectedIdx).toBe(1);

    keydown(ti, 'ArrowDown');
    expect(ti._selectedIdx).toBe(2);
  });

  it('ArrowDown does not exceed last item', () => {
    const ti = setupWithSuggestions();

    keydown(ti, 'ArrowDown');
    keydown(ti, 'ArrowDown');
    keydown(ti, 'ArrowDown'); // already at 2, should stay
    expect(ti._selectedIdx).toBe(2);
  });

  it('ArrowUp moves selection up', () => {
    const ti = setupWithSuggestions();
    keydown(ti, 'ArrowDown');
    keydown(ti, 'ArrowDown');
    expect(ti._selectedIdx).toBe(2);

    keydown(ti, 'ArrowUp');
    expect(ti._selectedIdx).toBe(1);
  });

  it('ArrowUp does not go below 0', () => {
    const ti = setupWithSuggestions();
    expect(ti._selectedIdx).toBe(0);

    keydown(ti, 'ArrowUp');
    expect(ti._selectedIdx).toBe(0);
  });

  it('Enter selects the highlighted suggestion', () => {
    const ti = setupWithSuggestions();
    keydown(ti, 'ArrowDown'); // select beta (index 1)

    keydown(ti, 'Enter');

    const tokens = ti.getTokens();
    expect(tokens.length).toBe(1);
    expect(tokens[0].label).toBe('beta');
    expect(tokens[0].type).toBe('agent');
    expect(tokens[0].char).toBe('@');
  });

  it('Tab selects the highlighted suggestion', () => {
    const ti = setupWithSuggestions();
    // Index 0 is already selected (alpha)

    keydown(ti, 'Tab');

    const tokens = ti.getTokens();
    expect(tokens.length).toBe(1);
    expect(tokens[0].label).toBe('alpha');
  });

  it('Escape closes autocomplete without selecting', () => {
    const ti = setupWithSuggestions();

    keydown(ti, 'Escape');

    expect(ti._autocompleteEl.style.display).toBe('none');
    expect(ti._suggestions).toEqual([]);
    expect(ti.getTokens()).toEqual([]);
  });

  it('highlights selected item with CSS class', () => {
    const ti = setupWithSuggestions();

    const items = ti._autocompleteEl.querySelectorAll('.token-autocomplete-item');
    expect(items[0].classList.contains('selected')).toBe(true);

    keydown(ti, 'ArrowDown');

    const updatedItems = ti._autocompleteEl.querySelectorAll('.token-autocomplete-item');
    expect(updatedItems[0].classList.contains('selected')).toBe(false);
    expect(updatedItems[1].classList.contains('selected')).toBe(true);
  });
});

// ─── Autocomplete mouse interaction ─────────────────────────

describe('TokenInput — autocomplete mouse interaction', () => {
  it('clicking a suggestion selects it', () => {
    const ti = create();
    type(ti, '/');
    ti._tokenTrigger = { type: 'command', char: '/', startPos: 0, query: '' };
    ti.setSuggestions([
      { id: 'help', label: 'help' },
      { id: 'status', label: 'status' },
    ]);

    const items = ti._autocompleteEl.querySelectorAll('.token-autocomplete-item');
    items[1].click();

    const tokens = ti.getTokens();
    expect(tokens.length).toBe(1);
    expect(tokens[0].label).toBe('status');
    expect(tokens[0].type).toBe('command');
  });

  it('mouseenter on a suggestion highlights it', () => {
    const ti = create();
    type(ti, '@');
    ti._tokenTrigger = { type: 'agent', char: '@', startPos: 0, query: '' };
    ti.setSuggestions([
      { id: 'a', label: 'alpha' },
      { id: 'b', label: 'beta' },
    ]);

    const items = ti._autocompleteEl.querySelectorAll('.token-autocomplete-item');
    items[1].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

    expect(ti._selectedIdx).toBe(1);
  });
});

// ─── Submit behavior ─────────────────────────────────────────

describe('TokenInput — submit', () => {
  it('Enter submits the message', () => {
    const onSubmit = vi.fn();
    const ti = create({ onSubmit });

    ti.setText('hello world');
    keydown(ti, 'Enter');

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('hello world', []);
  });

  it('Shift+Enter does not submit', () => {
    const onSubmit = vi.fn();
    const ti = create({ onSubmit });

    ti.setText('hello');
    keydown(ti, 'Enter', { shiftKey: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submit clears the input after sending', () => {
    const onSubmit = vi.fn();
    const ti = create({ onSubmit });

    ti.setText('hello');
    keydown(ti, 'Enter');

    expect(ti.getText()).toBe('');
    expect(ti.getTokens()).toEqual([]);
  });

  it('does not submit empty input with no tokens', () => {
    const onSubmit = vi.fn();
    const ti = create({ onSubmit });

    ti.setText('');
    keydown(ti, 'Enter');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit whitespace-only input with no tokens', () => {
    const onSubmit = vi.fn();
    const ti = create({ onSubmit });

    ti.setText('   ');
    keydown(ti, 'Enter');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submit passes collected tokens', () => {
    const onSubmit = vi.fn();
    const ti = create({ onSubmit });

    ti._tokens = [{ type: 'agent', id: 'a1', label: 'strategist', char: '@' }];
    ti.setText('help me @strategist');
    keydown(ti, 'Enter');

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [text, tokens] = onSubmit.mock.calls[0];
    expect(text).toBe('help me @strategist');
    expect(tokens.length).toBe(1);
    expect(tokens[0].label).toBe('strategist');
  });

  it('send button click submits the message', () => {
    const onSubmit = vi.fn();
    const ti = create({ onSubmit });

    ti.setText('from button');
    const btn = ti.el.querySelector('.token-input-send');
    btn.click();

    expect(onSubmit).toHaveBeenCalledWith('from button', []);
  });
});

// ─── Input history ───────────────────────────────────────────

describe('TokenInput — input history', () => {
  it('saves submitted messages to history', () => {
    const ti = create({ onSubmit: vi.fn() });

    ti.setText('first message');
    keydown(ti, 'Enter');
    ti.setText('second message');
    keydown(ti, 'Enter');

    expect(ti._history).toEqual(['first message', 'second message']);
  });

  it('Ctrl+ArrowUp navigates to previous history entry', () => {
    const ti = create({ onSubmit: vi.fn() });

    ti.setText('msg one');
    keydown(ti, 'Enter');
    ti.setText('msg two');
    keydown(ti, 'Enter');

    // Navigate back through history
    keydown(ti, 'ArrowUp', { ctrlKey: true });
    expect(ti.getText()).toBe('msg two');

    keydown(ti, 'ArrowUp', { ctrlKey: true });
    expect(ti.getText()).toBe('msg one');
  });

  it('Ctrl+ArrowUp does not go past oldest entry', () => {
    const ti = create({ onSubmit: vi.fn() });

    ti.setText('only message');
    keydown(ti, 'Enter');

    keydown(ti, 'ArrowUp', { ctrlKey: true });
    expect(ti.getText()).toBe('only message');

    keydown(ti, 'ArrowUp', { ctrlKey: true });
    expect(ti.getText()).toBe('only message');
  });

  it('Ctrl+ArrowDown navigates forward through history', () => {
    const ti = create({ onSubmit: vi.fn() });

    ti.setText('msg one');
    keydown(ti, 'Enter');
    ti.setText('msg two');
    keydown(ti, 'Enter');

    keydown(ti, 'ArrowUp', { ctrlKey: true });
    keydown(ti, 'ArrowUp', { ctrlKey: true });
    expect(ti.getText()).toBe('msg one');

    keydown(ti, 'ArrowDown', { ctrlKey: true });
    expect(ti.getText()).toBe('msg two');
  });

  it('Ctrl+ArrowDown past newest restores current draft', () => {
    const ti = create({ onSubmit: vi.fn() });

    ti.setText('submitted');
    keydown(ti, 'Enter');

    // Start typing a new draft
    ti.setText('my draft');

    // Navigate back to history
    keydown(ti, 'ArrowUp', { ctrlKey: true });
    expect(ti.getText()).toBe('submitted');

    // Navigate forward past history should restore draft
    keydown(ti, 'ArrowDown', { ctrlKey: true });
    expect(ti.getText()).toBe('my draft');
  });

  it('Ctrl+ArrowUp without history is a no-op', () => {
    const ti = create();

    ti.setText('current text');
    keydown(ti, 'ArrowUp', { ctrlKey: true });

    expect(ti.getText()).toBe('current text');
  });

  it('limits history to 50 entries', () => {
    const ti = create({ onSubmit: vi.fn() });

    // Call _submit() directly to avoid 110 getComputedStyle calls
    // (setText + clear each trigger _autoResize) which timeout in jsdom
    for (let i = 0; i < 55; i++) {
      ti._textareaEl.value = `msg ${i}`;
      ti._submit();
    }

    expect(ti._history.length).toBe(50);
    // oldest messages should have been shifted out
    expect(ti._history[0]).toBe('msg 5');
    expect(ti._history[49]).toBe('msg 54');
  });
});

// ─── Chip rendering and removal ──────────────────────────────

describe('TokenInput — chip rendering', () => {
  it('renders chips when tokens are present', () => {
    const ti = create();
    ti._tokens = [
      { type: 'command', id: 'help', label: 'help', char: '/' },
      { type: 'agent', id: 'a1', label: 'strategist', char: '@' },
    ];
    ti._renderChips();

    const chips = ti._chipArea.querySelectorAll('.token-chip');
    expect(chips.length).toBe(2);
  });

  it('applies type-specific CSS class to chips', () => {
    const ti = create();
    ti._tokens = [
      { type: 'command', id: 'help', label: 'help', char: '/' },
      { type: 'agent', id: 'a1', label: 'strat', char: '@' },
      { type: 'reference', id: 'r1', label: 'room', char: '#' },
    ];
    ti._renderChips();

    const chips = ti._chipArea.querySelectorAll('.token-chip');
    expect(chips[0].classList.contains('token-chip-command')).toBe(true);
    expect(chips[1].classList.contains('token-chip-agent')).toBe(true);
    expect(chips[2].classList.contains('token-chip-reference')).toBe(true);
  });

  it('renders trigger char and label inside chip', () => {
    const ti = create();
    ti._tokens = [{ type: 'agent', id: 'a1', label: 'strategist', char: '@' }];
    ti._renderChips();

    const charEl = ti._chipArea.querySelector('.token-chip-char');
    const labelEl = ti._chipArea.querySelector('.token-chip-label');
    expect(charEl.textContent).toBe('@');
    expect(labelEl.textContent).toBe('strategist');
  });

  it('sets data-token-id on chips', () => {
    const ti = create();
    ti._tokens = [{ type: 'command', id: 'deploy', label: 'deploy', char: '/' }];
    ti._renderChips();

    const chip = ti._chipArea.querySelector('.token-chip');
    expect(chip.getAttribute('data-token-id')).toBe('deploy');
  });

  it('includes a remove button on each chip', () => {
    const ti = create();
    ti._tokens = [{ type: 'agent', id: 'a1', label: 'arch', char: '@' }];
    ti._renderChips();

    const removeBtn = ti._chipArea.querySelector('.token-chip-remove');
    expect(removeBtn).not.toBeNull();
    expect(removeBtn.getAttribute('aria-label')).toBe('Remove arch');
  });

  it('clicking remove button removes the token', () => {
    const ti = create();
    ti._tokens = [
      { type: 'agent', id: 'a1', label: 'alpha', char: '@' },
      { type: 'agent', id: 'a2', label: 'beta', char: '@' },
    ];
    ti._renderChips();

    // Remove the first chip
    const removeBtns = ti._chipArea.querySelectorAll('.token-chip-remove');
    removeBtns[0].click();

    expect(ti._tokens.length).toBe(1);
    expect(ti._tokens[0].label).toBe('beta');
    // Chips should re-render with only one
    const chips = ti._chipArea.querySelectorAll('.token-chip');
    expect(chips.length).toBe(1);
  });

  it('hides chip area when no tokens remain', () => {
    const ti = create();
    ti._tokens = [{ type: 'command', id: 'help', label: 'help', char: '/' }];
    ti._renderChips();

    expect(ti._chipArea.style.display).not.toBe('none');

    // Remove the only token
    const removeBtn = ti._chipArea.querySelector('.token-chip-remove');
    removeBtn.click();

    expect(ti._chipArea.style.display).toBe('none');
  });
});

// ─── Suggestion selection integration ────────────────────────

describe('TokenInput — suggestion selection', () => {
  it('inserts selected suggestion into textarea text', () => {
    const ti = create();

    // Simulate typing "@str"
    ti._textareaEl.value = '@str';
    ti._textareaEl.selectionStart = 4;
    ti._textareaEl.selectionEnd = 4;

    ti._tokenTrigger = { type: 'agent', char: '@', startPos: 0, query: 'str' };

    ti._selectSuggestion({ id: 'strat', label: 'strategist' });

    expect(ti._textareaEl.value).toBe('@strategist ');
    expect(ti._tokens.length).toBe(1);
    expect(ti._tokens[0]).toEqual({
      type: 'agent',
      id: 'strat',
      label: 'strategist',
      char: '@',
    });
  });

  it('preserves text before and after the trigger', () => {
    const ti = create();

    ti._textareaEl.value = 'talk to @str please';
    ti._textareaEl.selectionStart = 12; // cursor after "str"
    ti._textareaEl.selectionEnd = 12;

    ti._tokenTrigger = { type: 'agent', char: '@', startPos: 8, query: 'str' };

    ti._selectSuggestion({ id: 'strat', label: 'strategist' });

    expect(ti._textareaEl.value).toBe('talk to @strategist  please');
  });

  it('closes autocomplete after selection', () => {
    const ti = create();
    ti._textareaEl.value = '/h';
    ti._textareaEl.selectionStart = 2;
    ti._tokenTrigger = { type: 'command', char: '/', startPos: 0, query: 'h' };
    ti.setSuggestions([{ id: 'help', label: 'help' }]);

    ti._selectSuggestion({ id: 'help', label: 'help' });

    expect(ti._autocompleteEl.style.display).toBe('none');
    expect(ti._tokenTrigger).toBeNull();
  });

  it('does nothing when suggestion is null', () => {
    const ti = create();
    ti._tokenTrigger = { type: 'command', char: '/', startPos: 0, query: '' };

    expect(() => ti._selectSuggestion(null)).not.toThrow();
    expect(ti._tokens.length).toBe(0);
  });

  it('does nothing when no active trigger', () => {
    const ti = create();
    ti._tokenTrigger = null;

    expect(() => ti._selectSuggestion({ id: 'a', label: 'a' })).not.toThrow();
    expect(ti._tokens.length).toBe(0);
  });
});
