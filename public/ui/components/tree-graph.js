/**
 * Overlord v2 — Tree Graph Component
 *
 * SVG-rendered tree visualization with curved bezier connectors,
 * color-coded branches by type, status-colored nodes, pan/zoom,
 * and viewport culling for large trees.
 *
 * Layout: horizontal tree (root left, children right).
 * Algorithm: recursive bottom-up sizing, parent centered among children.
 * Performance: only renders nodes within the visible viewport.
 */

import { h, clamp } from '../engine/helpers.js';

// ─── Layout Constants ───

const NODE_W = 180;
const NODE_H = 36;
const H_GAP = 60;      // horizontal gap between depth levels
const V_GAP = 12;       // vertical gap between sibling nodes
const PADDING = 40;      // canvas padding around entire tree
const STATUS_BAR_W = 4;  // left status bar width

// ─── Colors ───

const STATUS_COLORS = {
  done:          '#4ade80',
  'in-progress': '#38bdf8',
  pending:       '#64748b',
  blocked:       '#f87171',
};

const TYPE_COLORS = {
  epic:    '#a855f7',
  feature: '#38bdf8',
  task:    '#4ade80',
  bug:     '#f87171',
  chore:   '#fbbf24',
};

const TYPE_ICONS = {
  epic:    '\u{1F3AF}',
  feature: '\u{1F527}',
  task:    '\u{1F4CB}',
  bug:     '\u{1F41B}',
  chore:   '\u{1F9F9}',
};

// ─── Node styling ───

const NODE_BG = '#1a2332';
const NODE_BG_HOVER = '#243044';
const NODE_STROKE = '#2d3748';
const NODE_STROKE_HOVER = '#4a5568';
const TEXT_FILL = '#e2e8f0';
const TEXT_FILL_MUTED = '#94a3b8';
const BADGE_BG = '#0f1923';
const DOT_STROKE = '#0a0e17';

// ─── Zoom limits ───

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5.0;
const ZOOM_STEP = 0.15;

/* ═══════════════════════════════════════════════════════════
   TreeGraph
   ═══════════════════════════════════════════════════════════ */

export class TreeGraph {

  /**
   * @param {HTMLElement} containerEl - DOM element to render into
   * @param {object}      opts
   * @param {function}    opts.onNodeClick - callback(nodeData) when a node is clicked
   * @param {number}      opts.maxDepth    - max recursion depth for layout (default: 1000)
   */
  constructor(containerEl, opts = {}) {
    this._container = containerEl;
    this._svgNS = 'http://www.w3.org/2000/svg';
    this._onNodeClick = opts.onNodeClick || null;
    this._maxDepth = opts.maxDepth || 1000;

    // Layout result
    this._layoutNodes = [];
    this._layoutEdges = [];
    this._treeW = 0;
    this._treeH = 0;

    // Pan/zoom state
    this._pan = { x: PADDING, y: 0 };
    this._zoom = 1;
    this._isPanning = false;
    this._panStart = null;
    this._panStartOffset = null;

    // DOM refs
    this._svg = null;
    this._mainGroup = null;
    this._nodesGroup = null;
    this._edgesGroup = null;
    this._controlsEl = null;
    this._wrapperEl = null;

    // Viewport culling
    this._viewportRect = null;
    this._rafId = null;

    // Cleanup tracking
    this._cleanupFns = [];
    this._resizeObserver = null;
  }

  /* ═══════════════════════════════════════════════════════════
     Public API
     ═══════════════════════════════════════════════════════════ */

