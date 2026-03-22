/**
 * Building Onboarding
 *
 * Automatically provisions the first room and agent when a building is created.
 *
 * When a building is created:
 *   1. Find the strategy floor
 *   2. Create a Strategist room on it
 *   3. Register a default Strategist agent with room access
 *   4. Enter the agent into the room
 *   5. Emit events so the UI knows the building is ready for interaction
 *
 * This bridges the gap between "building created" and "user can chat".
 * Without it, buildings have empty floors and no rooms.
 */

import { getDb } from '../storage/db.js';
import { logger } from '../core/logger.js';
import { analyzeCodebase } from '../ai/codebase-analysis-service.js';
import { applyBlueprint } from './building-manager.js';
import { QUICK_START_TEMPLATES } from './room-types/strategist.js';
import type { Bus, BusEventData } from '../core/bus.js';
import type {
  RoomManagerAPI,
  AgentRegistryAPI,
  FloorRow,
} from '../core/contracts.js';

const log = logger.child({ module: 'building-onboarding' });

/** Phase → room type mapping for auto-provisioning */
const PHASE_ROOM_MAP: Record<string, { roomType: string; floorType: string; roomName: string; agentName: string; agentRole: string }> = {
  strategy: {
    roomType: 'strategist',
    floorType: 'strategy',
    roomName: 'Strategist Office',
    agentName: 'Strategist',
    agentRole: 'strategist',
  },
  discovery: {
    roomType: 'discovery',
    floorType: 'collaboration',
    roomName: 'Discovery Room',
    agentName: 'Discovery Lead',
    agentRole: 'analyst',
  },
  architecture: {
    roomType: 'architecture',
    floorType: 'collaboration',
    roomName: 'Architecture Studio',
    agentName: 'System Architect',
    agentRole: 'architect',
  },
  execution: {
    roomType: 'code-lab',
    floorType: 'execution',
    roomName: 'Code Lab',
    agentName: 'Lead Developer',
    agentRole: 'developer',
  },
  review: {
    roomType: 'review',
    floorType: 'governance',
    roomName: 'Review Chamber',
    agentName: 'Review Lead',
    agentRole: 'reviewer',
  },
  deploy: {
    roomType: 'deploy',
    floorType: 'operations',
    roomName: 'Deploy Control',
    agentName: 'DevOps Engineer',
    agentRole: 'operator',
  },
};

interface OnboardingDeps {
  bus: Bus;
  rooms: RoomManagerAPI;
  agents: AgentRegistryAPI;
}

/**
 * Initialize building onboarding.
 *
 * Listens for:
 * - 'building:created' — provisions Strategist room + agent
 * - 'phase:advanced' — provisions next phase's room + agent
 */
export function initBuildingOnboarding({ bus, rooms, agents }: OnboardingDeps): void {
  // When a building is created, auto-provision the Strategist room
  bus.on('building:created', (data: BusEventData) => {
    const buildingId = data.buildingId as string;
    const buildingName = data.name as string || 'New Project';

    if (!buildingId) {
      log.warn({ data }, 'building:created event missing buildingId');
      return;
    }

    log.info({ buildingId, buildingName }, 'Onboarding new building — provisioning Strategist');

    const result = provisionPhaseRoom({
      buildingId,
      phase: 'strategy',
      rooms,
      agents,
    });

    if (result.success) {
      // Auto-create a balanced agent team (#766)
      const teamCreated = provisionAgentTeam({ buildingId, agents, rooms });

      bus.emit('building:onboarded', {
        buildingId,
        roomId: result.roomId,
        agentId: result.agentId,
        phase: 'strategy',
        roomType: 'strategist',
        teamSize: teamCreated + 1, // +1 for the strategist
      });

      log.info(
        { buildingId, roomId: result.roomId, agentId: result.agentId, teamCreated },
        'Building onboarded — Strategist room ready, team provisioned',
      );
    } else {
      log.error({ buildingId, error: result.error }, 'Failed to onboard building');
      bus.emit('building:onboard-failed', {
        buildingId,
        error: result.error,
      });
    }
  });

  // When a phase advances, auto-provision the next phase's room
  bus.on('phase:advanced', (data: BusEventData) => {
    const buildingId = data.buildingId as string;
    const nextPhase = data.to as string || data.nextPhase as string;

    if (!buildingId || !nextPhase) {
      log.warn({ data }, 'phase:advanced event missing buildingId or nextPhase');
      return;
    }

    log.info({ buildingId, nextPhase }, 'Phase advanced — provisioning next room');

    const result = provisionPhaseRoom({
      buildingId,
      phase: nextPhase,
      rooms,
      agents,
    });

    if (result.success) {
      bus.emit('phase:room-provisioned', {
        buildingId,
        phase: nextPhase,
        roomId: result.roomId,
        agentId: result.agentId,
        roomType: result.roomType,
      });

      log.info(
        { buildingId, nextPhase, roomId: result.roomId, agentId: result.agentId },
        'Next phase room provisioned',
      );
    } else {
      log.error({ buildingId, nextPhase, error: result.error }, 'Failed to provision next phase room');
    }
  });

  // On startup: detect buildings with no rooms and onboard them (#975)
  onboardOrphanedBuildings({ bus, rooms, agents });

  log.info('Building onboarding initialized');
}

