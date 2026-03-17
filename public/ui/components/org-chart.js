/**
 * Org Chart — Visual Agent Hierarchy (#678)
 *
 * Inspired by Paperclip's org chart. Shows agents organized by
 * floor → room → table, with real-time status indicators.
 *
 * Layout: Tree structure flowing top-down
 *   Building (root)
 *     └─ Floor nodes
 *        └─ Room nodes
 *           └─ Agent nodes (with status dot, role badge)
 */

import { h } from '../engine/helpers.js';
import { OverlordUI } from '../engine/engine.js';

export class OrgChart {

  /**
   * Render an org chart for the current building.
   * @param {object} opts
   * @param {string} opts.buildingName
   * @param {Array} opts.floors - floors with rooms nested
   * @param {Array} opts.agents - all agents in this building
   * @param {object} opts.agentPositions - { agentId: { roomId, status, name } }
   * @returns {HTMLElement}
   */
  static render({ buildingName, floors, agents, agentPositions }) {
    const container = h('div', { class: 'org-chart' });

    // Building root node
    const rootNode = h('div', { class: 'org-node org-node--building' },
      h('div', { class: 'org-node-content' },
        h('span', { class: 'org-node-icon' }, '\u{1F3D7}\uFE0F'),
        h('span', { class: 'org-node-label' }, buildingName || 'Project'),
        h('span', { class: 'org-node-meta' }, `${(floors || []).length} floors \u2022 ${(agents || []).length} agents`),
      )
    );
    container.appendChild(rootNode);

    // Floor branches
    const floorContainer = h('div', { class: 'org-children' });

    for (const floor of (floors || [])) {
      const rooms = floor.rooms || [];
      const floorAgentCount = OrgChart._countAgentsInFloor(floor, agents, agentPositions);

      const floorBranch = h('div', { class: 'org-branch' });

      // Floor connector line
      floorBranch.appendChild(h('div', { class: 'org-connector' }));

      // Floor node
      const floorNode = h('div', { class: 'org-node org-node--floor' },
        h('div', { class: 'org-node-content' },
          h('span', { class: 'org-node-icon' }, OrgChart._floorIcon(floor.type || floor.name)),
          h('span', { class: 'org-node-label' }, floor.name),
          h('span', { class: 'org-node-meta' }, `${rooms.length} rooms \u2022 ${floorAgentCount} agents`),
        )
      );
      floorBranch.appendChild(floorNode);

      // Room branches under this floor
      if (rooms.length > 0) {
        const roomContainer = h('div', { class: 'org-children' });

        for (const room of rooms) {
          const roomAgents = OrgChart._getAgentsInRoom(room.id, agents, agentPositions);

          const roomBranch = h('div', { class: 'org-branch' });
          roomBranch.appendChild(h('div', { class: 'org-connector' }));

          const hasActive = roomAgents.some(a => a._status === 'active' || a._status === 'working');
          const roomNode = h('div', { class: `org-node org-node--room${hasActive ? ' org-node--active' : ''}` },
            h('div', { class: 'org-node-content' },
              h('span', { class: 'org-node-icon' }, '\u{1F6AA}'),
              h('span', { class: 'org-node-label' }, room.name),
              h('span', { class: `org-node-badge org-badge--${room.type || 'default'}` }, room.type || ''),
            )
          );
          roomBranch.appendChild(roomNode);

          // Agent nodes under this room
          if (roomAgents.length > 0) {
            const agentContainer = h('div', { class: 'org-children org-children--agents' });

            for (const agent of roomAgents) {
              const agentBranch = h('div', { class: 'org-branch org-branch--agent' });
              agentBranch.appendChild(h('div', { class: 'org-connector org-connector--short' }));

              const statusClass = agent._status === 'active' ? 'active' : agent._status === 'idle' ? 'idle' : 'offline';
              const initial = (agent.display_name || agent.name || '?')[0].toUpperCase();

              const agentNode = h('div', { class: 'org-node org-node--agent' },
                h('div', { class: 'org-node-content' },
                  h('div', { class: `org-agent-avatar org-status--${statusClass}` }, initial),
                  h('div', { class: 'org-agent-info' },
                    h('span', { class: 'org-agent-name' }, agent.display_name || agent.name || agent.id),
                    h('span', { class: 'org-agent-role' }, agent.role || ''),
                  ),
                  h('span', { class: `org-status-dot org-status--${statusClass}` }),
                )
              );

              // Click to view agent detail
              agentNode.addEventListener('click', () => {
                OverlordUI.dispatch('entity:navigate', { entityType: 'agent', entityId: agent.id });
              });
              agentNode.style.cursor = 'pointer';

              agentBranch.appendChild(agentNode);
              agentContainer.appendChild(agentBranch);
            }

            roomBranch.appendChild(agentContainer);
          }

          roomContainer.appendChild(roomBranch);
        }

        floorBranch.appendChild(roomContainer);
      }

      floorContainer.appendChild(floorBranch);
    }

    // Unassigned agents (not in any room)
    const unassigned = (agents || []).filter(a => {
      if (a.id === '__user__') return false;
      const pos = agentPositions?.[a.id];
      return !pos?.roomId && !a.current_room_id;
    });

    if (unassigned.length > 0) {
      const unassignedBranch = h('div', { class: 'org-branch' });
      unassignedBranch.appendChild(h('div', { class: 'org-connector' }));

      const unassignedNode = h('div', { class: 'org-node org-node--unassigned' },
        h('div', { class: 'org-node-content' },
          h('span', { class: 'org-node-icon' }, '\u{1F4AD}'),
          h('span', { class: 'org-node-label' }, 'Unassigned'),
          h('span', { class: 'org-node-meta' }, `${unassigned.length} agents waiting`),
        )
      );
      unassignedBranch.appendChild(unassignedNode);

      const unassignedAgents = h('div', { class: 'org-children org-children--agents' });
      for (const agent of unassigned) {
        const initial = (agent.display_name || agent.name || '?')[0].toUpperCase();
        const agentEl = h('div', { class: 'org-branch org-branch--agent' },
          h('div', { class: 'org-connector org-connector--short' }),
          h('div', { class: 'org-node org-node--agent org-node--idle' },
            h('div', { class: 'org-node-content' },
              h('div', { class: 'org-agent-avatar org-status--idle' }, initial),
              h('div', { class: 'org-agent-info' },
                h('span', { class: 'org-agent-name' }, agent.display_name || agent.name || agent.id),
                h('span', { class: 'org-agent-role' }, agent.role || ''),
              ),
              h('span', { class: 'org-status-dot org-status--idle' }),
            )
          ),
        );
        agentEl.style.cursor = 'pointer';
        agentEl.addEventListener('click', () => {
          OverlordUI.dispatch('entity:navigate', { entityType: 'agent', entityId: agent.id });
        });
        unassignedAgents.appendChild(agentEl);
      }
      unassignedBranch.appendChild(unassignedAgents);
      floorContainer.appendChild(unassignedBranch);
    }

    container.appendChild(floorContainer);
    return container;
  }

  // ─── Helpers ───

  static _floorIcon(type) {
    const icons = {
      strategy: '\u{1F3AF}',
      collaboration: '\u{1F4AC}',
      execution: '\u{1F6E0}\uFE0F',
      governance: '\u{1F6E1}\uFE0F',
      operations: '\u{1F680}',
      integration: '\u{1F50C}',
    };
    return icons[(type || '').toLowerCase()] || '\u{1F3D7}\uFE0F';
  }

  static _countAgentsInFloor(floor, agents, positions) {
    const rooms = floor.rooms || [];
    const roomIds = new Set(rooms.map(r => r.id));
    return (agents || []).filter(a => {
      const pos = positions?.[a.id];
      return (pos?.roomId && roomIds.has(pos.roomId)) || (a.current_room_id && roomIds.has(a.current_room_id));
    }).length;
  }

  static _getAgentsInRoom(roomId, agents, positions) {
    return (agents || []).filter(a => {
      const pos = positions?.[a.id];
      const inRoom = (pos?.roomId === roomId) || (a.current_room_id === roomId);
      return inRoom && a.id !== '__user__';
    }).map(a => ({
      ...a,
      _status: positions?.[a.id]?.status || a.status || 'idle',
    }));
  }
}
