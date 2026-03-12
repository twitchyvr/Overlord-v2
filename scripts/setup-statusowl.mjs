/**
 * StatusOwl — Full Overlord Dogfood Setup
 *
 * Creates the "StatusOwl" building with:
 * - 6 floors (Strategy, Collaboration, Execution, Governance, Operations, Integration)
 * - 8+ rooms across floors with proper types and tool configurations
 * - Tables in each room with appropriate types and chair counts
 * - 6 agents with AI-generated profiles (names, bios, photos)
 * - Full task backlog with table assignments
 * - Todos divided across agents
 * - RAID log entries for key decisions
 *
 * Exercises every Overlord v2 feature: buildings, floors, rooms, tables,
 * agents, profiles, phase gates, tasks, todos, RAID log, exit documents.
 *
 * Usage: node scripts/setup-statusowl.mjs
 */

import { io } from 'socket.io-client';

const SERVER = 'http://localhost:4000';
const TIMEOUT = 30_000;
const PROFILE_TIMEOUT = 120_000; // 2 minutes for AI profile + photo generation

// ─── Helpers ───

function emit(socket, event, data = {}, timeout = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${event}`)), timeout);
    socket.emit(event, data, (res) => {
      clearTimeout(timer);
      if (res && res.ok === false) {
        reject(new Error(`${event} failed: ${res.error?.message || JSON.stringify(res.error)}`));
      } else {
        resolve(res);
      }
    });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(icon, msg) { console.log(`  ${icon}  ${msg}`); }

// ─── Main ───

async function setup() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   StatusOwl — Overlord v2 Dogfood Setup          ║');
  console.log('║   Service Health Monitor & Public Status Page     ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // Connect
  const socket = io(SERVER, { transports: ['websocket'], timeout: 10_000 });
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', (err) => reject(new Error(`Cannot connect to ${SERVER}: ${err.message}`)));
    setTimeout(() => reject(new Error('Connection timeout')), 10_000);
  });
  log('🔌', `Connected to Overlord at ${SERVER} (socket: ${socket.id})`);

  // ════════════════════════════════════════════════════
  // STEP 1: Create Building
  // ════════════════════════════════════════════════════
  console.log('\n── Step 1: Create Building ──');
  const buildingRes = await emit(socket, 'building:create', {
    name: 'StatusOwl',
    description: 'Open-source service health monitor and public status page. Monitors HTTP endpoints, tracks incidents, displays uptime history, and sends webhook alerts.',
  });
  const buildingId = buildingRes.data?.id || buildingRes.id;
  log('🏢', `Building created: ${buildingId}`);

  // Wait for auto-provisioned floors
  await sleep(1000);

  // ════════════════════════════════════════════════════
  // STEP 2: Discover Floors
  // ════════════════════════════════════════════════════
  console.log('\n── Step 2: Discover Floors ──');
  const floorsRes = await emit(socket, 'floor:list', { buildingId });
  const floors = floorsRes.data || floorsRes;
  const floorMap = {};
  for (const f of floors) {
    floorMap[f.type] = f.id;
    log('🏗️', `Floor: ${f.name} (${f.type}) → ${f.id}`);
  }

  // ════════════════════════════════════════════════════
  // STEP 3: Create Rooms
  // ════════════════════════════════════════════════════
  console.log('\n── Step 3: Create Rooms ──');

  const roomDefs = [
    // Strategy floor
    { type: 'strategist', floorId: floorMap['strategy'], name: 'StatusOwl War Room' },
    // Collaboration floor
    { type: 'discovery', floorId: floorMap['collaboration'], name: 'Requirements Lab' },
    { type: 'architecture', floorId: floorMap['collaboration'], name: 'Design Studio' },
    // Execution floor
    { type: 'code-lab', floorId: floorMap['execution'], name: 'Backend Workshop' },
    { type: 'code-lab', floorId: floorMap['execution'], name: 'Frontend Workshop' },
    { type: 'testing-lab', floorId: floorMap['execution'], name: 'QA Lab' },
    // Governance floor
    { type: 'review', floorId: floorMap['governance'], name: 'Code Review Chamber' },
    // Operations floor
    { type: 'deploy', floorId: floorMap['operations'], name: 'Deployment Dock' },
  ];

  const rooms = {};
  for (const def of roomDefs) {
    if (!def.floorId) {
      log('⚠️', `Skipping room "${def.name}" — floor type not found`);
      continue;
    }
    try {
      const res = await emit(socket, 'room:create', def);
      const roomId = res.data?.id || res.id;
      rooms[def.name] = { id: roomId, type: def.type };
      log('🚪', `Room: ${def.name} (${def.type}) → ${roomId}`);
    } catch (err) {
      log('⚠️', `Room "${def.name}" failed: ${err.message}`);
    }
  }

  // ════════════════════════════════════════════════════
  // STEP 4: Configure Rooms (file scope, providers, tools)
  // ════════════════════════════════════════════════════
  console.log('\n── Step 4: Configure Rooms ──');

  // Backend workshop: assigned file scope, anthropic provider
  if (rooms['Backend Workshop']) {
    await emit(socket, 'room:update', {
      roomId: rooms['Backend Workshop'].id,
      fileScope: 'assigned',
      provider: 'minimax',
      allowedTools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'web_search', 'record_note', 'recall_notes'],
    });
    log('⚙️', 'Backend Workshop: assigned scope, anthropic, full dev tools');
  }

  // Frontend workshop: assigned file scope, anthropic provider
  if (rooms['Frontend Workshop']) {
    await emit(socket, 'room:update', {
      roomId: rooms['Frontend Workshop'].id,
      fileScope: 'assigned',
      provider: 'minimax',
      allowedTools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'web_search', 'fetch_webpage', 'record_note', 'recall_notes'],
    });
    log('⚙️', 'Frontend Workshop: assigned scope, anthropic, full dev tools + web');
  }

  // QA Lab: read-only, all QA tools
  if (rooms['QA Lab']) {
    await emit(socket, 'room:update', {
      roomId: rooms['QA Lab'].id,
      fileScope: 'read-only',
      provider: 'minimax',
      allowedTools: ['read_file', 'list_dir', 'bash', 'qa_run_tests', 'qa_check_lint', 'qa_check_types', 'qa_check_coverage', 'qa_audit_deps'],
    });
    log('⚙️', 'QA Lab: read-only scope, full QA toolset');
  }

  // Code Review Chamber: read-only
  if (rooms['Code Review Chamber']) {
    await emit(socket, 'room:update', {
      roomId: rooms['Code Review Chamber'].id,
      fileScope: 'read-only',
      provider: 'minimax',
    });
    log('⚙️', 'Code Review Chamber: read-only scope');
  }

  // ════════════════════════════════════════════════════
  // STEP 5: Create Tables
  // ════════════════════════════════════════════════════
  console.log('\n── Step 5: Create Tables ──');

  const tableDefs = [
    // Strategy — one boardroom table for the strategist
    { roomName: 'StatusOwl War Room', type: 'boardroom', chairs: 6, description: 'Strategic planning for StatusOwl project scope and agent coordination' },
    // Discovery — collaboration table
    { roomName: 'Requirements Lab', type: 'collaboration', chairs: 4, description: 'Requirements gathering and competitive analysis for monitoring tools' },
    // Architecture — collaboration table
    { roomName: 'Design Studio', type: 'collaboration', chairs: 4, description: 'System architecture design — API contracts, DB schema, component structure' },
    // Backend — focus tables for individual work
    { roomName: 'Backend Workshop', type: 'focus', chairs: 1, description: 'Express server, health check engine, incident API' },
    { roomName: 'Backend Workshop', type: 'collaboration', chairs: 3, description: 'Backend pair programming and integration work' },
    // Frontend — focus + collab
    { roomName: 'Frontend Workshop', type: 'focus', chairs: 1, description: 'Status dashboard, uptime charts, incident timeline' },
    { roomName: 'Frontend Workshop', type: 'collaboration', chairs: 3, description: 'Frontend pair programming and design review' },
    // QA — collaboration table
    { roomName: 'QA Lab', type: 'collaboration', chairs: 4, description: 'Test execution, coverage analysis, bug tracking' },
    // Review — boardroom
    { roomName: 'Code Review Chamber', type: 'boardroom', chairs: 6, description: 'Go/no-go review with evidence-based verdicts' },
    // Deploy — focus
    { roomName: 'Deployment Dock', type: 'focus', chairs: 2, description: 'Docker containerization and deployment pipeline' },
  ];

  const tables = {};
  for (const def of tableDefs) {
    const room = rooms[def.roomName];
    if (!room) continue;
    try {
      const res = await emit(socket, 'table:create', {
        roomId: room.id,
        type: def.type,
        chairs: def.chairs,
        description: def.description,
      });
      const tableId = res.data?.id || res.id;
      const key = `${def.roomName}:${def.type}`;
      tables[key] = tableId;
      log('🪑', `Table: ${def.roomName} / ${def.type} (${def.chairs} chairs) → ${tableId}`);
    } catch (err) {
      log('⚠️', `Table in "${def.roomName}" failed: ${err.message}`);
    }
  }

  // ════════════════════════════════════════════════════
  // STEP 6: Register Agents
  // ════════════════════════════════════════════════════
  console.log('\n── Step 6: Register Agents ──');

  const agentDefs = [
    {
      name: 'Aria',
      role: 'Senior Product Strategist',
      specialization: 'Product strategy, market analysis, project scoping, roadmap planning. Expert at breaking down complex products into phased delivery plans.',
    },
    {
      name: 'Marcus',
      role: 'Discovery Analyst',
      specialization: 'Requirements engineering, competitive analysis, user research, technical feasibility assessment. Bridges business needs with technical constraints.',
    },
    {
      name: 'Sofia',
      role: 'System Architect',
      specialization: 'Distributed systems design, API architecture, database modeling, scalability patterns. 15 years designing monitoring and observability platforms.',
    },
    {
      name: 'Leo',
      role: 'Backend Engineer',
      specialization: 'Node.js, Express, SQLite, REST APIs, real-time systems (SSE/WebSocket), health check engines, cron scheduling, webhook delivery.',
    },
    {
      name: 'Nina',
      role: 'Frontend Engineer',
      specialization: 'Vanilla JavaScript, responsive dashboards, data visualization (Chart.js), real-time UI updates, accessibility, CSS Grid/Flexbox layouts.',
    },
    {
      name: 'James',
      role: 'QA Lead & Code Reviewer',
      specialization: 'Test automation, E2E testing, code review, security auditing, performance testing. Ensures production readiness with evidence-based verdicts.',
    },
  ];

  const agents = {};
  for (const def of agentDefs) {
    try {
      const res = await emit(socket, 'agent:register', {
        name: def.name,
        role: def.role,
        specialization: def.specialization,
        firstName: def.name, // Use codename as first name — AI will generate matching last name
      });
      const agentId = res.data?.id || res.id;
      agents[def.name] = agentId;
      log('🤖', `Agent: ${def.name} (${def.role}) → ${agentId}`);
    } catch (err) {
      log('⚠️', `Agent "${def.name}" failed: ${err.message}`);
    }
  }

  // ════════════════════════════════════════════════════
  // STEP 7: Generate Full Profiles (AI names, bios, photos)
  // ════════════════════════════════════════════════════
  console.log('\n── Step 7: Generate Agent Profiles (AI-powered) ──');
  console.log('  ⏳ This triggers AI bio generation + MiniMax photo generation...');
  console.log('  ⏳ Each profile takes 10-30 seconds (AI + image generation)...\n');

  const profilePromises = Object.entries(agents).map(async ([name, agentId]) => {
    try {
      const res = await emit(socket, 'agent:generate-profile', {
        agentId,
        capabilities: agentDefs.find(a => a.name === name)?.specialization?.split(', ') || [],
        provider: 'minimax',
      }, PROFILE_TIMEOUT);
      const profile = res.data || res;
      log('📸', `${name}: ${profile.firstName || '?'} ${profile.lastName || '?'} — profile + photo generated`);
      return { name, success: true, profile };
    } catch (err) {
      log('⚠️', `${name} profile generation failed: ${err.message}`);
      return { name, success: false };
    }
  });

  const profileResults = await Promise.allSettled(profilePromises);
  const successCount = profileResults.filter(r => r.status === 'fulfilled' && r.value?.success).length;
  log('✅', `${successCount}/${Object.keys(agents).length} profiles generated`);

  // ════════════════════════════════════════════════════
  // STEP 8: Create Task Backlog
  // ════════════════════════════════════════════════════
  console.log('\n── Step 8: Create Task Backlog ──');

  const taskDefs = [
    // Strategy phase
    { title: 'Define StatusOwl project scope and success criteria', phase: 'strategy', priority: 'critical', description: 'Strategist defines project vision, target users, MVP features, success metrics, and delivery timeline.' },
    // Discovery phase
    { title: 'Research existing monitoring tools and patterns', phase: 'discovery', priority: 'high', description: 'Analyze UptimeRobot, Betterstack, Cachet, Gatus. Identify must-have features, architectural patterns, and UX conventions.' },
    { title: 'Define functional requirements and acceptance criteria', phase: 'discovery', priority: 'high', description: 'Produce requirements document: health check types, dashboard features, incident management, alerting, public status page.' },
    // Architecture phase
    { title: 'Design database schema', phase: 'architecture', priority: 'critical', description: 'SQLite schema for: services, checks, incidents, incident_updates, subscribers, alert_rules. Include indexes and migration plan.' },
    { title: 'Design REST API contracts', phase: 'architecture', priority: 'critical', description: 'OpenAPI-style contracts for all endpoints: /api/services, /api/checks, /api/incidents, /api/status, /api/webhooks.' },
    { title: 'Design frontend component architecture', phase: 'architecture', priority: 'high', description: 'Component tree: StatusDashboard, ServiceCard, UptimeChart, IncidentTimeline, ConfigPanel. State management approach.' },
    // Execution phase — Backend
    { title: 'Build Express server with health check engine', phase: 'execution', priority: 'critical', description: 'Express app setup, SQLite connection, health check scheduler (configurable intervals), HTTP/TCP check types.' },
    { title: 'Build service CRUD API', phase: 'execution', priority: 'high', description: 'POST/GET/PUT/DELETE /api/services. Validate URLs, check intervals (30s-5m), expected status codes.' },
    { title: 'Build incident management API', phase: 'execution', priority: 'high', description: 'POST/GET/PUT /api/incidents with status transitions: investigating → identified → monitoring → resolved.' },
    { title: 'Build webhook alerting system', phase: 'execution', priority: 'medium', description: 'POST /api/webhooks for subscriber registration. Fire webhooks on status change with retry logic (3 attempts, exponential backoff).' },
    { title: 'Build Server-Sent Events endpoint', phase: 'execution', priority: 'medium', description: 'GET /api/events — SSE stream pushing real-time status changes to connected dashboards.' },
    // Execution phase — Frontend
    { title: 'Build status dashboard page', phase: 'execution', priority: 'critical', description: 'Main dashboard: service grid with status indicators (up/down/degraded), last check time, response latency.' },
    { title: 'Build uptime history charts', phase: 'execution', priority: 'high', description: '90-day uptime bars per service. Daily/hourly granularity toggle. Tooltip with check count and avg latency.' },
    { title: 'Build incident timeline', phase: 'execution', priority: 'high', description: 'Chronological incident feed with status badges, updates, duration. Filter by service and severity.' },
    { title: 'Build service configuration UI', phase: 'execution', priority: 'medium', description: 'Add/edit/delete services form. URL input, interval selector, expected status, custom headers.' },
    { title: 'Build public status page', phase: 'execution', priority: 'medium', description: 'Shareable /status page: current status, 90-day uptime, active incidents. No auth required.' },
    // Review phase
    { title: 'Comprehensive code review and security audit', phase: 'review', priority: 'critical', description: 'Review all code for: input validation, SQL injection prevention, XSS, error handling, test coverage >80%.' },
    // Deploy phase
    { title: 'Docker containerization and deployment', phase: 'deploy', priority: 'high', description: 'Dockerfile, docker-compose.yml, health check endpoint, environment variables, volume for SQLite persistence.' },
  ];

  const tasks = {};
  for (const def of taskDefs) {
    try {
      const res = await emit(socket, 'task:create', {
        buildingId,
        title: def.title,
        description: def.description,
        phase: def.phase,
        priority: def.priority,
        status: 'pending',
      });
      const taskId = res.data?.id || res.id;
      tasks[def.title] = taskId;
      log('📋', `Task: [${def.phase}/${def.priority}] ${def.title.substring(0, 60)}...`);
    } catch (err) {
      log('⚠️', `Task failed: ${err.message}`);
    }
  }

  // ════════════════════════════════════════════════════
  // STEP 9: Assign Tasks to Tables
  // ════════════════════════════════════════════════════
  console.log('\n── Step 9: Assign Tasks to Tables ──');

  const tableAssignments = [
    // Backend tasks → Backend Workshop focus table
    { taskTitle: 'Build Express server with health check engine', tableName: 'Backend Workshop:focus' },
    { taskTitle: 'Build service CRUD API', tableName: 'Backend Workshop:focus' },
    { taskTitle: 'Build incident management API', tableName: 'Backend Workshop:focus' },
    { taskTitle: 'Build webhook alerting system', tableName: 'Backend Workshop:collaboration' },
    { taskTitle: 'Build Server-Sent Events endpoint', tableName: 'Backend Workshop:collaboration' },
    // Frontend tasks → Frontend Workshop focus table
    { taskTitle: 'Build status dashboard page', tableName: 'Frontend Workshop:focus' },
    { taskTitle: 'Build uptime history charts', tableName: 'Frontend Workshop:focus' },
    { taskTitle: 'Build incident timeline', tableName: 'Frontend Workshop:focus' },
    { taskTitle: 'Build service configuration UI', tableName: 'Frontend Workshop:collaboration' },
    { taskTitle: 'Build public status page', tableName: 'Frontend Workshop:collaboration' },
  ];

  for (const assign of tableAssignments) {
    const taskId = tasks[assign.taskTitle];
    const tableId = tables[assign.tableName];
    if (!taskId || !tableId) continue;
    try {
      await emit(socket, 'task:assign-table', { taskId, tableId });
      log('📌', `Assigned: "${assign.taskTitle.substring(0, 45)}..." → ${assign.tableName}`);
    } catch (err) {
      log('⚠️', `Assignment failed: ${err.message}`);
    }
  }

  // ════════════════════════════════════════════════════
  // STEP 10: Create Todos for Execution Tasks
  // ════════════════════════════════════════════════════
  console.log('\n── Step 10: Create Todos ──');

  const todoDefs = [
    // Backend server task todos
    { taskTitle: 'Build Express server with health check engine', todos: [
      { desc: 'Set up Express app with middleware (cors, json, error handler)', agent: 'Leo' },
      { desc: 'Create SQLite schema migration for services and checks tables', agent: 'Leo' },
      { desc: 'Implement health check scheduler with configurable intervals', agent: 'Leo' },
      { desc: 'Add HTTP check executor with timeout and retry', agent: 'Leo' },
      { desc: 'Write unit tests for health check engine', agent: 'James' },
    ]},
    // Service CRUD todos
    { taskTitle: 'Build service CRUD API', todos: [
      { desc: 'POST /api/services — validate URL, interval, expected status', agent: 'Leo' },
      { desc: 'GET /api/services — list with pagination and status filter', agent: 'Leo' },
      { desc: 'PUT /api/services/:id — update service config', agent: 'Leo' },
      { desc: 'DELETE /api/services/:id — cascade delete checks', agent: 'Leo' },
    ]},
    // Dashboard todos
    { taskTitle: 'Build status dashboard page', todos: [
      { desc: 'Create main HTML layout with header, service grid, sidebar', agent: 'Nina' },
      { desc: 'Build ServiceCard component with status indicator and latency', agent: 'Nina' },
      { desc: 'Add SSE connection for real-time status updates', agent: 'Nina' },
      { desc: 'Implement responsive grid layout (mobile + desktop)', agent: 'Nina' },
      { desc: 'Add CSS animations for status transitions', agent: 'Nina' },
    ]},
    // Uptime chart todos
    { taskTitle: 'Build uptime history charts', todos: [
      { desc: 'Build 90-day uptime bar visualization (pure CSS/SVG)', agent: 'Nina' },
      { desc: 'Add daily/hourly granularity toggle', agent: 'Nina' },
      { desc: 'Calculate uptime percentage from check history', agent: 'Nina' },
    ]},
  ];

  for (const group of todoDefs) {
    const taskId = tasks[group.taskTitle];
    if (!taskId) continue;
    for (const todo of group.todos) {
      const agentId = agents[todo.agent];
      try {
        await emit(socket, 'todo:create', {
          taskId,
          description: todo.desc,
          agentId: agentId || undefined,
        });
        log('☑️', `Todo [${todo.agent}]: ${todo.desc.substring(0, 55)}...`);
      } catch (err) {
        log('⚠️', `Todo failed: ${err.message}`);
      }
    }
  }

  // ════════════════════════════════════════════════════
  // STEP 11: Add RAID Log Entries
  // ════════════════════════════════════════════════════
  console.log('\n── Step 11: Add RAID Log Entries ──');

  const raidEntries = [
    { type: 'decision', phase: 'strategy', summary: 'Use SQLite for persistence — single-file DB, zero-config, adequate for monitoring use case. Migrate to Postgres if >1000 services needed.' },
    { type: 'decision', phase: 'strategy', summary: 'Use Server-Sent Events (SSE) over WebSocket for real-time dashboard updates — simpler, HTTP-native, sufficient for one-way status pushes.' },
    { type: 'decision', phase: 'strategy', summary: 'Vanilla JavaScript frontend — no framework dependency, fast load times, align with Overlord UI patterns.' },
    { type: 'risk', phase: 'architecture', summary: 'Health check intervals below 30 seconds may cause rate limiting on monitored services. Mitigation: enforce minimum 30s interval, add User-Agent header.' },
    { type: 'risk', phase: 'architecture', summary: 'SQLite concurrent writes during high check volume. Mitigation: WAL mode, batch inserts, prune old checks (>90 days).' },
    { type: 'assumption', phase: 'discovery', summary: 'Target users are small-to-medium engineering teams (5-50 services). Not designed for enterprise-scale (1000+ services).' },
    { type: 'assumption', phase: 'discovery', summary: 'Self-hosted deployment — Docker single-container. No cloud-native/Kubernetes requirement for MVP.' },
    { type: 'issue', phase: 'execution', summary: 'Need to determine Chart.js vs pure SVG for uptime visualization. Chart.js adds 60KB but provides animation/tooltip support. Decision deferred to frontend agent.' },
  ];

  for (const entry of raidEntries) {
    try {
      await emit(socket, 'raid:add', {
        buildingId,
        type: entry.type,
        phase: entry.phase,
        summary: entry.summary,
      });
      log('📝', `RAID [${entry.type}]: ${entry.summary.substring(0, 60)}...`);
    } catch (err) {
      log('⚠️', `RAID entry failed: ${err.message}`);
    }
  }

  // ════════════════════════════════════════════════════
  // STEP 12: Set Table Context (Team Coordination)
  // ════════════════════════════════════════════════════
  console.log('\n── Step 12: Set Table Context ──');

  const contextDefs = [
    {
      tableName: 'Backend Workshop:focus',
      context: {
        objective: 'Build the StatusOwl backend: Express server, health check engine, service CRUD, incident management, webhook alerting',
        fileScope: 'statusowl/server/,statusowl/shared/',
        constraints: 'SQLite only, no ORM, WAL mode, prepared statements for all queries',
        techStack: 'Node.js, Express, better-sqlite3, node-cron',
      }
    },
    {
      tableName: 'Frontend Workshop:focus',
      context: {
        objective: 'Build the StatusOwl frontend: status dashboard, uptime charts, incident timeline, service config UI, public status page',
        fileScope: 'statusowl/public/,statusowl/shared/',
        constraints: 'Vanilla JS only, no framework, must work without JavaScript disabled (progressive enhancement)',
        techStack: 'HTML5, CSS3 (Grid/Flexbox), vanilla JS ES modules, SSE',
      }
    },
    {
      tableName: 'QA Lab:collaboration',
      context: {
        objective: 'Test all StatusOwl functionality: API endpoints, health check engine, dashboard rendering, incident flows',
        constraints: 'Must achieve >80% code coverage, test both happy and error paths, load test health check scheduler',
      }
    },
  ];

  for (const def of contextDefs) {
    const tableId = tables[def.tableName];
    if (!tableId) continue;

    for (const [key, value] of Object.entries(def.context)) {
      try {
        await emit(socket, 'table:set-context', { tableId, key, value });
      } catch (err) {
        log('⚠️', `Context ${def.tableName}/${key} failed: ${err.message}`);
      }
    }
    log('🎯', `Context set: ${def.tableName} — ${Object.keys(def.context).length} keys`);
  }

  // ════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   ✅ StatusOwl Setup Complete                     ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Building:  ${buildingId}`);
  console.log(`║  Floors:    ${floors.length}`);
  console.log(`║  Rooms:     ${Object.keys(rooms).length}`);
  console.log(`║  Tables:    ${Object.keys(tables).length}`);
  console.log(`║  Agents:    ${Object.keys(agents).length}`);
  console.log(`║  Tasks:     ${Object.keys(tasks).length}`);
  console.log(`║  RAID:      ${raidEntries.length} entries`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║                                                  ║');
  console.log('║  Open http://localhost:4000 to see it in the UI  ║');
  console.log('║                                                  ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // Export IDs for follow-up scripts
  const manifest = {
    buildingId,
    floors: floorMap,
    rooms: Object.fromEntries(Object.entries(rooms).map(([k, v]) => [k, v.id])),
    tables,
    agents,
    tasks,
    timestamp: new Date().toISOString(),
  };

  // Write manifest to disk for other scripts to use
  const fs = await import('fs');
  fs.writeFileSync('./data/statusowl-manifest.json', JSON.stringify(manifest, null, 2));
  log('💾', 'Manifest saved to data/statusowl-manifest.json');

  socket.disconnect();
  process.exit(0);
}

setup().catch((err) => {
  console.error('\n❌ Setup failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
