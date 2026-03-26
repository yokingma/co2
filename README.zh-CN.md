<h1 align="center">@fastagent/co2</h1>

<div align="center">
  <a href="./README.md">English</a> | <strong>简体中文</strong>
</div>

`@fastagent/co2` 是一个本地 CLI 网关，用来在 OpenAI-compatible 和 Claude-compatible 协议之间做转换，让现有客户端在不改调用协议的前提下接到另一侧上游。它以本地 HTTP 服务方式运行，支持两种模式：`o2c`（`OpenAI request -> Claude upstream`）和 `c2o`（`Claude request -> OpenAI upstream`）。

## 安装

```bash
npm install -g @fastagent/co2
```

或直接临时执行：

```bash
npx @fastagent/co2 start --config ./co2.config.json
```

## 快速使用

1. 新建 `co2.config.json`

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

说明：

- 上面的配置示例同时展示了 `openai` 和 `anthropic` 两个 provider，只是为了把完整结构一次写全。
- 选择 `openai-to-claude` / `o2c` 模式时，实际只会使用 `providers.anthropic`；`providers.openai` 可以省略，不会影响启动和请求处理。
- 选择 `claude-to-openai` / `c2o` 模式时，实际只会使用 `providers.openai`；`providers.anthropic` 可以省略，不会影响启动和请求处理。
- `routing.defaultClaudeModel` / `routing.claudeOutputEffort` 只影响 `o2c`，`routing.defaultOpenAIModel` / `routing.openAIReasoningEffort` 只影响 `c2o`。
- `routing.skipInboundFields` 用来显式跳过已知的顶层请求字段，这样本地网关在遇到新版 SDK / 客户端新增字段时，可以先靠配置保持可用，不必等待 `co2` 发布新版本。

### `routing.skipInboundFields`

`skipInboundFields` 按入口协议分三组：

- `claudeMessages`：作用于 `POST /v1/messages`
- `openAIResponses`：作用于 `POST /v1/responses`
- `openAIChatCompletions`：作用于 `POST /v1/chat/completions`

行为说明：

- 只做顶层字段名的精确匹配。
- 命中后，`co2` 会在边界层先移除该字段，写一条 `warn` 日志，然后继续处理请求。
- 这个配置适合“真实客户端已经会发，但网关暂时还没建模”的字段。
- 它不会放松其他字段的 typo 校验；没有配置的拼写错误，例如 `thinkingg`，仍然会继续报错。

常见场景：

- Claude Code 当前会在部分 `c2o /v1/messages` 请求里显式发送 `context_management`，可以把它加到 `skipInboundFields.claudeMessages` 里，避免本地联调被拦住。
- 如果未来 OpenAI SDK 在 `/v1/responses` 或 `/v1/chat/completions` 顶层新增字段，也可以把对应字段名加到对应的 skip list 里，而不是等网关发新版。

2. 启动服务

```bash
co2 start --config ./co2.config.json
```

3. 按模式调用路由

- `openai-to-claude`：`POST /v1/chat/completions`、`POST /v1/responses`
- `claude-to-openai`：`POST /v1/messages`

## 模式说明

- `o2c` = `OpenAI request -> Claude upstream`
- `c2o` = `Claude request -> OpenAI upstream`
- 模式名表示的是“入口协议 -> 上游协议”；返回协议默认跟入口保持一致。

| 你的客户端说什么协议 | 你想接到哪个上游 | 应该使用的模式 |
| --- | --- | --- |
| OpenAI `chat/completions` / `responses` | Claude | `o2c` |
| Claude `messages` | OpenAI | `c2o` |

常见情况：

- OpenAI SDK、OpenAI-compatible 应用：通常用 `o2c`
- Claude-compatible 应用、Claude `messages` 客户端：通常用 `c2o`

### `o2c` 示例

```bash
curl http://127.0.0.1:8000/v1/responses \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-5.4",
    "input": [
      {
        "role": "user",
        "content": [
          { "type": "input_text", "text": "你好" }
        ]
      }
    ],
    "instructions": "You are concise."
  }'
```

### `c2o` 示例

把配置里的 `server.mode` 改成 `claude-to-openai` 后：

```bash
curl http://127.0.0.1:8000/v1/messages \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "claude-opus-4.6",
    "max_tokens": 128,
    "messages": [
      { "role": "user", "content": "你好" }
    ]
  }'
```

说明：

- 生产环境建议把密钥放进环境变量；环境变量优先级高于配置文件。
- Anthropic 兼容读取 `ANTHROPIC_AUTH_TOKEN`，但它和 `ANTHROPIC_API_KEY` 同时存在时必须一致。
- 运行时要求 Node.js `>= 20.19.0`。
