/**
 * Database Seed Script
 *
 * Seeds a development building with default floors, rooms, and agents.
 * Creates a "Quick Start" project for immediate testing.
 */

import { config } from '../src/core/config.js';
import { initStorage, getDb } from '../src/storage/db.js';

async function seed() {
  config.validate();
  await initStorage(config);
  const db = getDb();

  console.log('Seeding development database...');

  // Create a default building
  const buildingId = 'building_dev_001';
  db.prepare(`
    INSERT OR REPLACE INTO buildings (id, project_id, name, active_phase)
    VALUES (?, ?, ?, ?)
  `).run(buildingId, 'project_dev', 'Development Building', 'strategy');

  // Create default floors
  const floors = [
    { id: 'floor_lobby', type: 'lobby', name: 'Lobby', order: 0 },
    { id: 'floor_strategy', type: 'strategy', name: 'Strategy Floor', order: 1 },
    { id: 'floor_collab', type: 'collaboration', name: 'Collaboration Floor', order: 2 },
    { id: 'floor_exec', type: 'execution', name: 'Execution Floor', order: 3 },
    { id: 'floor_ops', type: 'operations', name: 'Operations Floor', order: 4 },
    { id: 'floor_gov', type: 'governance', name: 'Governance Floor', order: 5 },
    { id: 'floor_integ', type: 'integration', name: 'Integration Floor', order: 6 },
  ];

  for (const floor of floors) {
    db.prepare(`
      INSERT OR REPLACE INTO floors (id, building_id, type, name, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).run(floor.id, buildingId, floor.type, floor.name, floor.order);
  }

  // Create default agents (10-line identity cards)
  const agents = [
    { id: 'agent_strategist', name: 'Strategist', role: 'Project Consultant', capabilities: ['strategy', 'planning'], roomAccess: ['strategist'], badge: 'strategy-level-1' },
    { id: 'agent_architect', name: 'Architect', role: 'System Architect', capabilities: ['architecture', 'design', 'planning'], roomAccess: ['discovery', 'architecture', 'review', 'code-lab'], badge: 'arch-level-1' },
    { id: 'agent_dev', name: 'Developer', role: 'Full-Stack Developer', capabilities: ['coding', 'testing', 'debugging'], roomAccess: ['code-lab', 'testing-lab'], badge: 'dev-level-1' },
    { id: 'agent_qa', name: 'QA Lead', role: 'Testing Engineer', capabilities: ['testing', 'qa', 'code-review'], roomAccess: ['testing-lab', 'review'], badge: 'qa-level-1' },
    { id: 'agent_devops', name: 'DevOps', role: 'DevOps Engineer', capabilities: ['deployment', 'monitoring', 'ci-cd'], roomAccess: ['deploy', 'monitoring'], badge: 'ops-level-1' },
    { id: 'agent_pm', name: 'PM', role: 'Project Manager', capabilities: ['planning', 'coordination', 'reporting'], roomAccess: ['discovery', 'architecture', 'review', 'strategist'], badge: 'pm-level-1' },
  ];

  for (const agent of agents) {
    db.prepare(`
      INSERT OR REPLACE INTO agents (id, name, role, capabilities, room_access, badge)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(agent.id, agent.name, agent.role, JSON.stringify(agent.capabilities), JSON.stringify(agent.roomAccess), agent.badge);
  }

  console.log(`Seeded: 1 building, ${floors.length} floors, ${agents.length} agents`);
  console.log('Done.');
}

seed().catch(console.error);
