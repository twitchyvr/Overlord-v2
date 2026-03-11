# Room-Provider Assignment

## Overview

Different rooms can use different AI models. This allows cost optimization — use expensive models for complex reasoning and cheap models for repetitive tasks.

## Provider Preferences

Each room's contract specifies a `provider` preference:

| Provider Value | Meaning | Example |
|----------------|---------|---------|
| `smart` | Best model available | Claude 3 Opus, GPT-4 |
| `cheap` | Cost-effective model | Claude 3 Haiku, GPT-3.5 |
| `configurable` | Uses room-level or building-level config | User's choice |

## Room-Provider Matrix

| Room | Provider | Rationale |
|------|----------|-----------|
| Strategist Office | `smart` | Complex reasoning, consultative setup |
| Discovery Room | `smart` | Requirements analysis, risk assessment |
| Architecture Room | `smart` | System design, dependency graphs |
| Code Lab | `configurable` | Varies by task complexity |
| Testing Lab | `cheap` | Repetitive test runs |
| Review Room | `smart` | Evidence analysis, go/no-go decisions |
| Deploy Room | `configurable` | Deployment procedures |
| War Room | `smart` | Critical incident response |

## Configuration

Provider mapping is configured in `.env`:

```env
# Provider for 'smart' rooms
PROVIDER_SMART=anthropic
MODEL_SMART=claude-3-opus-20240229

# Provider for 'cheap' rooms
PROVIDER_CHEAP=anthropic
MODEL_CHEAP=claude-3-haiku-20240307

# Provider for 'configurable' rooms (default)
PROVIDER_DEFAULT=anthropic
MODEL_DEFAULT=claude-3-sonnet-20240229
```

## Cost Optimization

The provider assignment system allows significant cost savings:
- **Testing Lab** runs dozens of test iterations — using a cheap model saves 10x vs smart
- **Discovery/Architecture** rooms need deep reasoning — worth the smart model cost
- **Code Lab** varies — simple tasks use cheap, complex implementations use smart
- **War Room** always uses smart — incident response needs the best model
