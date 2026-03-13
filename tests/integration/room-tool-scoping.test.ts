/**
 * Room Tool Scoping Integration Test
 *
 * Proves that room contracts structurally enforce tool access.
 * An agent in a TestingLab CANNOT call write_file because it is not
 * in the room's allowed tools list — this is structural enforcement,
 * not instructional ("please don't write files").
 *
 * Tests the full pipeline: room type registration → room creation →
 * agent entry → tool execution scoping.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  createRoom,
  enterRoom,
  exitRoom,
  submitExitDocument,
  registerRoomType,
  getRoom,
} from '../../src/rooms/room-manager.js';
import { registerTool, executeInRoom } from '../../src/tools/tool-registry.js';
import * as dbModule from '../../src/storage/db.js';
import { TestingLab } from '../../src/rooms/room-types/testing-lab.js';
import { CodeLab } from '../../src/rooms/room-types/code-lab.js';
import { DiscoveryRoom } from '../../src/rooms/room-types/discovery.js';
import { WarRoom } from '../../src/rooms/room-types/war-room.js';
import type { ToolDefinition, ToolContext } from '../../src/core/contracts.js';

let db: Database.Database;

/**
 * Set up in-memory SQLite with required tables.
 * Uses prepare().run() for DDL — not shell exec.
 */
