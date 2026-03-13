/**
 * Room Type Registry — Barrel file
 *
 * Imports all built-in room types and registers them with the room manager.
 * Called during server boot after initRooms() to populate the registry.
 *
 * Plugin/custom room types can be registered separately via registerRoomType().
 */

import type { BaseRoomConstructor } from '../../core/contracts.js';
import { DiscoveryRoom } from './discovery.js';
import { ArchitectureRoom } from './architecture.js';
import { CodeLab } from './code-lab.js';
import { TestingLab } from './testing-lab.js';
import { ReviewRoom } from './review.js';
import { DeployRoom } from './deploy.js';
import { WarRoom } from './war-room.js';
import { StrategistOffice } from './strategist.js';
import { BuildingArchitect } from './building-architect.js';
import { DataExchangeRoom } from './data-exchange.js';
import { ProviderHubRoom } from './provider-hub.js';
import { PluginBayRoom } from './plugin-bay.js';

/**
 * All built-in room types, keyed by their contract roomType string.
 * Order follows the typical project flow:
 *   strategist → discovery → architecture → code-lab → testing-lab → review → deploy
 *   war-room is available at any phase for incident response.
 */
export const builtInRoomTypes: ReadonlyArray<{ type: string; factory: BaseRoomConstructor }> = [
  { type: 'strategist', factory: StrategistOffice as unknown as BaseRoomConstructor },
  { type: 'building-architect', factory: BuildingArchitect as unknown as BaseRoomConstructor },
  { type: 'discovery', factory: DiscoveryRoom as unknown as BaseRoomConstructor },
  { type: 'architecture', factory: ArchitectureRoom as unknown as BaseRoomConstructor },
  { type: 'code-lab', factory: CodeLab as unknown as BaseRoomConstructor },
  { type: 'testing-lab', factory: TestingLab as unknown as BaseRoomConstructor },
  { type: 'review', factory: ReviewRoom as unknown as BaseRoomConstructor },
  { type: 'deploy', factory: DeployRoom as unknown as BaseRoomConstructor },
  { type: 'war-room', factory: WarRoom as unknown as BaseRoomConstructor },
  // Integration Floor
  { type: 'data-exchange', factory: DataExchangeRoom as unknown as BaseRoomConstructor },
  { type: 'provider-hub', factory: ProviderHubRoom as unknown as BaseRoomConstructor },
  { type: 'plugin-bay', factory: PluginBayRoom as unknown as BaseRoomConstructor },
];

/**
 * Register all built-in room types with the room manager.
 * Call this during server boot after initRooms().
 */
export function registerBuiltInRoomTypes(
  registerFn: (type: string, factory: BaseRoomConstructor) => void,
): void {
  for (const { type, factory } of builtInRoomTypes) {
    registerFn(type, factory);
  }
}

// Re-export all room types for direct access
export { DiscoveryRoom } from './discovery.js';
export { ArchitectureRoom } from './architecture.js';
export { CodeLab } from './code-lab.js';
export { TestingLab } from './testing-lab.js';
export { ReviewRoom } from './review.js';
export { DeployRoom } from './deploy.js';
export { WarRoom } from './war-room.js';
export { StrategistOffice } from './strategist.js';
export { BuildingArchitect } from './building-architect.js';
export { DataExchangeRoom } from './data-exchange.js';
export { ProviderHubRoom } from './provider-hub.js';
export { PluginBayRoom } from './plugin-bay.js';
