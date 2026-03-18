/**
 * Pulse Dashboard Stress Test Seed Script
 *
 * Populates the Pulse Dashboard building with realistic data
 * to exercise every Overlord feature end-to-end.
 *
 * Run with: node scripts/pulse-stress-test.cjs
 * Requires: dev server running at http://localhost:4000
 */

const { io } = require('socket.io-client');

const SERVER = 'http://localhost:4000';
let socket;
let buildingId;

function emit(event, data) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout: ${event}`)), 10000);
    socket.emit(event, data, (res) => {
      clearTimeout(timeout);
      resolve(res);
    });
  });
}

async function findPulseBuilding() {
  const res = await emit('building:list', {});
  if (!res?.ok) throw new Error('Failed to list buildings');
  const buildings = Array.isArray(res.data) ? res.data : (res.data?.buildings || []);
  const pulse = buildings.find(b => b.name.includes('Pulse'));
  if (!pulse) throw new Error('Pulse Dashboard building not found — create it first');
  buildingId = pulse.id;
  console.log(`Found Pulse Dashboard: ${buildingId}`);
  return pulse;
}

async function createTasks() {
  console.log('\n--- Creating Tasks ---');
  const tasks = [
    // Architecture phase tasks
    { title: 'Define component architecture', description: 'Design the React component tree, state management approach, and data flow patterns.', priority: 'high', phase: 'architecture' },
    { title: 'Database schema design', description: 'Define PostgreSQL schema for metrics, alerts, dashboards, and user preferences.', priority: 'high', phase: 'architecture' },
    { title: 'API endpoint specification', description: 'Document REST + WebSocket API endpoints with request/response schemas.', priority: 'high', phase: 'architecture' },
    { title: 'Authentication flow design', description: 'Design OAuth2 + JWT auth with role-based access control (admin, viewer, editor).', priority: 'medium', phase: 'architecture' },
    { title: 'Real-time data pipeline design', description: 'WebSocket pub/sub for live metric updates. Design backpressure handling.', priority: 'medium', phase: 'architecture' },

    // Execution phase tasks
    { title: 'Dashboard grid layout component', description: 'Responsive CSS Grid layout with drag-and-drop widget repositioning.', priority: 'high', phase: 'execution' },
    { title: 'Metric card widget', description: 'Reusable card showing a single KPI with sparkline, trend arrow, and threshold coloring.', priority: 'high', phase: 'execution' },
    { title: 'Line chart widget', description: 'Time-series chart with zoom, pan, and annotation support using D3.js.', priority: 'high', phase: 'execution' },
    { title: 'Alert configuration panel', description: 'Form for creating threshold-based alerts with email/Slack notification channels.', priority: 'medium', phase: 'execution' },
    { title: 'User settings page', description: 'Profile, notification preferences, dashboard layout persistence, theme selection.', priority: 'low', phase: 'execution' },
    { title: 'Data source connector', description: 'Plugin system for connecting external data sources (Prometheus, Datadog, custom APIs).', priority: 'high', phase: 'execution' },
    { title: 'Search and filter toolbar', description: 'Global search across dashboards, metrics, and alerts with saved filter presets.', priority: 'medium', phase: 'execution' },
    { title: 'Export/import dashboards', description: 'JSON export of dashboard layouts with import validation and conflict resolution.', priority: 'low', phase: 'execution' },

    // Review phase tasks
    { title: 'Security audit', description: 'Pen-test auth endpoints, validate CSRF/XSS protections, review RBAC enforcement.', priority: 'high', phase: 'review' },
    { title: 'Performance benchmark', description: 'Load test with 1000 concurrent WebSocket connections. Target: <100ms p99 latency.', priority: 'high', phase: 'review' },
    { title: 'Accessibility review', description: 'WCAG 2.1 AA compliance check. Screen reader testing. Keyboard navigation audit.', priority: 'medium', phase: 'review' },

    // Deploy phase tasks
    { title: 'CI/CD pipeline setup', description: 'GitHub Actions: lint → test → build → deploy to staging → smoke test → production.', priority: 'high', phase: 'deploy' },
    { title: 'Monitoring and alerting', description: 'Set up Grafana dashboards for the dashboard itself. Meta-monitoring.', priority: 'medium', phase: 'deploy' },
  ];

  const created = [];
  for (const task of tasks) {
    const res = await emit('task:create', {
      buildingId,
      title: task.title,
      description: task.description,
      priority: task.priority,
      phase: task.phase,
    });
    if (res?.ok) {
      created.push({ id: res.data.id, ...task });
      console.log(`  + Task: ${task.title}`);
    } else {
      console.log(`  ! Failed: ${task.title} — ${res?.error?.message || 'unknown'}`);
    }
  }
  return created;
}

async function createRaidEntries() {
  console.log('\n--- Creating RAID Entries ---');
  const entries = [
    // Risks
    { type: 'risk', summary: 'WebSocket scalability under 10K concurrent connections', rationale: 'Current architecture uses a single server node. Need horizontal scaling plan before production launch. Redis pub/sub adapter required.', affectedAreas: ['architecture', 'operations'] },
    { type: 'risk', summary: 'Third-party data source API rate limits', rationale: 'Prometheus and Datadog APIs have rate limits that could throttle dashboard updates during peak usage. Need caching layer.', affectedAreas: ['execution', 'architecture'] },
    { type: 'risk', summary: 'Browser memory leak from long-running WebSocket connections', rationale: 'D3.js chart re-renders accumulate detached DOM nodes. Need cleanup strategy for dashboard sessions >4 hours.', affectedAreas: ['execution'] },

    // Assumptions
    { type: 'assumption', summary: 'Users have modern browsers (Chrome 90+, Firefox 88+, Safari 15+)', rationale: 'Using CSS Grid, WebSocket API, and ES2020 features without polyfills. IE11 not supported.', affectedAreas: ['architecture'] },
    { type: 'assumption', summary: 'PostgreSQL 14+ available in all deployment environments', rationale: 'Using JSONB columns, generated columns, and pg_trgm for full-text search.', affectedAreas: ['architecture', 'operations'] },
    { type: 'assumption', summary: 'Maximum 50 widgets per dashboard', rationale: 'Performance testing assumes <=50 widgets. Beyond this, lazy rendering would be needed.', affectedAreas: ['execution'] },

    // Issues
    { type: 'issue', summary: 'D3.js bundle size is 250KB — impacts initial load time', rationale: 'Tree-shaking only reduces to 180KB. Consider switching to Plotly.js or building custom SVG renderer.', affectedAreas: ['execution'] },
    { type: 'issue', summary: 'OAuth2 refresh token rotation not implemented', rationale: 'Current auth uses long-lived tokens (7 days). Need refresh rotation for security compliance.', affectedAreas: ['architecture', 'review'] },

    // Decisions
    { type: 'decision', summary: 'Adopted React 18 with Server Components for SSR', rationale: 'Server Components reduce client bundle by ~40%. Streaming SSR improves TTFB. Team has React expertise.', affectedAreas: ['architecture', 'execution'] },
    { type: 'decision', summary: 'PostgreSQL chosen over MongoDB for metrics storage', rationale: 'Time-series data benefits from B-tree indexes and window functions. JSONB provides schema flexibility where needed.', affectedAreas: ['architecture'] },
    { type: 'decision', summary: 'WebSocket over Server-Sent Events for real-time updates', rationale: 'Need bidirectional communication for interactive dashboard features (drag-and-drop sync, collaborative editing).', affectedAreas: ['architecture'] },
  ];

  for (const entry of entries) {
    const res = await emit('raid:add', {
      buildingId,
      type: entry.type,
      phase: 'architecture',
      summary: entry.summary,
      rationale: entry.rationale,
      affectedAreas: entry.affectedAreas,
    });
    if (res?.ok) {
      console.log(`  + ${entry.type.toUpperCase()}: ${entry.summary.slice(0, 60)}...`);
    } else {
      console.log(`  ! Failed: ${entry.summary.slice(0, 40)}... — ${res?.error?.message || 'unknown'}`);
    }
  }
}

async function createMilestone() {
  console.log('\n--- Creating Milestone ---');
  const res = await emit('milestone:create', {
    buildingId,
    title: 'v0.1.0 — Architecture Complete',
    description: 'All architecture decisions documented, component tree finalized, API spec reviewed, database schema approved. Ready for execution phase.',
    targetDate: '2026-04-15',
  });
  if (res?.ok) {
    console.log(`  + Milestone: v0.1.0 — Architecture Complete`);
    return res.data.id;
  }
  console.log(`  ! Milestone failed: ${res?.error?.message || 'unknown'}`);
  return null;
}

async function assignAgentsToTasks(tasks) {
  console.log('\n--- Assigning Agents to Tasks ---');
  // Get agents for this building
  const agentRes = await emit('agent:list', { buildingId });
  if (!agentRes?.ok || !agentRes.data?.length) {
    console.log('  ! No agents found — skipping assignments');
    return;
  }
  const agents = agentRes.data.filter(a => a.id !== '__user__');
  console.log(`  Found ${agents.length} agents`);

  // Assign architecture tasks to architects/analysts
  const architects = agents.filter(a => ['architect', 'analyst', 'lead'].includes(a.role));
  const developers = agents.filter(a => ['developer', 'tester'].includes(a.role));

  for (let i = 0; i < Math.min(tasks.length, 8); i++) {
    const task = tasks[i];
    const pool = task.phase === 'architecture' ? architects : developers;
    const agent = pool[i % pool.length] || agents[i % agents.length];
    if (!agent) continue;

    const res = await emit('task:update', { id: task.id, assigneeId: agent.id });
    if (res?.ok) {
      console.log(`  + Assigned "${task.title.slice(0, 40)}..." → ${agent.display_name || agent.name}`);
    }
  }
}

async function recordPipelineEvidence(tasks) {
  console.log('\n--- Recording Pipeline Evidence ---');
  // Record some pipeline stages for the first few tasks
  const stages = ['code', 'iterate', 'static-test'];
  for (let i = 0; i < Math.min(3, tasks.length); i++) {
    for (const stage of stages) {
      await emit('pipeline:record', {
        taskId: tasks[i].id,
        buildingId,
        stage,
        status: 'passed',
        attempt: 1,
      });
    }
    console.log(`  + ${tasks[i].title.slice(0, 40)}... — 3 stages passed`);
  }
}

async function sendEmails() {
  console.log('\n--- Sending Internal Emails ---');
  const agentRes = await emit('agent:list', { buildingId });
  if (!agentRes?.ok) return;
  const agents = agentRes.data.filter(a => a.id !== '__user__');
  if (agents.length < 2) return;

  const emails = [
    { subject: 'Architecture Review Meeting — Monday 10am', body: 'Team, let\'s review the component architecture and data flow diagrams before finalizing. Bring questions about the WebSocket scaling approach.\n\nAgenda:\n1. Component tree walkthrough\n2. State management decision (Redux vs Zustand)\n3. API schema review\n4. Timeline check' },
    { subject: 'Database Schema — Feedback Needed', body: 'I\'ve drafted the PostgreSQL schema for metrics storage. Key decisions:\n\n- TimescaleDB hypertable for time-series data\n- JSONB for flexible widget configuration\n- Materialized views for dashboard aggregations\n\nPlease review and flag any concerns before I finalize.' },
    { subject: 'Risk: WebSocket Connection Limits', body: 'Flagging a scalability risk. Our current single-node architecture caps at ~5K concurrent WebSocket connections. For the v1.0 target of 10K users, we need:\n\n1. Redis adapter for Socket.IO\n2. Horizontal pod autoscaling\n3. Connection pooling on the client\n\nShould we address this in Architecture or defer to Execution?' },
  ];

  for (let i = 0; i < emails.length; i++) {
    const from = i === 0 ? '__user__' : agents[i % agents.length].id;
    const to = i === 0 ? agents[0].id : '__user__';
    const res = await emit('email:send', {
      fromId: from,
      to: [to],
      subject: emails[i].subject,
      body: emails[i].body,
      buildingId,
    });
    if (res?.ok) {
      console.log(`  + Email: "${emails[i].subject.slice(0, 50)}..."`);
    } else {
      console.log(`  ! Email failed: ${res?.error?.message || 'unknown'}`);
    }
  }
}

async function main() {
  console.log('Pulse Dashboard Stress Test');
  console.log('===========================\n');
  console.log(`Connecting to ${SERVER}...`);

  socket = io(SERVER, { transports: ['websocket'] });

  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 5000);
  });
  console.log('Connected!\n');

  try {
    await findPulseBuilding();

    // Select the building
    await emit('building:select', { buildingId });
    console.log('Building selected\n');

    const tasks = await createTasks();
    await createRaidEntries();
    const milestoneId = await createMilestone();
    await assignAgentsToTasks(tasks);
    await recordPipelineEvidence(tasks);
    await sendEmails();

    // Link tasks to milestone
    if (milestoneId && tasks.length > 0) {
      console.log('\n--- Linking Tasks to Milestone ---');
      for (let i = 0; i < Math.min(5, tasks.length); i++) {
        await emit('task:update', { id: tasks[i].id, milestoneId });
      }
      console.log(`  + Linked ${Math.min(5, tasks.length)} tasks to milestone`);
    }

    console.log('\n===========================');
    console.log('Stress test data populated!');
    console.log(`  Tasks: ${tasks.length}`);
    console.log(`  RAID entries: 11`);
    console.log(`  Milestones: 1`);
    console.log(`  Emails: 3`);
    console.log(`  Pipeline evidence: 9 records`);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    socket.disconnect();
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
