/**
 * Built-in Command Handlers
 *
 * Core slash commands available in every Overlord v2 session.
 * Each handler queries existing managers via their public APIs
 * and returns formatted text responses.
 */

import { logger } from '../core/logger.js';
import { registerCommand, listCommands, getCommand } from './command-registry.js';
import { listBuildings, getBuilding } from '../rooms/building-manager.js';
import { getGates, canAdvance } from '../rooms/phase-gate.js';
import { searchRaid } from '../rooms/raid-log.js';
import type { CommandContext, CommandResult, CommandDefinition } from './contracts.js';
import type { RoomManagerAPI, AgentRegistryAPI } from '../core/contracts.js';

const log = logger.child({ module: 'builtin-commands' });

/**
 * Register all built-in commands.
 * Called during initCommands with the room and agent APIs.
 */
export function registerBuiltinCommands(rooms: RoomManagerAPI, agents: AgentRegistryAPI): void {
  try {
    registerCommand(helpCommand);
    registerCommand(statusCommand(agents, rooms));
    registerCommand(phaseCommand);
    registerCommand(agentsCommand(agents));
    registerCommand(roomsCommand(rooms));
    registerCommand(raidCommand);
    registerCommand(deployCommand);
    registerCommand(reviewCommand);

    log.info({ count: 8 }, 'Built-in commands registered');
  } catch (error) {
    log.error({ error }, 'Failed to register built-in commands');
  }
}

// ─── /help ───

const helpCommand: CommandDefinition = {
  name: 'help',
  description: 'List all available commands or show help for a specific command',
  usage: '/help [command]',
  aliases: ['h', '?'],
  scope: 'global',
  handler: (ctx: CommandContext): CommandResult => {
    try {
      const topic = ctx.args[0];

      if (topic) {
        const cmd = getCommand(topic);
        if (!cmd) {
          return { ok: false, response: `Unknown command: ${topic}. Type /help to see all commands.` };
        }
        const aliases = cmd.aliases?.length ? `  Aliases: ${cmd.aliases.map(a => `/${a}`).join(', ')}` : '';
        const scope = cmd.scope ? `  Scope: ${cmd.scope}` : '';
        return {
          ok: true,
          response: [
            `**/${cmd.name}** — ${cmd.description}`,
            `  Usage: \`${cmd.usage}\``,
            aliases,
            scope,
          ].filter(Boolean).join('\n'),
        };
      }

      const allCommands = listCommands();
      const lines = allCommands.map(cmd =>
        `  **/${cmd.name}** — ${cmd.description}`
      );

      return {
        ok: true,
        response: [
          '**Available Commands:**',
          '',
          ...lines,
          '',
          'Type `/help <command>` for details on a specific command.',
        ].join('\n'),
      };
    } catch (error) {
      log.error({ error }, '/help handler failed');
      return { ok: false, response: 'Failed to retrieve help information.' };
    }
  },
};

// ─── /status ───

function statusCommand(agents: AgentRegistryAPI, rooms: RoomManagerAPI): CommandDefinition {
  return {
    name: 'status',
    description: 'Show building status (phase, agent count, room count)',
    usage: '/status [buildingId]',
    aliases: ['s', 'info'],
    scope: 'global',
    handler: (ctx: CommandContext): CommandResult => {
      try {
        const buildingId = ctx.args[0] || ctx.buildingId;

        if (!buildingId) {
          // No building specified — list all buildings
          const result = listBuildings();
          if (!result.ok) {
            return { ok: false, response: 'Failed to list buildings.' };
          }
          const buildings = result.data as Array<{ id: string; name: string; active_phase: string }>;
          if (buildings.length === 0) {
            return { ok: true, response: 'No buildings exist yet. Start by creating a project.' };
          }

          const lines = buildings.map(b =>
            `  **${b.name}** (${b.id}) — Phase: ${b.active_phase}`
          );
          return {
            ok: true,
            response: [
              `**Buildings (${buildings.length}):**`,
              '',
              ...lines,
              '',
              'Use `/status <buildingId>` for details.',
            ].join('\n'),
          };
        }

        // Specific building
        const buildingResult = getBuilding(buildingId);
        if (!buildingResult.ok) {
          return { ok: false, response: `Building not found: ${buildingId}` };
        }
        const building = buildingResult.data as {
          id: string; name: string; active_phase: string;
          floors: Array<{ id: string; name: string; type: string }>;
        };

        const allAgents = agents.listAgents();
        const allRooms = rooms.listRooms();

        return {
          ok: true,
          response: [
            `**Building: ${building.name}**`,
            `  ID: ${building.id}`,
            `  Active Phase: ${building.active_phase}`,
            `  Floors: ${building.floors.length}`,
            `  Rooms: ${allRooms.length}`,
            `  Agents: ${allAgents.length}`,
          ].join('\n'),
          data: { building, agentCount: allAgents.length, roomCount: allRooms.length },
        };
      } catch (error) {
        log.error({ error }, '/status handler failed');
        return { ok: false, response: 'Failed to retrieve status.' };
      }
    },
  };
}

