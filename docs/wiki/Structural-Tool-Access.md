# Structural Tool Access

## The Core Principle

> If a tool isn't in the room's allowed list, **it doesn't exist**.

This is the single most important architectural decision in Overlord v2. Tool access is **structural**, not **instructional**.

## v1 vs v2

### v1: Instructional (Trust-Based)
```
System prompt: "You have access to these tools: read_file, write_file.
Please do not use write_file unless you have approval."
```

Problems:
- LLMs ignore instructions ("I'll just quickly fix this file...")
- 4-tier approval system added complexity without reliability
- Confidence scores and escalation chains were unpredictable

### v2: Structural (Enforcement-Based)
```typescript
// Testing Lab contract
tools: ['read_file', 'list_dir', 'bash', 'qa_run_tests', ...]
// write_file is NOT HERE. Period.
```

The tool literally cannot be called. It's not in the API response. It's not in the agent's context. It doesn't exist.

## How It Works

1. **Room defines tools** in its static contract:
   ```typescript
   static contract = {
     tools: ['read_file', 'bash', 'qa_run_tests']
   };
   ```

2. **Agent enters room** → gets only those tools:
   ```typescript
   const tools = getToolsForRoom(room.config.tools);
   // Returns definitions for only the 3 allowed tools
   ```

3. **Execution validates** before running:
   ```typescript
   if (!roomAllowedTools.includes(toolName)) {
     return err('TOOL_NOT_AVAILABLE', ...);
   }
   ```

4. **AI provider** only receives the room's tools in its API call — the model never sees tools it can't use.

## The Key Test

The structural enforcement invariant is tested:

```typescript
// tests/unit/rooms/base-room.test.ts
test('TestingLab does NOT have write_file', () => {
  const lab = new TestingLab('test-id');
  expect(lab.hasTool('write_file')).toBe(false);
});

test('CodeLab HAS write_file', () => {
  const lab = new CodeLab('test-id');
  expect(lab.hasTool('write_file')).toBe(true);
});
```

If this test ever fails, the core architectural invariant is broken.

## Why This Matters

| Instructional | Structural |
|---------------|-----------|
| "Don't use write_file" | write_file doesn't exist |
| Can be ignored | Cannot be circumvented |
| Requires trust in LLM | Requires no trust |
| Fails under pressure | Works always |
| Complex approval chains | Binary: exists or doesn't |

## Practical Example

A QA agent is testing code in the Testing Lab. It finds a bug.

**v1 behavior:** "I see the bug, let me just fix it real quick..." → writes to production code during testing.

**v2 behavior:** The QA agent's available tools are `read_file, list_dir, bash, qa_*`. There is no `write_file`. It physically cannot modify code. It must:
1. Document the bug with file path and line number
2. Submit a test report exit document
3. Escalate to Code Lab (per escalation rules)

The developer agent in the Code Lab then fixes the bug in the proper room with proper context.