/**
 * Detect buildings that have floors but no rooms provisioned (#975).
 * These are "orphaned" buildings created by auto-discover or other paths
 * that bypassed the onboarding flow.
 *
 * For each orphaned building:
 * 1. Analyze the working directory to detect project type
 * 2. Select the matching quick-start template
 * 3. Apply the full blueprint (rooms + agents across floors)
 * 4. Fall back to Strategist-only if analysis fails
 */
function onboardOrphanedBuildings({ bus, rooms, agents }: OnboardingDeps): void {
  const db = getDb();

  try {
    // Find buildings that have floors but zero rooms
    const orphaned = db.prepare(`
      SELECT b.id, b.name, b.working_directory FROM buildings b
      WHERE EXISTS (SELECT 1 FROM floors f WHERE f.building_id = b.id)
        AND NOT EXISTS (
          SELECT 1 FROM rooms r
          JOIN floors f ON r.floor_id = f.id
          WHERE f.building_id = b.id
        )
    `).all() as Array<{ id: string; name: string; working_directory: string | null }>;

    if (orphaned.length === 0) {
      log.info('No orphaned buildings found — all buildings have rooms');
      return;
    }

    log.info({ count: orphaned.length }, 'Found orphaned buildings with no rooms — analyzing and onboarding');

    let successCount = 0;
    for (const building of orphaned) {
      log.info({ buildingId: building.id, name: building.name }, 'Analyzing orphaned building');

      // Try to detect project type from the working directory
      let blueprintApplied = false;

      if (building.working_directory) {
        try {
          const analysis = analyzeCodebase(building.working_directory);
          if (analysis.ok) {
            const templateId = analysis.data.recommendedTemplate;
            const template = QUICK_START_TEMPLATES.find(t => t.id === templateId);

            if (template) {
              log.info(
                { buildingId: building.id, name: building.name, template: templateId, projectType: analysis.data.projectType, language: analysis.data.primaryLanguage },
                'Detected project type — applying blueprint',
              );

              // Use the recommended agents from analysis if available, otherwise use template defaults
              const agentRoster = analysis.data.recommendedAgents.length > 0
                ? analysis.data.recommendedAgents.map(a => ({ name: a.name, role: a.role, rooms: a.roomAccess }))
                : template.agentRoster;

              const result = applyBlueprint(building.id, {
                floorsNeeded: template.floorsNeeded,
                roomConfig: template.roomConfig,
                agentRoster,
              });

              if (result.ok) {
                const data = result.data as { floorsCreated: number; roomsCreated: number; agentsCreated: number };
                blueprintApplied = true;

                bus.emit('building:onboarded', {
                  buildingId: building.id,
                  name: building.name,
                  phase: 'strategy',
                  template: templateId,
                  projectType: analysis.data.projectType,
                  language: analysis.data.primaryLanguage,
                  framework: analysis.data.framework,
                  floorsCreated: data.floorsCreated,
                  roomsCreated: data.roomsCreated,
                  agentsCreated: data.agentsCreated,
                  wasOrphaned: true,
                  wasAutoAnalyzed: true,
                });

                successCount++;
                log.info(
                  { buildingId: building.id, name: building.name, template: templateId, ...data },
                  'Orphaned building fully onboarded via codebase analysis',
                );
              }
            }
          }
        } catch (e) {
          log.warn(
            { buildingId: building.id, dir: building.working_directory, err: e instanceof Error ? e.message : String(e) },
            'Codebase analysis failed — falling back to Strategist-only',
          );
        }
      }

      // Fallback: just provision a Strategist room + agent team
      if (!blueprintApplied) {
        log.info({ buildingId: building.id, name: building.name }, 'No analysis available — provisioning Strategist room');

        const result = provisionPhaseRoom({
          buildingId: building.id,
          phase: 'strategy',
          rooms,
          agents,
        });

        if (result.success) {
          const teamCreated = provisionAgentTeam({ buildingId: building.id, agents, rooms });

          bus.emit('building:onboarded', {
            buildingId: building.id,
            name: building.name,
            roomId: result.roomId,
            agentId: result.agentId,
            phase: 'strategy',
            roomType: 'strategist',
            teamSize: teamCreated + 1,
            wasOrphaned: true,
          });

          successCount++;
          log.info(
            { buildingId: building.id, name: building.name, teamCreated },
            'Orphaned building onboarded with Strategist fallback',
          );
        } else {
          log.error(
            { buildingId: building.id, name: building.name, error: result.error },
            'Failed to onboard orphaned building',
          );
        }
      }
    }

    log.info({ onboarded: successCount, total: orphaned.length }, 'Orphaned building onboarding complete');
  } catch (e) {
    log.error({ err: e instanceof Error ? e.message : String(e) }, 'Failed to check for orphaned buildings');
  }
}