// ─── /phase ───

const phaseCommand: CommandDefinition = {
  name: 'phase',
  description: 'Show current phase and gate status',
  usage: '/phase [buildingId]',
  aliases: ['p', 'gate'],
  scope: 'building',
  handler: (ctx: CommandContext): CommandResult => {
    try {
      const buildingId = ctx.args[0] || ctx.buildingId;
      if (!buildingId) {
        return { ok: false, response: 'No building specified. Usage: `/phase <buildingId>`' };
      }

      const buildingResult = getBuilding(buildingId);
      if (!buildingResult.ok) {
        return { ok: false, response: `Building not found: ${buildingId}` };
      }
      const building = buildingResult.data as { name: string; active_phase: string };

      const gatesResult = getGates(buildingId);
      const gates = gatesResult.ok
        ? (gatesResult.data as Array<{ id: string; phase: string; status: string; signoff_verdict: string | null }>)
        : [];

      const advanceResult = canAdvance(buildingId);
      const advanceData = advanceResult.ok
        ? (advanceResult.data as { canAdvance: boolean; reason?: string; nextPhase?: string })
        : { canAdvance: false, reason: 'Error checking advance status' };

      const gateLines = gates.map(g => {
        const verdict = g.signoff_verdict ? ` (${g.signoff_verdict})` : '';
        return `  ${g.phase}: **${g.status}**${verdict}`;
      });

      const advanceStatus = advanceData.canAdvance
        ? `Can advance to: **${advanceData.nextPhase}**`
        : `Cannot advance: ${advanceData.reason || 'unknown'}`;

      return {
        ok: true,
        response: [
          `**Phase Status: ${building.name}**`,
          `  Current Phase: **${building.active_phase}**`,
          '',
          gates.length > 0 ? '**Gates:**' : 'No gates created yet.',
          ...gateLines,
          '',
          advanceStatus,
        ].join('\n'),
        data: { phase: building.active_phase, gates, canAdvance: advanceData },
      };
    } catch (error) {
      log.error({ error }, '/phase handler failed');
      return { ok: false, response: 'Failed to retrieve phase status.' };
    }
  },
};

// ─── /agents ───

function agentsCommand(agents: AgentRegistryAPI): CommandDefinition {
  return {
    name: 'agents',
    description: 'List all agents and their current rooms',
    usage: '/agents',
    aliases: ['a', 'team'],
    scope: 'global',
    handler: (_ctx: CommandContext): CommandResult => {
      try {
        const allAgents = agents.listAgents();

        if (allAgents.length === 0) {
          return { ok: true, response: 'No agents registered.' };
        }

        const lines = allAgents.map(a => {
          const room = a.current_room_id ? ` → Room: ${a.current_room_id}` : ' (idle)';
          return `  **${a.name}** [${a.role}] — ${a.status}${room}`;
        });

        return {
          ok: true,
          response: [
            `**Agents (${allAgents.length}):**`,
            '',
            ...lines,
          ].join('\n'),
          data: allAgents,
        };
      } catch (error) {
        log.error({ error }, '/agents handler failed');
        return { ok: false, response: 'Failed to list agents.' };
      }
    },
  };
}

// ─── /rooms ───

function roomsCommand(rooms: RoomManagerAPI): CommandDefinition {
  return {
    name: 'rooms',
    description: 'List all rooms with occupancy',
    usage: '/rooms',
    aliases: ['r'],
    scope: 'global',
    handler: (_ctx: CommandContext): CommandResult => {
      try {
        const allRooms = rooms.listRooms();

        if (allRooms.length === 0) {
          return { ok: true, response: 'No rooms created yet.' };
        }

        const lines = allRooms.map(r => {
          return `  **${r.name}** [${r.type}] — ${r.status}`;
        });

        return {
          ok: true,
          response: [
            `**Rooms (${allRooms.length}):**`,
            '',
            ...lines,
          ].join('\n'),
          data: allRooms,
        };
      } catch (error) {
        log.error({ error }, '/rooms handler failed');
        return { ok: false, response: 'Failed to list rooms.' };
      }
    },
  };
}

// ─── /raid ───