  /**
   * Render the tree from root nodes.
   * @param {Array} roots - [{ id, title, type, status, priority, children: [...] }, ...]
   */
  render(roots) {
    this.destroy();

    if (!roots || roots.length === 0) {
      this._container.appendChild(
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: TEXT_FILL_MUTED, fontSize: '14px',
          },
        }, 'No data to visualize.')
      );
      return;
    }

    // Build virtual root if multiple roots
    const virtualRoot = roots.length === 1
      ? roots[0]
      : { id: '__vroot__', title: 'Project', type: 'epic', status: 'pending', priority: 'normal', children: roots };

    // Phase 1: Compute layout positions
    this._layoutNodes = [];
    this._layoutEdges = [];
    this._computeLayout(virtualRoot, 0, 0, 0);
    this._collectEdges(virtualRoot, 0);

    // Compute bounds
    this._treeW = 0;
    this._treeH = 0;
    for (const n of this._layoutNodes) {
      this._treeW = Math.max(this._treeW, n.x + NODE_W);
      this._treeH = Math.max(this._treeH, n.y + NODE_H);
    }
    this._treeW += PADDING * 2;
    this._treeH += PADDING * 2;

    // Large tree warning — cap at 500 visible nodes for performance
    const MAX_RENDERED = 500;
    if (this._layoutNodes.length > MAX_RENDERED) {
      // Sort by depth (shallow first), render only first MAX_RENDERED
      const sorted = [...this._layoutNodes].sort((a, b) => a.x - b.x);
      this._layoutNodes = sorted.slice(0, MAX_RENDERED);
      const renderedIds = new Set(this._layoutNodes.map(n => n.id));
      this._layoutEdges = this._layoutEdges.filter(e => renderedIds.has(e.parentId) && renderedIds.has(e.childId));
      this._truncated = true;
      this._totalCount = sorted.length;
    } else {
      this._truncated = false;
    }

    // Phase 2: Build DOM
    this._buildDOM();

    // Phase 3: Draw
    this._drawEdges();
    this._drawNodes();

    // Show truncation warning if needed
    if (this._truncated) {
      const warn = document.createElement('div');
      warn.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);background:#1a2332;border:1px solid #fb923c;border-radius:6px;padding:6px 16px;color:#fb923c;font-size:12px;z-index:20;';
      warn.textContent = `Showing ${MAX_RENDERED} of ${this._totalCount} nodes. Zoom in or use Cards/Text mode for full tree.`;
      this._wrapperEl?.appendChild(warn);
    }

    // Phase 4: Fit to view
    requestAnimationFrame(() => this.fitToView());
  }

  /** Auto-zoom so the entire tree is visible within the container */
  fitToView() {
    if (!this._wrapperEl || !this._mainGroup) return;

    const rect = this._wrapperEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const scaleX = (rect.width - 80) / this._treeW;
    const scaleY = (rect.height - 80) / this._treeH;
    this._zoom = clamp(Math.min(scaleX, scaleY), MIN_ZOOM, MAX_ZOOM);

    // Center the tree
    const scaledW = this._treeW * this._zoom;
    const scaledH = this._treeH * this._zoom;
    this._pan.x = (rect.width - scaledW) / 2;
    this._pan.y = (rect.height - scaledH) / 2;

    this._applyTransform();
  }

  /** Set zoom to a specific level */
  zoomTo(level) {
    this._zoom = clamp(level, MIN_ZOOM, MAX_ZOOM);
    this._applyTransform();
  }

  /** Center the view on a specific node */
  centerOnNode(nodeId) {
    if (!this._wrapperEl) return;
    const node = this._layoutNodes.find(n => n.id === nodeId);
    if (!node) return;

    const rect = this._wrapperEl.getBoundingClientRect();
    const centerX = node.x + NODE_W / 2;
    const centerY = node.y + NODE_H / 2;

    this._pan.x = rect.width / 2 - centerX * this._zoom;
    this._pan.y = rect.height / 2 - centerY * this._zoom;
    this._applyTransform();

    // Briefly highlight the node
    this._highlightNode(nodeId);
  }

  /** Full teardown */
  destroy() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    for (const fn of this._cleanupFns) {
      try { fn(); } catch (_) { /* ignore */ }
    }
    this._cleanupFns = [];
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    this._container.textContent = '';
    this._svg = null;
    this._mainGroup = null;
    this._nodesGroup = null;
    this._edgesGroup = null;
    this._controlsEl = null;
    this._wrapperEl = null;
    this._layoutNodes = [];
    this._layoutEdges = [];
  }

  /* ═══════════════════════════════════════════════════════════
     Layout Algorithm
     ═══════════════════════════════════════════════════════════ */

  /**
   * Recursive layout: computes (x, y) for every node.
   * Returns the subtree height so siblings can be stacked vertically.
   *
   * @param {object} node - tree node
   * @param {number} depth - current depth (determines x)
   * @param {number} offsetY - top y offset for this subtree
   * @param {number} currentDepth - depth counter for maxDepth check
   * @returns {number} subtreeHeight - total vertical space used
   */
  _computeLayout(node, depth, offsetY, currentDepth) {
    const x = PADDING + depth * (NODE_W + H_GAP);

    if (!node.children || node.children.length === 0 || currentDepth >= this._maxDepth) {
      // Leaf node
      const layoutNode = this._makeLayoutNode(node, x, offsetY);
      this._layoutNodes.push(layoutNode);
      return NODE_H;
    }

    // Recurse children, stacking vertically
    let childY = offsetY;
    const childHeights = [];

    for (const child of node.children) {
      const h = this._computeLayout(child, depth + 1, childY, currentDepth + 1);
      childHeights.push(h);
      childY += h + V_GAP;
    }

    // Total subtree height (remove trailing V_GAP)
    const subtreeHeight = childY - offsetY - V_GAP;

    // Center parent among its children
    const parentY = offsetY + (subtreeHeight - NODE_H) / 2;

    const layoutNode = this._makeLayoutNode(node, x, parentY);
    layoutNode._childCount = node.children.length;
    layoutNode._doneCount = node.children.filter(c => c.status === 'done').length;
    this._layoutNodes.push(layoutNode);

    return Math.max(subtreeHeight, NODE_H);
  }

  _makeLayoutNode(node, x, y) {
    return {
      id: node.id,
      title: node.title || 'Untitled',
      type: node.type || 'task',
      status: node.status || 'pending',
      priority: node.priority || 'normal',
      assignee: node.assignee || null,
      children: node.children || [],
      x,
      y,
      _childCount: 0,
      _doneCount: 0,
    };
  }

  /** Collect edges (parent -> child) with computed bezier points */
  _collectEdges(node, depth) {
    if (!node.children || node.children.length === 0 || depth >= this._maxDepth) return;

    const parentLayout = this._layoutNodes.find(n => n.id === node.id);
    if (!parentLayout) return;

    for (const child of node.children) {
      const childLayout = this._layoutNodes.find(n => n.id === child.id);
      if (!childLayout) continue;

      // Compute bezier path from parent right-center to child left-center
      const x1 = parentLayout.x + NODE_W;
      const y1 = parentLayout.y + NODE_H / 2;
      const x2 = childLayout.x;
      const y2 = childLayout.y + NODE_H / 2;

      const dx = x2 - x1;
      const cx1 = x1 + dx * 0.4;
      const cx2 = x2 - dx * 0.4;

      // Determine link style based on relationship type
      const linkType = child._linkType || 'child'; // child, dependency, related, deprecated
      const linkStyles = {
        child:      { dash: 'none',   width: 2,   opacity: 0.55 },
        dependency: { dash: '8,4',    width: 2,   opacity: 0.7  },
        related:    { dash: '3,3',    width: 1.5, opacity: 0.35 },
        deprecated: { dash: '4,4',    width: 1,   opacity: 0.2  },
        blocked:    { dash: '6,3,2,3',width: 2,   opacity: 0.7  },
      };
      const ls = linkStyles[linkType] || linkStyles.child;

      this._layoutEdges.push({
        parentId: node.id,
        childId: child.id,
        d: `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`,
        color: linkType === 'blocked' ? '#f87171' : linkType === 'dependency' ? '#fb923c' : linkType === 'deprecated' ? '#475569' : (TYPE_COLORS[child.type] || TYPE_COLORS.task),
        statusColor: STATUS_COLORS[child.status] || STATUS_COLORS.pending,
        linkType,
        dash: ls.dash,
        width: ls.width,
        opacity: ls.opacity,
        dotParent: { x: x1, y: y1 },
        dotChild: { x: x2, y: y2 },
      });

      this._collectEdges(child, depth + 1);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     DOM Construction
     ═══════════════════════════════════════════════════════════ */

  _buildDOM() {
    // Wrapper
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'width:100%;height:100%;overflow:hidden;position:relative;background:#0d1117;';
    this._wrapperEl = wrapper;

    // SVG
    const svg = document.createElementNS(this._svgNS, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.cssText = 'cursor:grab;display:block;';
    this._svg = svg;

    // Defs for reusable elements (filters, animations)
    const defs = document.createElementNS(this._svgNS, 'defs');

    // Glow filter for in-progress nodes
    const glowFilter = document.createElementNS(this._svgNS, 'filter');
    glowFilter.setAttribute('id', 'active-glow');
    glowFilter.setAttribute('x', '-30%');
    glowFilter.setAttribute('y', '-30%');
    glowFilter.setAttribute('width', '160%');
    glowFilter.setAttribute('height', '160%');
    const blur = document.createElementNS(this._svgNS, 'feGaussianBlur');
    blur.setAttribute('stdDeviation', '4');
    blur.setAttribute('result', 'glow');
    glowFilter.appendChild(blur);
    const merge = document.createElementNS(this._svgNS, 'feMerge');
    const mergeGlow = document.createElementNS(this._svgNS, 'feMergeNode');
    mergeGlow.setAttribute('in', 'glow');
    merge.appendChild(mergeGlow);
    const mergeOrig = document.createElementNS(this._svgNS, 'feMergeNode');
    mergeOrig.setAttribute('in', 'SourceGraphic');
    merge.appendChild(mergeOrig);
    glowFilter.appendChild(merge);
    defs.appendChild(glowFilter);

    // Aurora glow animation style
    const style = document.createElementNS(this._svgNS, 'style');
    style.textContent = `
      @keyframes aurora-pulse {
        0%   { filter: url(#active-glow); opacity: 1; }
        50%  { filter: url(#active-glow); opacity: 0.85; }
        100% { filter: url(#active-glow); opacity: 1; }
      }
      .tree-node-active {
        animation: aurora-pulse 2s ease-in-out infinite;
        filter: url(#active-glow);
      }
      .tree-node-active rect:first-child {
        stroke: #38bdf8;
        stroke-width: 1.5;
      }
      .tree-node-done { opacity: 0.55; }
    `;
    defs.appendChild(style);

    svg.appendChild(defs);

    // Main transform group
    const mainGroup = document.createElementNS(this._svgNS, 'g');
    mainGroup.setAttribute('class', 'tree-graph-canvas');
    this._mainGroup = mainGroup;

    // Edges group (rendered behind nodes)
    const edgesGroup = document.createElementNS(this._svgNS, 'g');
    edgesGroup.setAttribute('class', 'tree-graph-edges');
    this._edgesGroup = edgesGroup;
    mainGroup.appendChild(edgesGroup);

    // Nodes group
    const nodesGroup = document.createElementNS(this._svgNS, 'g');
    nodesGroup.setAttribute('class', 'tree-graph-nodes');
    this._nodesGroup = nodesGroup;
    mainGroup.appendChild(nodesGroup);

    svg.appendChild(mainGroup);
    wrapper.appendChild(svg);

    // Zoom controls overlay
    wrapper.appendChild(this._buildControls());

    this._container.appendChild(wrapper);

    // Setup interaction
    this._setupPanZoom();
    this._setupResizeObserver();
  }

  _buildControls() {
    const controls = document.createElement('div');
    controls.style.cssText =
      'position:absolute;bottom:12px;right:12px;display:flex;gap:4px;z-index:10;';

    const btnStyle =
      'width:32px;height:32px;border:1px solid #2d3748;border-radius:6px;' +
      'background:#1a2332;color:#e2e8f0;cursor:pointer;font-size:14px;' +
      'display:flex;align-items:center;justify-content:center;' +
      'transition:background 0.15s,border-color 0.15s;';

    const zoomIn = document.createElement('button');
    zoomIn.style.cssText = btnStyle;
    zoomIn.textContent = '+';
    zoomIn.title = 'Zoom in';
    zoomIn.addEventListener('click', () => {
      this._zoom = clamp(this._zoom * (1 + ZOOM_STEP), MIN_ZOOM, MAX_ZOOM);
      this._applyTransform();
    });

    const zoomOut = document.createElement('button');
    zoomOut.style.cssText = btnStyle;
    zoomOut.textContent = '\u2212';
    zoomOut.title = 'Zoom out';
    zoomOut.addEventListener('click', () => {
      this._zoom = clamp(this._zoom * (1 - ZOOM_STEP), MIN_ZOOM, MAX_ZOOM);
      this._applyTransform();
    });

    const fitBtn = document.createElement('button');
    fitBtn.style.cssText = btnStyle + 'width:auto;padding:0 8px;font-size:11px;';
    fitBtn.textContent = 'Fit';
    fitBtn.title = 'Fit entire tree in view';
    fitBtn.addEventListener('click', () => this.fitToView());

    controls.appendChild(zoomOut);
    controls.appendChild(zoomIn);
    controls.appendChild(fitBtn);
    this._controlsEl = controls;

    return controls;
  }

  /* ═══════════════════════════════════════════════════════════
     SVG Drawing
     ═══════════════════════════════════════════════════════════ */

  _drawEdges() {
    if (!this._edgesGroup) return;

    const frag = document.createDocumentFragment();

    for (const edge of this._layoutEdges) {
      // Bezier path with link-type-specific styling
      const path = document.createElementNS(this._svgNS, 'path');
      path.setAttribute('d', edge.d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', edge.color);
      path.setAttribute('stroke-width', String(edge.width || 2));
      path.setAttribute('stroke-opacity', String(edge.opacity || 0.5));
      if (edge.dash && edge.dash !== 'none') {
        path.setAttribute('stroke-dasharray', edge.dash);
      }
      path.setAttribute('data-parent', edge.parentId);
      path.setAttribute('data-child', edge.childId);
      path.setAttribute('data-link-type', edge.linkType || 'child');
      frag.appendChild(path);

      // Junction dot at child end
      const dot = document.createElementNS(this._svgNS, 'circle');
      dot.setAttribute('cx', String(edge.dotChild.x));
      dot.setAttribute('cy', String(edge.dotChild.y));
      dot.setAttribute('r', '4');
      dot.setAttribute('fill', edge.statusColor);
      dot.setAttribute('stroke', DOT_STROKE);
      dot.setAttribute('stroke-width', '1.5');
      frag.appendChild(dot);
    }

    this._edgesGroup.appendChild(frag);
  }

  _drawNodes() {
    if (!this._nodesGroup) return;

    const frag = document.createDocumentFragment();

    for (const node of this._layoutNodes) {
      frag.appendChild(this._createNodeElement(node));
    }

    this._nodesGroup.appendChild(frag);
  }

  _createNodeElement(node) {
    const ns = this._svgNS;
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
    g.setAttribute('data-node-id', node.id);
    g.style.cursor = 'pointer';
    // Status-based visual effects
    if (node.status === 'in-progress') g.setAttribute('class', 'tree-node-active');
    else if (node.status === 'done') g.setAttribute('class', 'tree-node-done');

    const statusColor = STATUS_COLORS[node.status] || STATUS_COLORS.pending;
    const typeColor = TYPE_COLORS[node.type] || TYPE_COLORS.task;

    // Background rect with rounded corners
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(NODE_W));
    rect.setAttribute('height', String(NODE_H));
    rect.setAttribute('rx', '6');
    rect.setAttribute('ry', '6');
    rect.setAttribute('fill', NODE_BG);
    rect.setAttribute('stroke', NODE_STROKE);
    rect.setAttribute('stroke-width', '1');
    g.appendChild(rect);

    // Status bar on left edge
    const statusRect = document.createElementNS(ns, 'rect');
    statusRect.setAttribute('x', '0');
    statusRect.setAttribute('y', '0');
    statusRect.setAttribute('width', String(STATUS_BAR_W));
    statusRect.setAttribute('height', String(NODE_H));
    statusRect.setAttribute('rx', '3');
    statusRect.setAttribute('fill', statusColor);
    // Clip the right side of the radius to be flat
    const clipRect = document.createElementNS(ns, 'rect');
    clipRect.setAttribute('x', '2');
    clipRect.setAttribute('y', '0');
    clipRect.setAttribute('width', '4');
    clipRect.setAttribute('height', String(NODE_H));
    clipRect.setAttribute('fill', statusColor);
    g.appendChild(statusRect);
    g.appendChild(clipRect);

    // Right-side connection dot for parent nodes
    if (node._childCount > 0) {
      const rightDot = document.createElementNS(ns, 'circle');
      rightDot.setAttribute('cx', String(NODE_W));
      rightDot.setAttribute('cy', String(NODE_H / 2));
      rightDot.setAttribute('r', '5');
      rightDot.setAttribute('fill', typeColor);
      rightDot.setAttribute('stroke', DOT_STROKE);
      rightDot.setAttribute('stroke-width', '2');
      g.appendChild(rightDot);
    }

    // Type icon (emoji as text)
    const icon = document.createElementNS(ns, 'text');
    icon.setAttribute('x', '14');
    icon.setAttribute('y', String(NODE_H / 2 + 5));
    icon.setAttribute('font-size', '13');
    icon.setAttribute('text-anchor', 'middle');
    icon.textContent = TYPE_ICONS[node.type] || TYPE_ICONS.task;
    g.appendChild(icon);

    // Title text
    const titleText = document.createElementNS(ns, 'text');
    titleText.setAttribute('x', '26');
    titleText.setAttribute('y', String(NODE_H / 2 + 4));
    titleText.setAttribute('fill', TEXT_FILL);
    titleText.setAttribute('font-size', '11');
    titleText.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');

    const maxTitleW = node._childCount > 0 ? 110 : 140;
    const maxChars = Math.floor(maxTitleW / 6.5);
    const truncTitle = node.title.length > maxChars
      ? node.title.slice(0, maxChars - 1) + '\u2026'
      : node.title;
    titleText.textContent = truncTitle;
    g.appendChild(titleText);

    // Child count badge on right side
    if (node._childCount > 0) {
      // Badge background
      const badgeBg = document.createElementNS(ns, 'rect');
      const badgeText = `${node._doneCount}/${node._childCount}`;
      const badgeW = badgeText.length * 6 + 10;
      badgeBg.setAttribute('x', String(NODE_W - badgeW - 10));
      badgeBg.setAttribute('y', String(NODE_H / 2 - 8));
      badgeBg.setAttribute('width', String(badgeW));
      badgeBg.setAttribute('height', '16');
      badgeBg.setAttribute('rx', '8');
      badgeBg.setAttribute('fill', BADGE_BG);
      g.appendChild(badgeBg);

      const badge = document.createElementNS(ns, 'text');
      badge.setAttribute('x', String(NODE_W - badgeW / 2 - 10));
      badge.setAttribute('y', String(NODE_H / 2 + 3));
      badge.setAttribute('fill', TEXT_FILL_MUTED);
      badge.setAttribute('font-size', '9');
      badge.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
      badge.setAttribute('text-anchor', 'middle');
      badge.textContent = badgeText;
      g.appendChild(badge);
    }

    // SVG <title> for native tooltip
    const tooltip = document.createElementNS(ns, 'title');
    const tipParts = [node.title, `Type: ${node.type}`, `Status: ${node.status}`];
    if (node.priority && node.priority !== 'normal') tipParts.push(`Priority: ${node.priority}`);
    if (node._childCount > 0) tipParts.push(`Children: ${node._childCount} (${node._doneCount} done)`);
    if (node.assignee) tipParts.push(`Assignee: ${node.assignee}`);
    tooltip.textContent = tipParts.join('\n');
    g.appendChild(tooltip);

    // Hover interactions
    g.addEventListener('mouseenter', () => {
      rect.setAttribute('fill', NODE_BG_HOVER);
      rect.setAttribute('stroke', NODE_STROKE_HOVER);
      rect.setAttribute('stroke-width', '2');
      // Highlight connected edges
      this._highlightEdges(node.id, true);
    });

    g.addEventListener('mouseleave', () => {
      rect.setAttribute('fill', NODE_BG);
      rect.setAttribute('stroke', NODE_STROKE);
      rect.setAttribute('stroke-width', '1');
      this._highlightEdges(node.id, false);
    });

    // Click
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._onNodeClick) {
        this._onNodeClick({
          id: node.id,
          title: node.title,
          type: node.type,
          status: node.status,
          priority: node.priority,
          childCount: node._childCount,
        });
      }
    });

    return g;
  }

  /** Highlight or un-highlight edges connected to a node */
  _highlightEdges(nodeId, highlight) {
    if (!this._edgesGroup) return;
    const paths = this._edgesGroup.querySelectorAll('path');
    for (const p of paths) {
      if (p.getAttribute('data-parent') === String(nodeId) ||
          p.getAttribute('data-child') === String(nodeId)) {
        if (highlight) {
          p.setAttribute('stroke-opacity', '1');
          p.setAttribute('stroke-width', '3');
        } else {
          p.setAttribute('stroke-opacity', '0.5');
          p.setAttribute('stroke-width', '2');
        }
      }
    }
  }

  /** Briefly flash a node to draw attention */
  _highlightNode(nodeId) {
    if (!this._nodesGroup) return;
    const nodeG = this._nodesGroup.querySelector(`[data-node-id="${nodeId}"]`);
    if (!nodeG) return;

    const rect = nodeG.querySelector('rect');
    if (!rect) return;

    const origFill = rect.getAttribute('fill');
    const origStroke = rect.getAttribute('stroke');

    rect.setAttribute('fill', '#2d4a6f');
    rect.setAttribute('stroke', '#60a5fa');
    rect.setAttribute('stroke-width', '3');

    setTimeout(() => {
      rect.setAttribute('fill', origFill);
      rect.setAttribute('stroke', origStroke);
      rect.setAttribute('stroke-width', '1');
    }, 1200);
  }

  /* ═══════════════════════════════════════════════════════════
     Pan & Zoom
     ═══════════════════════════════════════════════════════════ */

  _setupPanZoom() {
    if (!this._svg) return;

    // Mouse down on empty space => start pan
    const onMouseDown = (e) => {
      // Only pan when clicking empty space (not a node)
      if (e.target.closest('[data-node-id]')) return;
      this._isPanning = true;
      this._panStart = { x: e.clientX, y: e.clientY };
      this._panStartOffset = { x: this._pan.x, y: this._pan.y };
      this._svg.style.cursor = 'grabbing';
      e.preventDefault();
    };

    const onMouseMove = (e) => {
      if (!this._isPanning) return;
      const dx = e.clientX - this._panStart.x;
      const dy = e.clientY - this._panStart.y;
      this._pan.x = this._panStartOffset.x + dx;
      this._pan.y = this._panStartOffset.y + dy;
      this._scheduleTransform();
    };

    const onMouseUp = () => {
      if (this._isPanning) {
        this._isPanning = false;
        if (this._svg) this._svg.style.cursor = 'grab';
      }
    };

    // Wheel zoom (centered on cursor)
    const onWheel = (e) => {
      e.preventDefault();
      const rect = this._svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const oldZoom = this._zoom;
      const delta = e.deltaY > 0 ? (1 - ZOOM_STEP) : (1 + ZOOM_STEP);
      this._zoom = clamp(this._zoom * delta, MIN_ZOOM, MAX_ZOOM);

      // Adjust pan so zoom is centered on cursor position
      const ratio = this._zoom / oldZoom;
      this._pan.x = mouseX - ratio * (mouseX - this._pan.x);
      this._pan.y = mouseY - ratio * (mouseY - this._pan.y);

      this._scheduleTransform();
    };

    this._svg.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    this._svg.addEventListener('wheel', onWheel, { passive: false });

    // Touch support for mobile
    let touchStart = null;
    let touchDist = null;

    const onTouchStart = (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        this._isPanning = true;
        this._panStart = { x: t.clientX, y: t.clientY };
        this._panStartOffset = { x: this._pan.x, y: this._pan.y };
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchDist = Math.sqrt(dx * dx + dy * dy);
      }
    };

    const onTouchMove = (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && this._isPanning) {
        const t = e.touches[0];
        const dx = t.clientX - this._panStart.x;
        const dy = t.clientY - this._panStart.y;
        this._pan.x = this._panStartOffset.x + dx;
        this._pan.y = this._panStartOffset.y + dy;
        this._scheduleTransform();
      } else if (e.touches.length === 2 && touchDist) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const newDist = Math.sqrt(dx * dx + dy * dy);
        const scale = newDist / touchDist;
        this._zoom = clamp(this._zoom * scale, MIN_ZOOM, MAX_ZOOM);
        touchDist = newDist;
        this._scheduleTransform();
      }
    };

    const onTouchEnd = () => {
      this._isPanning = false;
      touchDist = null;
    };

    this._svg.addEventListener('touchstart', onTouchStart, { passive: false });
    this._svg.addEventListener('touchmove', onTouchMove, { passive: false });
    this._svg.addEventListener('touchend', onTouchEnd);

    this._cleanupFns.push(
      () => this._svg?.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mousemove', onMouseMove),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => this._svg?.removeEventListener('wheel', onWheel),
      () => this._svg?.removeEventListener('touchstart', onTouchStart),
      () => this._svg?.removeEventListener('touchmove', onTouchMove),
      () => this._svg?.removeEventListener('touchend', onTouchEnd),
    );
  }

  _scheduleTransform() {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this._applyTransform();
    });
  }

  _applyTransform() {
    if (!this._mainGroup) return;
    this._mainGroup.setAttribute(
      'transform',
      `translate(${this._pan.x}, ${this._pan.y}) scale(${this._zoom})`
    );
  }

  _setupResizeObserver() {
    if (!this._wrapperEl || typeof ResizeObserver === 'undefined') return;

    this._resizeObserver = new ResizeObserver(() => {
      // Debounce resize handling
      if (this._resizeTimer) clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => {
        this._resizeTimer = null;
      }, 200);
    });
    this._resizeObserver.observe(this._wrapperEl);
  }
}
