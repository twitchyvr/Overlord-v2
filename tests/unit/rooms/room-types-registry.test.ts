import { describe, it, expect, vi } from 'vitest';
import { builtInRoomTypes, registerBuiltInRoomTypes, DiscoveryRoom, ArchitectureRoom, CodeLab, TestingLab, ReviewRoom, DeployRoom, WarRoom, StrategistOffice, BuildingArchitect, DataExchangeRoom, ProviderHubRoom, PluginBayRoom, ResearchRoom, DocumentationRoom, MonitoringRoom, SecurityReviewRoom } from '../../../src/rooms/room-types/index.js';

describe('builtInRoomTypes', () => {
  it('contains exactly 16 room types', () => { expect(builtInRoomTypes).toHaveLength(16); });
  it('contains all expected room type strings in order', () => {
    const types = builtInRoomTypes.map(rt => rt.type);
    expect(types).toEqual(['strategist','building-architect','discovery','research','architecture','code-lab','testing-lab','documentation','review','security-review','deploy','monitoring','war-room','data-exchange','provider-hub','plugin-bay']);
  });
  it('has factory for every entry', () => { for (const e of builtInRoomTypes) expect(typeof e.factory).toBe('function'); });
  it('each type is unique', () => { const t = builtInRoomTypes.map(rt => rt.type); expect(new Set(t).size).toBe(t.length); });
  it('maps correct factories', () => {
    const m = new Map(builtInRoomTypes.map(rt => [rt.type, rt.factory]));
    expect(m.get('research')).toBe(ResearchRoom as unknown);
    expect(m.get('documentation')).toBe(DocumentationRoom as unknown);
    expect(m.get('monitoring')).toBe(MonitoringRoom as unknown);
    expect(m.get('security-review')).toBe(SecurityReviewRoom as unknown);
    expect(m.get('discovery')).toBe(DiscoveryRoom as unknown);
    expect(m.get('deploy')).toBe(DeployRoom as unknown);
  });
});

describe('registerBuiltInRoomTypes()', () => {
  it('calls registerFn 16 times', () => { const fn = vi.fn(); registerBuiltInRoomTypes(fn); expect(fn).toHaveBeenCalledTimes(16); });
  it('registers in correct order', () => {
    const reg: string[] = [];
    registerBuiltInRoomTypes(vi.fn((t: string) => { reg.push(t); }));
    expect(reg).toEqual(['strategist','building-architect','discovery','research','architecture','code-lab','testing-lab','documentation','review','security-review','deploy','monitoring','war-room','data-exchange','provider-hub','plugin-bay']);
  });
});

describe('Room type factories', () => {
  it('each can be instantiated', () => { for (const { type, factory } of builtInRoomTypes) { const r = new factory('t_'+type); expect(r.id).toBe('t_'+type); } });
  it('each has correct static contract', () => { for (const { type, factory } of builtInRoomTypes) { expect((factory as any).contract.roomType).toBe(type); } });
});

describe('Re-exports', () => {
  it('exports all 16 classes', () => {
    for (const cls of [DiscoveryRoom, ArchitectureRoom, CodeLab, TestingLab, ReviewRoom, DeployRoom, WarRoom, StrategistOffice, BuildingArchitect, DataExchangeRoom, ProviderHubRoom, PluginBayRoom, ResearchRoom, DocumentationRoom, MonitoringRoom, SecurityReviewRoom]) {
      expect(typeof cls).toBe('function');
    }
  });
});