const raidCommand: CommandDefinition = {
  name: 'raid',
  description: 'Show RAID log entries, optionally filtered by type (risk, assumption, issue, decision)',
  usage: '/raid [type]',
  aliases: ['log'],
  scope: 'building',
  handler: (ctx: CommandContext): CommandResult => {
    try {
      const buildingId = ctx.args.length > 1 ? ctx.args[1] : ctx.buildingId;
      const typeFilter = ctx.args[0];

      if (!buildingId) {
        return { ok: false, response: 'No building specified. Usage: `/raid [type] [buildingId]`' };
      }

      const validTypes = ['risk', 'assumption', 'issue', 'decision'];
      if (typeFilter && !validTypes.includes(typeFilter)) {
        return {
          ok: false,
          response: `Invalid RAID type: ${typeFilter}. Valid types: ${validTypes.join(', ')}`,
        };
      }

      const searchParams: { buildingId: string; type?: string } = { buildingId };
      if (typeFilter) {
        searchParams.type = typeFilter;
      }

      const result = searchRaid(searchParams);
      if (!result.ok) {
        return { ok: false, response: 'Failed to search RAID log.' };
      }

      const entries = result.data as Array<{
        id: string; type: string; phase: string;
        summary: string; status: string; decided_by: string | null;
      }>;

      if (entries.length === 0) {
        const filterMsg = typeFilter ? ` of type "${typeFilter}"` : '';
        return { ok: true, response: `No RAID entries found${filterMsg}.` };
      }

      const lines = entries.map(e => {
        const typeTag = e.type.toUpperCase().padEnd(10);
        const statusTag = e.status === 'active' ? '' : ` [${e.status}]`;
        return `  [${typeTag}] ${e.summary}${statusTag}  (${e.id})`;
      });

      const header = typeFilter
        ? `**RAID Log — ${typeFilter.toUpperCase()} entries (${entries.length}):**`
        : `**RAID Log (${entries.length} entries):**`;

      return {
        ok: true,
        response: [header, '', ...lines].join('\n'),
        data: entries,
      };
    } catch (error) {
      log.error({ error }, '/raid handler failed');
      return { ok: false, response: 'Failed to retrieve RAID log.' };
    }
  },
};

// ─── /deploy ───

const deployCommand: CommandDefinition = {
  name: 'deploy',
  description: 'Trigger deployment check',
  usage: '/deploy [buildingId]',
  scope: 'building',
  handler: (ctx: CommandContext): CommandResult => {
    try {
      const buildingId = ctx.args[0] || ctx.buildingId;
      if (!buildingId) {
        return { ok: false, response: 'No building specified. Usage: `/deploy <buildingId>`' };
      }

      ctx.bus.emit('deploy:check', {
        buildingId,
        requestedBy: ctx.socketId,
        timestamp: Date.now(),
      });

      return {
        ok: true,
        response: `Deployment check triggered for building ${buildingId}. Monitoring bus for results.`,
        data: { buildingId, triggered: true },
      };
    } catch (error) {
      log.error({ error }, '/deploy handler failed');
      return { ok: false, response: 'Failed to trigger deployment check.' };
    }
  },
};

// ─── /review ───

const reviewCommand: CommandDefinition = {
  name: 'review',
  description: 'Show review status for the current phase',
  usage: '/review [buildingId]',
  scope: 'building',
  handler: (ctx: CommandContext): CommandResult => {
    try {
      const buildingId = ctx.args[0] || ctx.buildingId;
      if (!buildingId) {
        return { ok: false, response: 'No building specified. Usage: `/review <buildingId>`' };
      }

      const buildingResult = getBuilding(buildingId);
      if (!buildingResult.ok) {
        return { ok: false, response: `Building not found: ${buildingId}` };
      }
      const building = buildingResult.data as { name: string; active_phase: string };

      const advanceResult = canAdvance(buildingId);
      const advanceData = advanceResult.ok
        ? (advanceResult.data as { canAdvance: boolean; reason?: string; currentPhase?: string; nextPhase?: string })
        : { canAdvance: false, reason: 'Error checking' };

      const gatesResult = getGates(buildingId);
      const gates = gatesResult.ok
        ? (gatesResult.data as Array<{ phase: string; status: string; signoff_verdict: string | null; signoff_reviewer: string | null }>)
        : [];

      // Find current phase gate
      const currentGate = gates.find(g => g.phase === building.active_phase);

      const raidResult = searchRaid({ buildingId, status: 'active' });
      const activeIssues = raidResult.ok
        ? (raidResult.data as Array<{ type: string }>).filter(e => e.type === 'issue')
        : [];

      const lines = [
        `**Review Status: ${building.name}**`,
        `  Phase: **${building.active_phase}**`,
        '',
      ];

      if (currentGate) {
        lines.push(`  Gate Status: **${currentGate.status}**`);
        if (currentGate.signoff_reviewer) {
          lines.push(`  Reviewer: ${currentGate.signoff_reviewer}`);
          lines.push(`  Verdict: ${currentGate.signoff_verdict}`);
        }
      } else {
        lines.push('  Gate: No gate created for current phase.');
      }

      lines.push('');
      lines.push(`  Active Issues: ${activeIssues.length}`);
      lines.push(`  Ready to Advance: ${advanceData.canAdvance ? 'Yes' : 'No'}`);
      if (!advanceData.canAdvance && advanceData.reason) {
        lines.push(`  Reason: ${advanceData.reason}`);
      }

      return {
        ok: true,
        response: lines.join('\n'),
        data: { phase: building.active_phase, gate: currentGate, activeIssues: activeIssues.length, canAdvance: advanceData },
      };
    } catch (error) {
      log.error({ error }, '/review handler failed');
      return { ok: false, response: 'Failed to retrieve review status.' };
    }
  },
};
