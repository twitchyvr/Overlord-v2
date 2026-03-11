// @vitest-environment jsdom
/**
 * Tests for public/ui/components/table.js
 *
 * Covers: Table.render() for headers, rows, cell values, striped/hoverable/
 *         compact options, className, empty data, Node cell values, null/undefined
 *         cell handling.
 *         Table.styleMarkdownTables() for post-processing existing HTML tables.
 *         Table.configureMarked() for marked.js renderer integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const tablePath = '../../../public/ui/components/table.js';

let Table: any;

beforeEach(async () => {
  const mod = await import(tablePath);
  Table = mod.Table;
});

// ─── render() — basic structure ──────────────────────────────

describe('Table.render() — basic structure', () => {
  const cols = [
    { key: 'name', label: 'Name' },
    { key: 'age', label: 'Age' }
  ];
  const data = [
    { name: 'Alice', age: 30 },
    { name: 'Bob', age: 25 }
  ];

  it('returns a wrapper div with class "table-wrapper"', () => {
    const wrapper = Table.render(data, cols);
    expect(wrapper.tagName).toBe('DIV');
    expect(wrapper.classList.contains('table-wrapper')).toBe(true);
  });

  it('contains a <table> element inside the wrapper', () => {
    const wrapper = Table.render(data, cols);
    const table = wrapper.querySelector('table');
    expect(table).not.toBeNull();
    expect(table!.tagName).toBe('TABLE');
  });

  it('table has base class "overlord-table"', () => {
    const wrapper = Table.render(data, cols);
    const table = wrapper.querySelector('table');
    expect(table!.classList.contains('overlord-table')).toBe(true);
  });

  it('renders a <thead> with header row', () => {
    const wrapper = Table.render(data, cols);
    const thead = wrapper.querySelector('thead');
    expect(thead).not.toBeNull();
    const ths = thead!.querySelectorAll('th');
    expect(ths.length).toBe(2);
  });

  it('renders header labels from column definitions', () => {
    const wrapper = Table.render(data, cols);
    const ths = wrapper.querySelectorAll('thead th');
    expect(ths[0].textContent).toBe('Name');
    expect(ths[1].textContent).toBe('Age');
  });

  it('falls back to column key when label is not provided', () => {
    const colsNoLabel = [{ key: 'email' }, { key: 'phone' }];
    const wrapper = Table.render([], colsNoLabel);
    const ths = wrapper.querySelectorAll('thead th');
    expect(ths[0].textContent).toBe('email');
    expect(ths[1].textContent).toBe('phone');
  });

  it('renders a <tbody> with correct number of rows', () => {
    const wrapper = Table.render(data, cols);
    const rows = wrapper.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
  });

  it('renders correct cell values', () => {
    const wrapper = Table.render(data, cols);
    const cells = wrapper.querySelectorAll('tbody tr:first-child td');
    expect(cells[0].textContent).toBe('Alice');
    expect(cells[1].textContent).toBe('30');
  });

  it('renders each row with correct number of cells', () => {
    const wrapper = Table.render(data, cols);
    const rows = wrapper.querySelectorAll('tbody tr');
    rows.forEach((row: Element) => {
      expect(row.querySelectorAll('td').length).toBe(2);
    });
  });
});

// ─── render() — empty data ───────────────────────────────────

describe('Table.render() — empty data', () => {
  const cols = [{ key: 'id', label: 'ID' }];

  it('renders table with thead but empty tbody when data is empty', () => {
    const wrapper = Table.render([], cols);
    const thead = wrapper.querySelector('thead');
    const tbody = wrapper.querySelector('tbody');
    expect(thead).not.toBeNull();
    expect(tbody).not.toBeNull();
    expect(tbody!.querySelectorAll('tr').length).toBe(0);
  });

  it('still renders column headers when data is empty', () => {
    const wrapper = Table.render([], cols);
    const ths = wrapper.querySelectorAll('thead th');
    expect(ths.length).toBe(1);
    expect(ths[0].textContent).toBe('ID');
  });
});

// ─── render() — cell values (null, undefined, Node) ─────────

describe('Table.render() — cell value handling', () => {
  const cols = [{ key: 'val', label: 'Value' }];

  it('renders null cell values as empty string', () => {
    const wrapper = Table.render([{ val: null }], cols);
    const td = wrapper.querySelector('tbody td');
    expect(td!.textContent).toBe('');
  });

  it('renders undefined cell values as empty string', () => {
    const wrapper = Table.render([{ val: undefined }], cols);
    const td = wrapper.querySelector('tbody td');
    expect(td!.textContent).toBe('');
  });

  it('renders missing keys as empty string', () => {
    const wrapper = Table.render([{ other: 'x' }], cols);
    const td = wrapper.querySelector('tbody td');
    expect(td!.textContent).toBe('');
  });

  it('renders numeric values as strings', () => {
    const wrapper = Table.render([{ val: 42 }], cols);
    const td = wrapper.querySelector('tbody td');
    expect(td!.textContent).toBe('42');
  });

  it('renders zero as "0"', () => {
    const wrapper = Table.render([{ val: 0 }], cols);
    const td = wrapper.querySelector('tbody td');
    expect(td!.textContent).toBe('0');
  });

  it('renders boolean false as "false"', () => {
    const wrapper = Table.render([{ val: false }], cols);
    const td = wrapper.querySelector('tbody td');
    expect(td!.textContent).toBe('false');
  });

  it('appends DOM Node values directly to the cell', () => {
    const span = document.createElement('span');
    span.textContent = 'Rich content';
    const wrapper = Table.render([{ val: span }], cols);
    const td = wrapper.querySelector('tbody td');
    expect(td!.querySelector('span')).toBe(span);
    expect(td!.textContent).toBe('Rich content');
  });
});

// ─── render() — striped option ───────────────────────────────

describe('Table.render() — striped option', () => {
  const cols = [{ key: 'a', label: 'A' }];
  const data = [{ a: 1 }];

  it('applies "table-striped" class by default', () => {
    const wrapper = Table.render(data, cols);
    const table = wrapper.querySelector('table');
    expect(table!.classList.contains('table-striped')).toBe(true);
  });

  it('applies "table-striped" when striped is explicitly true', () => {
    const wrapper = Table.render(data, cols, { striped: true });
    const table = wrapper.querySelector('table');
    expect(table!.classList.contains('table-striped')).toBe(true);
  });

  it('omits "table-striped" when striped is false', () => {
    const wrapper = Table.render(data, cols, { striped: false });
    const table = wrapper.querySelector('table');
    expect(table!.classList.contains('table-striped')).toBe(false);
  });
});

// ─── render() — hoverable option ─────────────────────────────

describe('Table.render() — hoverable option', () => {
  const cols = [{ key: 'a', label: 'A' }];
  const data = [{ a: 1 }];

  it('applies "table-hoverable" class by default', () => {
    const wrapper = Table.render(data, cols);
    const table = wrapper.querySelector('table');
    expect(table!.classList.contains('table-hoverable')).toBe(true);
  });

  it('applies "table-hoverable" when hoverable is explicitly true', () => {
    const wrapper = Table.render(data, cols, { hoverable: true });
    const table = wrapper.querySelector('table');
    expect(table!.classList.contains('table-hoverable')).toBe(true);
  });

  it('omits "table-hoverable" when hoverable is false', () => {
    const wrapper = Table.render(data, cols, { hoverable: false });
    const table = wrapper.querySelector('table');
    expect(table!.classList.contains('table-hoverable')).toBe(false);
  });
});

// ─── render() — compact option ───────────────────────────────

describe('Table.render() — compact option', () => {
  const cols = [{ key: 'a', label: 'A' }];
  const data = [{ a: 1 }];

  it('does not apply "table-compact" by default', () => {
    const wrapper = Table.render(data, cols);
    const table = wrapper.querySelector('table');
    expect(table!.classList.contains('table-compact')).toBe(false);
  });

  it('applies "table-compact" when compact is true', () => {
    const wrapper = Table.render(data, cols, { compact: true });
    const table = wrapper.querySelector('table');
    expect(table!.classList.contains('table-compact')).toBe(true);
  });
});

// ─── render() — className option ─────────────────────────────

describe('Table.render() — className option', () => {
  const cols = [{ key: 'a', label: 'A' }];
  const data = [{ a: 1 }];

  it('appends additional className to table classes', () => {
    const wrapper = Table.render(data, cols, { className: 'my-custom-table' });
    const table = wrapper.querySelector('table');
    expect(table!.classList.contains('my-custom-table')).toBe(true);
    expect(table!.classList.contains('overlord-table')).toBe(true);
  });

  it('does not add empty className', () => {
    const wrapper = Table.render(data, cols, { className: '' });
    const table = wrapper.querySelector('table');
    // class string should not have trailing spaces from empty className
    expect(table!.className).not.toMatch(/\s{2,}/);
  });
});

// ─── render() — column alignment and width ───────────────────

describe('Table.render() — column alignment and width', () => {
  it('applies text-align from column align property to th', () => {
    const cols = [{ key: 'price', label: 'Price', align: 'right' }];
    const wrapper = Table.render([{ price: 9.99 }], cols);
    const th = wrapper.querySelector('thead th') as HTMLElement;
    expect(th.style.textAlign).toBe('right');
  });

  it('defaults th text-align to "left" when align is not specified', () => {
    const cols = [{ key: 'name', label: 'Name' }];
    const wrapper = Table.render([{ name: 'Test' }], cols);
    const th = wrapper.querySelector('thead th') as HTMLElement;
    expect(th.style.textAlign).toBe('left');
  });

  it('applies text-align from column align property to td', () => {
    const cols = [{ key: 'num', label: 'Num', align: 'center' }];
    const wrapper = Table.render([{ num: 5 }], cols);
    const td = wrapper.querySelector('tbody td') as HTMLElement;
    expect(td.style.textAlign).toBe('center');
  });

  it('applies width from column definition to th', () => {
    const cols = [{ key: 'id', label: 'ID', width: '100px' }];
    const wrapper = Table.render([{ id: 1 }], cols);
    const th = wrapper.querySelector('thead th') as HTMLElement;
    expect(th.style.width).toBe('100px');
  });

  it('defaults th width to "auto" when width is not specified', () => {
    const cols = [{ key: 'id', label: 'ID' }];
    const wrapper = Table.render([{ id: 1 }], cols);
    const th = wrapper.querySelector('thead th') as HTMLElement;
    expect(th.style.width).toBe('auto');
  });
});

// ─── render() — combined options ─────────────────────────────

describe('Table.render() — combined options', () => {
  it('applies all classes together: striped + hoverable + compact + custom', () => {
    const cols = [{ key: 'x', label: 'X' }];
    const wrapper = Table.render([{ x: 1 }], cols, {
      striped: true,
      hoverable: true,
      compact: true,
      className: 'extra'
    });
    const table = wrapper.querySelector('table');
    expect(table!.classList.contains('overlord-table')).toBe(true);
    expect(table!.classList.contains('table-striped')).toBe(true);
    expect(table!.classList.contains('table-hoverable')).toBe(true);
    expect(table!.classList.contains('table-compact')).toBe(true);
    expect(table!.classList.contains('extra')).toBe(true);
  });

  it('applies minimal classes when all boolean opts are false', () => {
    const cols = [{ key: 'x', label: 'X' }];
    const wrapper = Table.render([{ x: 1 }], cols, {
      striped: false,
      hoverable: false,
      compact: false
    });
    const table = wrapper.querySelector('table');
    expect(table!.classList.contains('overlord-table')).toBe(true);
    expect(table!.classList.contains('table-striped')).toBe(false);
    expect(table!.classList.contains('table-hoverable')).toBe(false);
    expect(table!.classList.contains('table-compact')).toBe(false);
  });
});

// ─── styleMarkdownTables() ───────────────────────────────────

describe('Table.styleMarkdownTables()', () => {
  it('adds overlord classes to plain tables inside a container', () => {
    const container = document.createElement('div');
    const table = document.createElement('table');
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.textContent = 'Cell';
    tr.appendChild(td);
    table.appendChild(tr);
    container.appendChild(table);

    Table.styleMarkdownTables(container);

    expect(table.classList.contains('overlord-table')).toBe(true);
    expect(table.classList.contains('table-striped')).toBe(true);
    expect(table.classList.contains('table-hoverable')).toBe(true);
  });

  it('wraps the table in a .table-wrapper div', () => {
    const container = document.createElement('div');
    const table = document.createElement('table');
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.textContent = 'A';
    tr.appendChild(td);
    table.appendChild(tr);
    container.appendChild(table);

    Table.styleMarkdownTables(container);

    const wrapper = container.querySelector('.table-wrapper');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector('table')).not.toBeNull();
  });

  it('does not re-process already-styled tables', () => {
    const container = document.createElement('div');
    const table = document.createElement('table');
    table.classList.add('overlord-table');
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.textContent = 'A';
    tr.appendChild(td);
    table.appendChild(tr);
    container.appendChild(table);

    Table.styleMarkdownTables(container);

    // Should not be wrapped since it was already styled
    expect(table.parentElement!.classList.contains('table-wrapper')).toBe(false);
    // Should still have only the original class (not duplicated)
    expect(table.classList.contains('overlord-table')).toBe(true);
  });

  it('does not double-wrap a table already inside .table-wrapper', () => {
    const container = document.createElement('div');
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';
    const table = document.createElement('table');
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.textContent = 'A';
    tr.appendChild(td);
    table.appendChild(tr);
    wrapper.appendChild(table);
    container.appendChild(wrapper);

    Table.styleMarkdownTables(container);

    // Should have exactly one .table-wrapper
    const wrappers = container.querySelectorAll('.table-wrapper');
    expect(wrappers.length).toBe(1);
  });

  it('handles multiple tables in one container', () => {
    const container = document.createElement('div');
    for (let i = 0; i < 2; i++) {
      const table = document.createElement('table');
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.textContent = String(i + 1);
      tr.appendChild(td);
      table.appendChild(tr);
      container.appendChild(table);
    }

    Table.styleMarkdownTables(container);

    const tables = container.querySelectorAll('.overlord-table');
    expect(tables.length).toBe(2);

    const wrappers = container.querySelectorAll('.table-wrapper');
    expect(wrappers.length).toBe(2);
  });

  it('does nothing when el is null', () => {
    // Should not throw
    expect(() => Table.styleMarkdownTables(null)).not.toThrow();
  });

  it('does nothing when container has no tables', () => {
    const container = document.createElement('div');
    const p = document.createElement('p');
    p.textContent = 'No tables here';
    container.appendChild(p);

    Table.styleMarkdownTables(container);

    expect(container.querySelector('.table-wrapper')).toBeNull();
    expect(container.querySelector('.overlord-table')).toBeNull();
  });
});

// ─── configureMarked() ───────────────────────────────────────

describe('Table.configureMarked()', () => {
  it('calls marked.use() with a renderer containing a table function', () => {
    const marked = { use: vi.fn() };
    Table.configureMarked(marked);

    expect(marked.use).toHaveBeenCalledTimes(1);
    const arg = marked.use.mock.calls[0][0];
    expect(arg).toHaveProperty('renderer');
    expect(typeof arg.renderer.table).toBe('function');
  });

  it('renderer.table() returns HTML with overlord table classes', () => {
    const marked = { use: vi.fn() };
    Table.configureMarked(marked);

    const renderer = marked.use.mock.calls[0][0].renderer;
    const html = renderer.table('<tr><th>H</th></tr>', '<tr><td>D</td></tr>');

    expect(html).toContain('class="table-wrapper"');
    expect(html).toContain('class="overlord-table table-striped table-hoverable"');
    expect(html).toContain('<thead>');
    expect(html).toContain('<tbody>');
  });

  it('renderer.table() wraps header in <thead> and body in <tbody>', () => {
    const marked = { use: vi.fn() };
    Table.configureMarked(marked);

    const renderer = marked.use.mock.calls[0][0].renderer;
    const header = '<tr><th>Col1</th></tr>';
    const body = '<tr><td>Val1</td></tr>';
    const html = renderer.table(header, body);

    expect(html).toContain(`<thead>${header}</thead>`);
    expect(html).toContain(`<tbody>${body}</tbody>`);
  });

  it('does nothing when marked is null', () => {
    expect(() => Table.configureMarked(null)).not.toThrow();
  });

  it('does nothing when marked is undefined', () => {
    expect(() => Table.configureMarked(undefined)).not.toThrow();
  });

  it('does nothing when marked lacks .use method', () => {
    expect(() => Table.configureMarked({})).not.toThrow();
    expect(() => Table.configureMarked({ use: null })).not.toThrow();
  });
});