interface ProvisionResult {
  success: boolean;
  roomId?: string;
  agentId?: string;
  roomType?: string;
  error?: string;
}

/**
 * Provision a room + agent for a given phase in a building.
 */
function provisionPhaseRoom({
  buildingId,
  phase,
  rooms,
  agents,
}: {
  buildingId: string;
  phase: string;
  rooms: RoomManagerAPI;
  agents: AgentRegistryAPI;
}): ProvisionResult {
  const mapping = PHASE_ROOM_MAP[phase];
  if (!mapping) {
    return { success: false, error: `No room mapping for phase "${phase}"` };
  }

  const db = getDb();

  // 1. Find the correct floor
  const floor = db.prepare(
    'SELECT * FROM floors WHERE building_id = ? AND type = ?',
  ).get(buildingId, mapping.floorType) as FloorRow | undefined;

  if (!floor) {
    return { success: false, error: `No ${mapping.floorType} floor found in building ${buildingId}` };
  }

  // 2. Check if a room of this type already exists on this floor
  const existingRoom = db.prepare(
    'SELECT id FROM rooms WHERE floor_id = ? AND type = ?',
  ).get(floor.id, mapping.roomType) as { id: string } | undefined;

  let roomId: string;

  if (existingRoom) {
    roomId = existingRoom.id;
    log.info({ roomId, roomType: mapping.roomType }, 'Room already exists — reusing');

    // Make sure it's an active room instance (may need to be instantiated)
    const activeRoom = rooms.getRoom(roomId);
    if (!activeRoom) {
      // Room exists in DB but not in memory — re-create as active instance
      const createResult = rooms.createRoom({
        type: mapping.roomType,
        floorId: floor.id,
        name: mapping.roomName,
      });
      if (createResult.ok) {
        roomId = (createResult.data as { id: string }).id;
      } else {
        return { success: false, error: `Failed to activate room: ${createResult.error.message}` };
      }
    }
  } else {
    // 3. Create the room
    const createResult = rooms.createRoom({
      type: mapping.roomType,
      floorId: floor.id,
      name: mapping.roomName,
    });

    if (!createResult.ok) {
      return { success: false, error: `Failed to create room: ${createResult.error.message}` };
    }

    roomId = (createResult.data as { id: string }).id;
  }

  // 4. Register the agent (with dedup check)
  const existingAgents = agents.listAgents({ roomId });
  const alreadyRegistered = existingAgents.find(
    (a) => a.name === mapping.agentName && a.role === mapping.agentRole,
  );

  if (alreadyRegistered) {
    log.info(
      { agentId: alreadyRegistered.id, name: mapping.agentName },
      'Agent already exists for this room — reusing',
    );
    return {
      success: true,
      roomId,
      agentId: alreadyRegistered.id,
      roomType: mapping.roomType,
    };
  }

  const agentResult = agents.registerAgent({
    name: mapping.agentName,
    role: mapping.agentRole,
    capabilities: ['chat', 'analysis'],
    roomAccess: [mapping.roomType], // Scoped to this room type only
    buildingId,
  });

  if (!agentResult.ok) {
    return { success: false, error: `Failed to register agent: ${agentResult.error.message}` };
  }

  const agentId = (agentResult.data as { id: string }).id;

  // 5. Enter the agent into the room
  const enterResult = rooms.enterRoom({
    roomId,
    agentId,
    tableType: Object.keys(getDefaultTable(mapping.roomType))[0],
  });

  if (!enterResult.ok) {
    log.warn(
      { roomId, agentId, error: enterResult.error },
      'Agent could not enter room — room is ready but agent not seated',
    );
    // Don't fail the whole flow — room exists, agent exists, just not seated yet
  }

  return {
    success: true,
    roomId,
    agentId,
    roomType: mapping.roomType,
  };
}

/**
 * Provision a balanced agent team for a new building (#766).
 * Creates agents for each phase role (excluding strategist, already created).
 * Agents are idle until their phase activates.
 */
