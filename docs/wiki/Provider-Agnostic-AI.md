# Provider-Agnostic AI

## Overview

Overlord v2 uses an **adapter pattern** for AI providers. The internal format is Anthropic-native. Adapters translate at the boundary. Swap provider = swap one adapter. All provider-specific quirks are contained in the adapter.

**Source:** `src/ai/ai-provider.ts`

## Supported Providers

| Provider | Status | Notes |
|----------|--------|-------|
| **Anthropic** | Stub | Native format — no translation needed |
| **MiniMax** | Stub | Translates from Anthropic format; contains emoji stripping, unicode repair |
| **OpenAI** | Stub | Translates message format (messages → OpenAI chat format) |
| **Ollama** | Stub | Local provider — always available, no API key needed |

All adapters are currently stubs awaiting Phase 3 implementation.

## Adapter Interface

```typescript
interface AIAdapter {
  name: string;
  sendMessage(messages: Message[], tools: Tool[], options: Options): Promise<Response>;
  validateConfig(config: Config): boolean;
}
```

## Internal Format

All messages within Overlord use Anthropic's native format:
- `role`: 'user' | 'assistant'
- `content`: string or content block array
- Tool use blocks with `tool_use` and `tool_result`

Adapters translate at the boundary:
- **Incoming:** Provider response → Anthropic format
- **Outgoing:** Anthropic format → Provider-specific request

## API

### `registerAdapter(name, adapter)`
Register a new AI provider adapter.

### `getAdapter(name)`
Get an adapter by name.

### `sendMessage({ provider, messages, tools, options })`
Send a message through a specific provider:

```typescript
const result = await sendMessage({
  provider: 'anthropic',
  messages: [...],
  tools: roomTools,
  options: { model: 'claude-3-sonnet', maxTokens: 4096 }
});
```

## Configuration

Each provider has its own config in `.env`:

```env
# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-sonnet-20240229

# MiniMax
MINIMAX_API_KEY=...
MINIMAX_MODEL=abab6.5-chat
MINIMAX_GROUP_ID=...

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4-turbo

# Ollama (local)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
```

## Why Anthropic-Native?

The internal format is Anthropic-native because:
1. Anthropic's format is the most expressive (content blocks, tool use blocks)
2. It's easier to translate from complex → simple than simple → complex
3. Overlord v1 was built on Anthropic — minimizes migration effort
4. The core team is most familiar with this format
