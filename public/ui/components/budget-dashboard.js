/**
 * Budget Dashboard — Agent Token Usage & Cost Visibility (#680, #852)
 *
 * Shows per-agent token budget usage with progress bars, estimated costs,
 * alerts, and quick budget configuration.
 *
 * Renders as a summary section + card grid — each agent gets a budget card
 * with usage bar, cost estimate, stats, and edit controls.
 */

import { h } from '../engine/helpers.js';
import { OverlordUI } from '../engine/engine.js';
import { Toast } from './toast.js';

// Estimated token pricing per 1M tokens (input/output blended average)
// These are rough estimates for cost visibility, not exact billing.
const MODEL_PRICING = {
  minimax: { per1M: 1.65, label: 'MiniMax M2.5' },
  anthropic: { per1M: 3.00, label: 'Claude Sonnet' },
  ollama: { per1M: 0, label: 'Ollama (local)' },
  default: { per1M: 2.00, label: 'AI Provider' },
};

export class BudgetDashboard {

  /**
   * Render the budget dashboard for a building.
   * @param {Array} budgets - array of BudgetStatus from budget:building
   * @param {Function} onRefresh - callback to refresh data
   * @returns {HTMLElement}
   */
  static render(budgets, onRefresh) {
    const container = h('div', { class: 'budget-dashboard' });

    // ── Global Summary ──
    const totalUsed = budgets.reduce((sum, b) => sum + b.used, 0);
    const totalCost = BudgetDashboard._estimateCost(totalUsed);
    const withBudget = budgets.filter(b => b.limit > 0);
    const overBudget = withBudget.filter(b => b.isOverBudget);
    const totalLimit = withBudget.reduce((sum, b) => sum + b.limit, 0);
    const budgetedUsed = withBudget.reduce((sum, b) => sum + b.used, 0);
    const globalPct = totalLimit > 0 ? Math.round((budgetedUsed / totalLimit) * 100) : 0;

    const summaryBar = h('div', { class: 'budget-summary' },
      h('div', { class: 'budget-summary-stat' },
        h('span', { class: 'budget-summary-value' }, BudgetDashboard._formatTokens(totalUsed)),
        h('span', { class: 'budget-summary-label' }, 'Total Tokens Used'),
      ),
      h('div', { class: 'budget-summary-stat' },
        h('span', { class: 'budget-summary-value budget-summary-value--cost' }, `$${totalCost.toFixed(2)}`),
        h('span', { class: 'budget-summary-label' }, 'Est. Cost'),
      ),
      h('div', { class: 'budget-summary-stat' },
        h('span', { class: 'budget-summary-value' }, String(budgets.length)),
        h('span', { class: 'budget-summary-label' }, 'Active Agents'),
      ),
      h('div', { class: `budget-summary-stat${overBudget.length > 0 ? ' budget-summary-stat--danger' : ''}` },
        h('span', { class: 'budget-summary-value' }, String(overBudget.length)),
        h('span', { class: 'budget-summary-label' }, 'Over Budget'),
      ),
    );
    container.appendChild(summaryBar);

    // Global budget bar (if any agents have budgets)
    if (totalLimit > 0) {
      const globalBarWidth = Math.min(100, globalPct);
      let globalBarClass = 'budget-bar--ok';
      if (globalPct >= 90) globalBarClass = 'budget-bar--danger';
      else if (globalPct >= 75) globalBarClass = 'budget-bar--warn';

      const globalBar = h('div', { class: 'budget-global-bar' },
        h('div', { class: 'budget-bar', style: 'margin-bottom: 4px' },
          h('div', { class: `budget-bar-fill ${globalBarClass}`, style: `width:${globalBarWidth}%` }),
        ),
        h('div', { class: 'budget-global-label', style: 'display:flex; justify-content:space-between; font-size:var(--text-xs); color:var(--text-muted)' },
          h('span', {}, `${globalPct}% of combined budgets used`),
          h('span', {}, `${BudgetDashboard._formatTokens(totalUsed)} / ${BudgetDashboard._formatTokens(totalLimit)}`),
        ),
      );
      container.appendChild(globalBar);
    }

    // ── Per-Agent Table ──
    if (budgets.length > 0) {
      const table = BudgetDashboard._renderTable(budgets, onRefresh);
      container.appendChild(table);
    } else {
      container.appendChild(h('div', { class: 'budget-empty', style: 'text-align:center; padding:var(--sp-6); color:var(--text-muted)' },
        h('p', {}, 'No agents in this building yet.'),
      ));
    }

    return container;
  }