function provisionAgentTeam({
  buildingId,
  agents,
  rooms,
}: {
  buildingId: string;
  agents: AgentRegistryAPI;
  rooms: RoomManagerAPI;
}): number {
  const TEAM_ROLES = [
    { name: 'Analyst', role: 'analyst', capabilities: ['chat', 'analysis', 'research'], roomAccess: ['discovery'] },
    { name: 'Architect', role: 'architect', capabilities: ['chat', 'analysis', 'design'], roomAccess: ['architecture'] },
    { name: 'Developer Alpha', role: 'developer', capabilities: ['chat', 'code', 'testing'], roomAccess: ['code-lab'] },
    { name: 'Developer Beta', role: 'developer', capabilities: ['chat', 'code', 'testing'], roomAccess: ['code-lab'] },
    { name: 'Tester', role: 'tester', capabilities: ['chat', 'testing', 'analysis'], roomAccess: ['testing-lab'] },
    { name: 'Reviewer', role: 'reviewer', capabilities: ['chat', 'review', 'analysis'], roomAccess: ['review'] },
    { name: 'Documentation Specialist', role: 'documentation_specialist', capabilities: ['chat', 'analysis', 'documentation'], roomAccess: ['documentation', 'discovery', 'review'] },
  ];

  // Dedup: check which roles already exist in this building
  const existingAgents = agents.listAgents({ buildingId });
  const existingRoles = new Map<string, number>();
  for (const a of existingAgents) {
    const key = a.role || '';
    existingRoles.set(key, (existingRoles.get(key) || 0) + 1);
  }

  let created = 0;
  const agentsToEnter: Array<{ agentId: string; roomType: string; name: string }> = [];

  for (const teamRole of TEAM_ROLES) {
    // Skip if this role already has enough agents
    const existingCount = existingRoles.get(teamRole.role) || 0;
    const neededForRole = TEAM_ROLES.filter(r => r.role === teamRole.role).length;
    if (existingCount >= neededForRole) {
      log.info({ buildingId, role: teamRole.role, existing: existingCount }, 'Role already has enough agents — skipping');
      continue;
    }

    try {
      const result = agents.registerAgent({
        name: teamRole.name,
        role: teamRole.role,
        capabilities: teamRole.capabilities,
        roomAccess: teamRole.roomAccess,
        buildingId,
      });

      if (result.ok) {
        created++;
        existingRoles.set(teamRole.role, (existingRoles.get(teamRole.role) || 0) + 1);
        const agentData = result.data as { id: string };
        agentsToEnter.push({ agentId: agentData.id, roomType: teamRole.roomAccess[0], name: teamRole.name });
        log.info({ buildingId, role: teamRole.role, name: teamRole.name }, 'Team agent provisioned');
      } else {
        log.warn({ buildingId, role: teamRole.role, error: result.error }, 'Failed to provision team agent');
      }
    } catch (e) {
      log.error({ buildingId, role: teamRole.role, err: e }, 'Team agent provisioning threw');
    }
  }

  // #925 — Auto-enter agents into their designated rooms
  const db = getDb();
  for (const entry of agentsToEnter) {
    try {
      // Find the room of this type in this building
      const roomRow = db.prepare(`
        SELECT r.id FROM rooms r
        JOIN floors f ON r.floor_id = f.id
        WHERE f.building_id = ? AND r.type = ?
        LIMIT 1
      `).get(buildingId, entry.roomType) as { id: string } | undefined;

      if (roomRow) {
        const enterResult = rooms.enterRoom({ roomId: roomRow.id, agentId: entry.agentId });
        if (enterResult.ok) {
          log.info({ buildingId, agentId: entry.agentId, roomType: entry.roomType, name: entry.name }, 'Agent auto-entered room');
        } else {
          log.warn({ buildingId, agentId: entry.agentId, roomType: entry.roomType, error: enterResult.error }, 'Agent failed to auto-enter room');
        }
      } else {
        log.warn({ buildingId, roomType: entry.roomType, name: entry.name }, 'No room found for agent auto-entry — rooms may not be provisioned yet');
      }
    } catch (e) {
      log.warn({ buildingId, agentId: entry.agentId, err: e }, 'Agent auto-entry threw (non-blocking)');
    }
  }

  log.info({ buildingId, created, total: TEAM_ROLES.length }, 'Agent team provisioning complete');
  return created;
}

/**
 * Get the default table type for a room type.
 */
function getDefaultTable(roomType: string): Record<string, boolean> {
  const TABLE_DEFAULTS: Record<string, string> = {
    strategist: 'consultation',
    discovery: 'collaboration',
    architecture: 'design',
    'code-lab': 'focus',
    'testing-lab': 'testing',
    review: 'review',
    deploy: 'operations',
  };
  const table = TABLE_DEFAULTS[roomType] || 'focus';
  return { [table]: true };
}