function setupDb(): Database.Database {
  const memDb = new Database(':memory:');
  memDb.pragma('foreign_keys = OFF');
  memDb.prepare(`CREATE TABLE rooms (
    id TEXT PRIMARY KEY, floor_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL,
    allowed_tools TEXT DEFAULT '[]', file_scope TEXT DEFAULT 'assigned',
    exit_template TEXT DEFAULT '{}', escalation TEXT DEFAULT '{}',
    provider TEXT DEFAULT 'configurable', config TEXT DEFAULT '{}',
    status TEXT DEFAULT 'idle', created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  memDb.prepare(`CREATE TABLE tables_v2 (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'focus',
    chairs INTEGER DEFAULT 1, description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  memDb.prepare(`CREATE TABLE agents (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
    building_id TEXT,
    capabilities TEXT DEFAULT '[]', room_access TEXT DEFAULT '[]', badge TEXT,
    status TEXT DEFAULT 'idle', current_room_id TEXT, current_table_id TEXT,
    config TEXT DEFAULT '{}', created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`).run();
  memDb.prepare(`CREATE TABLE exit_documents (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL, type TEXT NOT NULL,
    completed_by TEXT NOT NULL, fields TEXT DEFAULT '{}', artifacts TEXT DEFAULT '[]',
    raid_entry_ids TEXT DEFAULT '[]', created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  return memDb;
}

/**
 * Register mock tools that simulate the real filesystem tools.
 * These track calls so we can verify structural enforcement.
 */
function registerMockTools(): Record<string, { calls: Record<string, unknown>[]; tool: ToolDefinition }> {
  const trackers: Record<string, { calls: Record<string, unknown>[]; tool: ToolDefinition }> = {};

  const toolDefs: Array<{ name: string; description: string; category: string }> = [
    { name: 'read_file', description: 'Read a file', category: 'filesystem' },
    { name: 'write_file', description: 'Write a file', category: 'filesystem' },
    { name: 'patch_file', description: 'Patch a file', category: 'filesystem' },
    { name: 'list_dir', description: 'List directory', category: 'filesystem' },
    { name: 'bash', description: 'Run shell command', category: 'shell' },
    { name: 'web_search', description: 'Search the web', category: 'research' },
    { name: 'fetch_webpage', description: 'Fetch a webpage', category: 'research' },
    { name: 'record_note', description: 'Record a note', category: 'notes' },
    { name: 'recall_notes', description: 'Recall notes', category: 'notes' },
    { name: 'qa_run_tests', description: 'Run test suite', category: 'qa' },
    { name: 'qa_check_lint', description: 'Check linting', category: 'qa' },
    { name: 'qa_check_types', description: 'Check types', category: 'qa' },
    { name: 'qa_check_coverage', description: 'Check coverage', category: 'qa' },
    { name: 'qa_audit_deps', description: 'Audit dependencies', category: 'qa' },
    { name: 'github', description: 'GitHub operations', category: 'vcs' },
  ];

  for (const def of toolDefs) {
    const calls: Record<string, unknown>[] = [];
    const tool: ToolDefinition = {
      ...def,
      inputSchema: { type: 'object' },
      execute: async (params: Record<string, unknown>) => {
        calls.push(params);
        return { success: true, tool: def.name };
      },
    };
    trackers[def.name] = { calls, tool };
    registerTool(tool);
  }

  return trackers;
}

describe('Room Tool Scoping — Integration', () => {
  let trackers: Record<string, { calls: Record<string, unknown>[]; tool: ToolDefinition }>;

  beforeEach(() => {
    db = setupDb();
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db as unknown as ReturnType<typeof dbModule.getDb>);

    // Register all room types being tested
    registerRoomType('testing-lab', TestingLab as any);
    registerRoomType('code-lab', CodeLab as any);
    registerRoomType('discovery', DiscoveryRoom as any);
    registerRoomType('war-room', WarRoom as any);

    // Register mock tools
    trackers = registerMockTools();

    // Seed a universal agent with access to all room types
    db.prepare(`INSERT INTO agents (id, name, role, room_access) VALUES ('agent_qa', 'QA Agent', 'tester', '["testing-lab", "code-lab", "discovery", "war-room"]')`).run();
  });

  describe('TestingLab — write_file is structurally impossible', () => {
    let testingRoomId: string;

    beforeEach(() => {
      const room = createRoom({ type: 'testing-lab', floorId: 'floor_exec', name: 'Test Lab' });
      if (!room.ok) throw new Error('Room creation failed');
      testingRoomId = room.data.id;

      enterRoom({ roomId: testingRoomId, agentId: 'agent_qa', tableType: 'focus' });
    });

    it('TestingLab does NOT include write_file in allowed tools', () => {
      const room = getRoom(testingRoomId);
      expect(room).not.toBeNull();
      expect(room!.getAllowedTools()).not.toContain('write_file');
      expect(room!.getAllowedTools()).not.toContain('patch_file');
      expect(room!.hasTool('write_file')).toBe(false);
      expect(room!.hasTool('patch_file')).toBe(false);
    });

    it('TestingLab DOES include its contracted tools', () => {
      const room = getRoom(testingRoomId);
      const tools = room!.getAllowedTools();
      expect(tools).toContain('read_file');
      expect(tools).toContain('list_dir');
      expect(tools).toContain('bash');
      expect(tools).toContain('qa_run_tests');
      expect(tools).toContain('qa_check_lint');
      expect(tools).toContain('qa_check_types');
      expect(tools).toContain('qa_check_coverage');
      expect(tools).toContain('qa_audit_deps');
    });

    it('executeInRoom rejects write_file in TestingLab', async () => {
      const room = getRoom(testingRoomId);
      const ctx: ToolContext = {
        roomId: testingRoomId,
        roomType: 'testing-lab',
        agentId: 'agent_qa',
        fileScope: room!.fileScope,
      };

      const result = await executeInRoom({
        toolName: 'write_file',
        params: { path: 'src/hack.ts', content: 'malicious code' },
        roomAllowedTools: room!.getAllowedTools(),
        context: ctx,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_NOT_AVAILABLE');
      }

      // Verify write_file was NEVER called
      expect(trackers['write_file'].calls).toHaveLength(0);
    });

    it('executeInRoom rejects patch_file in TestingLab', async () => {
      const room = getRoom(testingRoomId);
      const ctx: ToolContext = {
        roomId: testingRoomId,
        roomType: 'testing-lab',
        agentId: 'agent_qa',
        fileScope: room!.fileScope,
      };

      const result = await executeInRoom({
        toolName: 'patch_file',
        params: { path: 'src/code.ts', search: 'old', replace: 'new' },
        roomAllowedTools: room!.getAllowedTools(),
        context: ctx,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_NOT_AVAILABLE');
      }

      expect(trackers['patch_file'].calls).toHaveLength(0);
    });

    it('executeInRoom allows read_file in TestingLab', async () => {
      const room = getRoom(testingRoomId);
      const ctx: ToolContext = {
        roomId: testingRoomId,
        roomType: 'testing-lab',
        agentId: 'agent_qa',
        fileScope: room!.fileScope,
      };

      const result = await executeInRoom({
        toolName: 'read_file',
        params: { path: 'src/code.ts' },
        roomAllowedTools: room!.getAllowedTools(),
        context: ctx,
      });

      expect(result.ok).toBe(true);
      expect(trackers['read_file'].calls).toHaveLength(1);
    });

    it('executeInRoom allows qa_run_tests in TestingLab', async () => {
      const room = getRoom(testingRoomId);
      const ctx: ToolContext = {
        roomId: testingRoomId,
        roomType: 'testing-lab',
        agentId: 'agent_qa',
        fileScope: room!.fileScope,
      };

      const result = await executeInRoom({
        toolName: 'qa_run_tests',
        params: { suite: 'unit' },
        roomAllowedTools: room!.getAllowedTools(),
        context: ctx,
      });

      expect(result.ok).toBe(true);
      expect(trackers['qa_run_tests'].calls).toHaveLength(1);
    });
  });

  describe('CodeLab — write_file IS available', () => {
    let codeRoomId: string;

    beforeEach(() => {
      const room = createRoom({ type: 'code-lab', floorId: 'floor_exec', name: 'Code Lab' });
      if (!room.ok) throw new Error('Room creation failed');
      codeRoomId = room.data.id;

      enterRoom({ roomId: codeRoomId, agentId: 'agent_qa', tableType: 'focus' });
    });

    it('CodeLab includes write_file and patch_file', () => {
      const room = getRoom(codeRoomId);
      expect(room!.hasTool('write_file')).toBe(true);
      expect(room!.hasTool('patch_file')).toBe(true);
    });

    it('executeInRoom allows write_file in CodeLab', async () => {
      const room = getRoom(codeRoomId);
      const ctx: ToolContext = {
        roomId: codeRoomId,
        roomType: 'code-lab',
        agentId: 'agent_qa',
        fileScope: room!.fileScope,
      };

      const result = await executeInRoom({
        toolName: 'write_file',
        params: { path: 'src/new.ts', content: 'export const x = 1;' },
        roomAllowedTools: room!.getAllowedTools(),
        context: ctx,
      });

      expect(result.ok).toBe(true);
      expect(trackers['write_file'].calls).toHaveLength(1);
    });
  });

  describe('DiscoveryRoom — no write tools, read-only scope', () => {
    let discoveryRoomId: string;

    beforeEach(() => {
      const room = createRoom({ type: 'discovery', floorId: 'floor_collab', name: 'Discovery' });
      if (!room.ok) throw new Error('Room creation failed');
      discoveryRoomId = room.data.id;

      enterRoom({ roomId: discoveryRoomId, agentId: 'agent_qa', tableType: 'collab' });
    });

    it('Discovery room has read-only file scope', () => {
      const room = getRoom(discoveryRoomId);
      expect(room!.fileScope).toBe('read-only');
    });

    it('Discovery room does not include any write tools', () => {
      const room = getRoom(discoveryRoomId);
      expect(room!.hasTool('write_file')).toBe(false);
      expect(room!.hasTool('patch_file')).toBe(false);
      expect(room!.hasTool('bash')).toBe(false);
    });

    it('Discovery room includes research tools', () => {
      const room = getRoom(discoveryRoomId);
      expect(room!.hasTool('web_search')).toBe(true);
      expect(room!.hasTool('fetch_webpage')).toBe(true);
      expect(room!.hasTool('record_note')).toBe(true);
      expect(room!.hasTool('recall_notes')).toBe(true);
    });
  });

  describe('WarRoom — elevated access with full file scope', () => {
    let warRoomId: string;

    beforeEach(() => {
      const room = createRoom({ type: 'war-room', floorId: 'floor_collab', name: 'Incident Room' });
      if (!room.ok) throw new Error('Room creation failed');
      warRoomId = room.data.id;

      enterRoom({ roomId: warRoomId, agentId: 'agent_qa', tableType: 'boardroom' });
    });

    it('War room has full file scope', () => {
      const room = getRoom(warRoomId);
      expect(room!.fileScope).toBe('full');
    });

    it('War room has write tools AND QA tools', () => {
      const room = getRoom(warRoomId);
      expect(room!.hasTool('write_file')).toBe(true);
      expect(room!.hasTool('patch_file')).toBe(true);
      expect(room!.hasTool('qa_run_tests')).toBe(true);
      expect(room!.hasTool('github')).toBe(true);
    });
  });

  describe('Same agent, different rooms — tool access changes', () => {
    it('agent can write in CodeLab but not in TestingLab', async () => {
      // Create both rooms
      const codeRoom = createRoom({ type: 'code-lab', floorId: 'floor_exec', name: 'Code' });
      const testRoom = createRoom({ type: 'testing-lab', floorId: 'floor_exec', name: 'Test' });
      if (!codeRoom.ok || !testRoom.ok) throw new Error('Room creation failed');

      // Agent enters CodeLab — can write
      enterRoom({ roomId: codeRoom.data.id, agentId: 'agent_qa', tableType: 'focus' });
      const codeRoomRef = getRoom(codeRoom.data.id)!;

      const writeInCode = await executeInRoom({
        toolName: 'write_file',
        params: { path: 'x.ts', content: 'ok' },
        roomAllowedTools: codeRoomRef.getAllowedTools(),
        context: { roomId: codeRoom.data.id, roomType: 'code-lab', agentId: 'agent_qa', fileScope: 'assigned' },
      });
      expect(writeInCode.ok).toBe(true);

      // Agent submits exit doc and leaves CodeLab
      await submitExitDocument({
        roomId: codeRoom.data.id,
        agentId: 'agent_qa',
        document: { filesModified: ['x.ts'], testsAdded: ['x.test.ts'], changesDescription: 'test', riskAssessment: 'low' },
      });
      exitRoom({ roomId: codeRoom.data.id, agentId: 'agent_qa' });

      // Agent enters TestingLab — CANNOT write
      enterRoom({ roomId: testRoom.data.id, agentId: 'agent_qa', tableType: 'focus' });
      const testRoomRef = getRoom(testRoom.data.id)!;

      const writeInTest = await executeInRoom({
        toolName: 'write_file',
        params: { path: 'x.ts', content: 'hacked' },
        roomAllowedTools: testRoomRef.getAllowedTools(),
        context: { roomId: testRoom.data.id, roomType: 'testing-lab', agentId: 'agent_qa', fileScope: 'read-only' },
      });
      expect(writeInTest.ok).toBe(false);
      if (!writeInTest.ok) {
        expect(writeInTest.error.code).toBe('TOOL_NOT_AVAILABLE');
      }
    });
  });

  describe('Exit document enforcement across room types', () => {
    it('TestingLab requires test-report exit document', () => {
      const room = createRoom({ type: 'testing-lab', floorId: 'floor_exec', name: 'Lab' });
      if (!room.ok) throw new Error('failed');
      enterRoom({ roomId: room.data.id, agentId: 'agent_qa', tableType: 'focus' });

      // Try to exit without exit document
      const result = exitRoom({ roomId: room.data.id, agentId: 'agent_qa' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXIT_DOC_REQUIRED');
        expect(result.error.message).toContain('testsRun');
        expect(result.error.message).toContain('coverage');
      }
    });

    it('TestingLab allows exit after submitting complete test-report', async () => {
      const room = createRoom({ type: 'testing-lab', floorId: 'floor_exec', name: 'Lab' });
      if (!room.ok) throw new Error('failed');
      enterRoom({ roomId: room.data.id, agentId: 'agent_qa', tableType: 'focus' });

      await submitExitDocument({
        roomId: room.data.id,
        agentId: 'agent_qa',
        document: {
          testsRun: 42,
          testsPassed: 40,
          testsFailed: 2,
          coverage: { lines: 85, branches: 72 },
          lintErrors: 0,
          recommendations: ['Fix flaky test in auth module'],
        },
      });

      const result = exitRoom({ roomId: room.data.id, agentId: 'agent_qa' });
      expect(result.ok).toBe(true);
    });
  });

  describe('Room type registration — all built-in types', () => {
    it('all 4 registered room types can be created', () => {
      const types = [
        { type: 'testing-lab', floor: 'floor_exec' },
        { type: 'code-lab', floor: 'floor_exec' },
        { type: 'discovery', floor: 'floor_collab' },
        { type: 'war-room', floor: 'floor_collab' },
      ];

      for (const { type, floor } of types) {
        const result = createRoom({ type, floorId: floor, name: `${type} Room` });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.type).toBe(type);
        }
      }
    });

    it('unregistered room type is rejected', () => {
      const result = createRoom({ type: 'holodeck', floorId: 'floor_fun', name: 'Fun Room' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN_ROOM_TYPE');
      }
    });
  });
});
