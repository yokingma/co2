<h1 align="center">@fastagent/co2</h1>

<div align="center">
  <strong>English</strong> | <a href="./README.zh-CN.md">简体中文</a>
</div>

`@fastagent/co2` is a local CLI gateway that translates between OpenAI-compatible and Claude-compatible protocols, so existing clients can talk to the other upstream without changing their request protocol. It runs as a local HTTP service and supports two modes: `o2c` (`OpenAI request -> Claude upstream`) and `c2o` (`Claude request -> OpenAI upstream`).

## Install

```bash
npm install -g @fastagent/co2
```

Or run it directly without installing:

```bash
npx @fastagent/co2 start --config ./co2.config.json
```

## Quick Start

1. Create `co2.config.json`

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 8000,
    "mode": "openai-to-claude",
    "logLevel": "info"
  },
  "providers": {
    "openai": {
      "apiKey": "OPENAI_API_KEY_PLACEHOLDER",
      "baseUrl": "https://api.openai.com/v1",
      "defaultHeaders": {
        "user-agent": "co2-cli/0.2.0"
      }
    },
    "anthropic": {
      "apiKey": "ANTHROPIC_API_KEY_PLACEHOLDER",
      "baseUrl": "https://api.anthropic.com",
      "version": "2023-06-01",
      "defaultHeaders": {
        "user-agent": "co2-cli/0.2.0"
      }
    }
  },
  "routing": {
    "defaultOpenAIModel": "gpt-5.4",
    "defaultClaudeModel": "claude-opus-4.6",
    "openAIReasoningEffort": "high",
    "claudeOutputEffort": "high",
    "skipInboundFields": {
      "claudeMessages": ["context_management"],
      "openAIResponses": [],
      "openAIChatCompletions": []
    }
  },
  "modelMap": {
    "claude-opus-4.6": "gpt-5.4",
    "gpt-5.4": "claude-opus-4-6"
  }
}
```

Notes:

- The example shows both `openai` and `anthropic` providers so the full config shape is visible in one place.
- In `openai-to-claude` / `o2c`, only `providers.anthropic` is used. `providers.openai` can be omitted without affecting startup or request handling.
- In `claude-to-openai` / `c2o`, only `providers.openai` is used. `providers.anthropic` can be omitted without affecting startup or request handling.
- `routing.defaultClaudeModel` and `routing.claudeOutputEffort` only affect `o2c`. `routing.defaultOpenAIModel` and `routing.openAIReasoningEffort` only affect `c2o`.
- `routing.skipInboundFields` lets you explicitly drop known top-level request fields before validation, so you can keep a local gateway working with newer SDK/client fields without waiting for a new `co2` release.

### `routing.skipInboundFields`

`skipInboundFields` is split by inbound protocol:

- `claudeMessages`: applies to `POST /v1/messages`
- `openAIResponses`: applies to `POST /v1/responses`
- `openAIChatCompletions`: applies to `POST /v1/chat/completions`

Behavior:

- Matching is exact and only applies to top-level fields.
- When a field is skipped, `co2` removes it at the boundary, logs a `warn`, and continues processing the request.
- This is intended for fields that are known to be sent by real clients but are not yet modeled by the gateway.
- It does not relax typo protection for other fields; unconfigured misspellings such as `thinkingg` still fail validation.

Common examples:

- Claude Code currently sends `context_management` on some `c2o /v1/messages` requests. Add it to `skipInboundFields.claudeMessages` to keep those requests working.
- If a future OpenAI SDK starts sending a new top-level field on `/v1/responses` or `/v1/chat/completions`, add that exact field name to the corresponding skip list instead of waiting for a new release.

2. Start the server

```bash
co2 start --config ./co2.config.json
```

3. Call the route that matches the current mode

- `openai-to-claude`: `POST /v1/chat/completions`, `POST /v1/responses`
- `claude-to-openai`: `POST /v1/messages`

## Modes

- `o2c` = `OpenAI request -> Claude upstream`
- `c2o` = `Claude request -> OpenAI upstream`
- The mode name is always `incoming protocol -> upstream protocol`; response protocol stays aligned with the incoming side by default.

| What protocol your client speaks | What upstream you want | Mode to use |
| --- | --- | --- |
| OpenAI `chat/completions` / `responses` | Claude | `o2c` |
| Claude `messages` | OpenAI | `c2o` |

Common cases:

- OpenAI SDK and other OpenAI-compatible clients usually use `o2c`.
- Claude-compatible clients and Claude `messages` clients usually use `c2o`.

### `o2c` Example

```bash
curl http://127.0.0.1:8000/v1/responses \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-5.4",
    "input": [
      {
        "role": "user",
        "content": [
          { "type": "input_text", "text": "Hello" }
        ]
      }
    ],
    "instructions": "You are concise."
  }'
```

### `c2o` Example

After changing `server.mode` to `claude-to-openai`:

```bash
curl http://127.0.0.1:8000/v1/messages \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "claude-opus-4.6",
    "max_tokens": 128,
    "messages": [
      { "role": "user", "content": "Hello" }
    ]
  }'
```

Notes:

- For production, prefer environment variables for API keys; environment variables take precedence over the config file.
- `ANTHROPIC_AUTH_TOKEN` is accepted as a compatibility alias, but if it exists together with `ANTHROPIC_API_KEY`, they must be identical.
- Node.js `>= 20.19.0` is required.