  /** Render the per-agent usage table */
  static _renderTable(budgets, onRefresh) {
    const wrapper = h('div', { class: 'budget-table-wrapper', style: 'margin-top:var(--sp-4); overflow-x:auto' });

    const table = h('table', { class: 'budget-table', style: 'width:100%; border-collapse:collapse; font-size:var(--text-sm)' });

    // Header
    const thead = h('thead', {},
      h('tr', { style: 'text-align:left; border-bottom:1px solid var(--border-secondary)' },
        h('th', { style: 'padding:var(--sp-2) var(--sp-3); font-weight:var(--font-medium); color:var(--text-muted)' }, 'Agent'),
        h('th', { style: 'padding:var(--sp-2) var(--sp-3); font-weight:var(--font-medium); color:var(--text-muted); text-align:right' }, 'Tokens Used'),
        h('th', { style: 'padding:var(--sp-2) var(--sp-3); font-weight:var(--font-medium); color:var(--text-muted); text-align:right' }, 'Est. Cost'),
        h('th', { style: 'padding:var(--sp-2) var(--sp-3); font-weight:var(--font-medium); color:var(--text-muted); min-width:120px' }, 'Budget'),
        h('th', { style: 'padding:var(--sp-2) var(--sp-3); font-weight:var(--font-medium); color:var(--text-muted)' }, ''),
      ),
    );
    table.appendChild(thead);

    // Body - sorted by usage descending, over-budget first
    const sorted = [...budgets].sort((a, b) => {
      if (a.isOverBudget && !b.isOverBudget) return -1;
      if (!a.isOverBudget && b.isOverBudget) return 1;
      return b.used - a.used;
    });

    const tbody = h('tbody', {});
    for (const budget of sorted) {
      tbody.appendChild(BudgetDashboard._renderTableRow(budget, onRefresh));
    }
    table.appendChild(tbody);

    wrapper.appendChild(table);
    return wrapper;
  }

  /** Render a single table row for an agent */
  static _renderTableRow(budget, onRefresh) {
    const { agentId, agentName, limit, period, used, percentUsed, isOverBudget } = budget;
    const hasLimit = limit > 0;
    const cost = BudgetDashboard._estimateCost(used);

    // Budget cell content
    let budgetCell;
    if (hasLimit) {
      const barWidth = Math.min(100, percentUsed);
      let barClass = 'budget-bar--ok';
      if (percentUsed >= 90) barClass = 'budget-bar--danger';
      else if (percentUsed >= 75) barClass = 'budget-bar--warn';

      budgetCell = h('td', { style: 'padding:var(--sp-2) var(--sp-3)' },
        h('div', { style: 'display:flex; align-items:center; gap:var(--sp-2)' },
          h('div', { class: 'budget-bar', style: 'flex:1; height:6px' },
            h('div', { class: `budget-bar-fill ${barClass}`, style: `width:${barWidth}%` }),
          ),
          h('span', { style: `font-size:var(--text-xs); color:${isOverBudget ? 'var(--c-danger)' : 'var(--text-muted)'}; white-space:nowrap` },
            `${percentUsed}%`
          ),
        ),
      );
    } else {
      budgetCell = h('td', { style: 'padding:var(--sp-2) var(--sp-3); color:var(--text-muted); font-size:var(--text-xs)' }, 'No limit');
    }

    // Actions cell
    const actionsCell = h('td', { style: 'padding:var(--sp-2) var(--sp-3)' });
    const editBtn = h('button', {
      class: 'btn btn-ghost btn-xs',
      style: 'font-size:var(--text-xs); padding:2px 6px',
    }, hasLimit ? 'Edit' : 'Set Limit');
    editBtn.addEventListener('click', () => {
      BudgetDashboard._promptBudget(agentId, agentName, limit, period, onRefresh);
    });
    actionsCell.appendChild(editBtn);

    const row = h('tr', {
      style: `border-bottom:1px solid var(--border-secondary)${isOverBudget ? '; background:var(--c-danger-bg, rgba(231,76,60,0.05))' : ''}`,
    },
      h('td', { style: 'padding:var(--sp-2) var(--sp-3); font-weight:var(--font-medium)' },
        h('span', {}, agentName),
        isOverBudget ? h('span', { style: 'margin-left:var(--sp-2); font-size:var(--text-xs); color:var(--c-danger); font-weight:var(--font-bold)' }, 'OVER') : null,
      ),
      h('td', { style: 'padding:var(--sp-2) var(--sp-3); text-align:right; font-variant-numeric:tabular-nums' },
        BudgetDashboard._formatTokens(used),
      ),
      h('td', { style: 'padding:var(--sp-2) var(--sp-3); text-align:right; font-variant-numeric:tabular-nums; color:var(--text-muted)' },
        `$${cost.toFixed(2)}`,
      ),
      budgetCell,
      actionsCell,
    );

    return row;
  }

  static _promptBudget(agentId, agentName, currentLimit, currentPeriod, onRefresh) {
    const input = prompt(
      `Set token budget for ${agentName}\n\nCurrent: ${currentLimit > 0 ? BudgetDashboard._formatTokens(currentLimit) + ' / ' + currentPeriod : 'unlimited'}\n\nEnter token limit (e.g., 50000, 100000):`,
      String(currentLimit || 50000),
    );
    if (input === null) return;

    const limit = parseInt(input, 10);
    if (isNaN(limit) || limit < 0) {
      Toast.error('Invalid budget amount');
      return;
    }

    BudgetDashboard._setBudget(agentId, { limit, period: currentPeriod || 'monthly' }, onRefresh);
    Toast.success(`Budget set: ${BudgetDashboard._formatTokens(limit)} / ${currentPeriod || 'monthly'} for ${agentName}`);
  }

  static _setBudget(agentId, budgetConfig, onRefresh) {
    if (window.overlordSocket?.socket) {
      window.overlordSocket.socket.emit('budget:set', { agentId, ...budgetConfig }, (res) => {
        if (res?.ok && onRefresh) onRefresh();
      });
    }
  }

  /** Estimate cost in USD based on token count (blended input/output rate) */
  static _estimateCost(tokens, provider = 'minimax') {
    const pricing = MODEL_PRICING[provider] || MODEL_PRICING.default;
    return (tokens / 1_000_000) * pricing.per1M;
  }

  static _formatTokens(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }
}
