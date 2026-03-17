/**
 * Budget Dashboard — Agent Token Usage (#680)
 *
 * Shows per-agent token budget usage with progress bars,
 * alerts, and quick budget configuration.
 *
 * Renders as a card grid — each agent gets a budget card
 * with usage bar, stats, and edit controls.
 */

import { h } from '../engine/helpers.js';
import { OverlordUI } from '../engine/engine.js';
import { Toast } from './toast.js';

export class BudgetDashboard {

  /**
   * Render the budget dashboard for a building.
   * @param {Array} budgets - array of BudgetStatus from budget:building
   * @param {Function} onRefresh - callback to refresh data
   * @returns {HTMLElement}
   */
  static render(budgets, onRefresh) {
    const container = h('div', { class: 'budget-dashboard' });

    // Summary bar
    const totalUsed = budgets.reduce((sum, b) => sum + b.used, 0);
    const withBudget = budgets.filter(b => b.limit > 0);
    const overBudget = withBudget.filter(b => b.isOverBudget);

    const summaryBar = h('div', { class: 'budget-summary' },
      h('div', { class: 'budget-summary-stat' },
        h('span', { class: 'budget-summary-value' }, BudgetDashboard._formatTokens(totalUsed)),
        h('span', { class: 'budget-summary-label' }, 'Total Tokens Used'),
      ),
      h('div', { class: 'budget-summary-stat' },
        h('span', { class: 'budget-summary-value' }, String(withBudget.length)),
        h('span', { class: 'budget-summary-label' }, 'Agents with Budgets'),
      ),
      h('div', { class: `budget-summary-stat${overBudget.length > 0 ? ' budget-summary-stat--danger' : ''}` },
        h('span', { class: 'budget-summary-value' }, String(overBudget.length)),
        h('span', { class: 'budget-summary-label' }, 'Over Budget'),
      ),
    );
    container.appendChild(summaryBar);

    // Agent budget cards
    const grid = h('div', { class: 'budget-grid' });

    // Sort: over budget first, then by usage descending
    const sorted = [...budgets].sort((a, b) => {
      if (a.isOverBudget && !b.isOverBudget) return -1;
      if (!a.isOverBudget && b.isOverBudget) return 1;
      return b.used - a.used;
    });

    for (const budget of sorted) {
      grid.appendChild(BudgetDashboard._renderAgentCard(budget, onRefresh));
    }

    container.appendChild(grid);
    return container;
  }

  static _renderAgentCard(budget, onRefresh) {
    const { agentId, agentName, limit, period, used, percentUsed, isOverBudget } = budget;
    const hasLimit = limit > 0;

    // Progress bar color
    let barClass = 'budget-bar--ok';
    if (percentUsed >= 90) barClass = 'budget-bar--danger';
    else if (percentUsed >= 75) barClass = 'budget-bar--warn';

    const card = h('div', { class: `budget-card${isOverBudget ? ' budget-card--over' : ''}` });

    // Header: agent name + period badge
    const header = h('div', { class: 'budget-card-header' },
      h('span', { class: 'budget-card-name' }, agentName),
      h('span', { class: 'budget-card-period' }, period),
    );
    card.appendChild(header);

    // Usage stats
    const statsRow = h('div', { class: 'budget-card-stats' },
      h('span', { class: 'budget-card-used' }, BudgetDashboard._formatTokens(used)),
      hasLimit
        ? h('span', { class: 'budget-card-limit' }, ` / ${BudgetDashboard._formatTokens(limit)}`)
        : h('span', { class: 'budget-card-limit budget-card-limit--unlimited' }, ' unlimited'),
    );
    card.appendChild(statsRow);

    // Progress bar
    if (hasLimit) {
      const barWidth = Math.min(100, percentUsed);
      const bar = h('div', { class: 'budget-bar' },
        h('div', { class: `budget-bar-fill ${barClass}`, style: `width:${barWidth}%` }),
      );
      card.appendChild(bar);

      const pctLabel = h('div', { class: 'budget-card-pct' },
        `${percentUsed}% used`,
      );
      card.appendChild(pctLabel);
    }

    // Quick actions
    const actions = h('div', { class: 'budget-card-actions' });

    // Set budget button
    const setBudgetBtn = h('button', {
      class: 'btn btn-ghost btn-xs',
      title: 'Set token budget',
    }, hasLimit ? 'Edit Budget' : 'Set Budget');
    setBudgetBtn.addEventListener('click', () => {
      BudgetDashboard._promptBudget(agentId, agentName, limit, period, onRefresh);
    });
    actions.appendChild(setBudgetBtn);

    // Remove budget (if has one)
    if (hasLimit) {
      const removeBtn = h('button', {
        class: 'btn btn-ghost btn-xs',
        title: 'Remove budget limit',
        style: 'color: var(--text-muted)',
      }, 'Remove');
      removeBtn.addEventListener('click', () => {
        BudgetDashboard._setBudget(agentId, { limit: 0 }, onRefresh);
        Toast.info(`Budget removed for ${agentName}`);
      });
      actions.appendChild(removeBtn);
    }

    card.appendChild(actions);
    return card;
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

  static _formatTokens(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }
}
