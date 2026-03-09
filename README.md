# CO2

本地运行的 OpenAI / Claude 协议转换网关。

当前 `V1` 已实现：
- `o2c`：`POST /v1/chat/completions`、`POST /v1/responses`
- `c2o`：`POST /v1/messages`
- 核心函数工具调用子集
- 请求侧支持 `Claude thinking` 与 `OpenAI Responses reasoning` 的近似映射
- `json / sse` 两种传输模式
- 所有响应统一回写 `x-co2-request-id`


## 模式说明

### 一句话理解

- `o2c` = **OpenAI request -> Claude upstream**
- `c2o` = **Claude request -> OpenAI upstream**
- 模式名表示的是 **入口协议 -> 上游协议**；返回协议默认跟入口保持一致。

### 什么时候用哪个模式

| 你的客户端说什么协议 | 你想接到哪个上游 | 应该使用的模式 |
| --- | --- | --- |
| OpenAI `chat/completions` / `responses` | Claude | `o2c` |
| Claude `messages` | OpenAI | `c2o` |

### 常见客户端对照

- OpenAI SDK、OpenAI-compatible 应用、只支持 `chat/completions` / `responses` 的工具：通常用 `o2c`
- Claude-compatible 应用、Claude `messages` 客户端：通常用 `c2o`
- 如果你的目标是“把 OpenAI 能力接到 Claude 风格客户端里使用”，一般应该选 `c2o`

### 关于 Claude Code

如果某个 Claude 风格客户端允许你：
- 自定义 API Base URL
- 指向一个 Claude-compatible `messages` 入口

那么要接 OpenAI 上游时，通常应该使用 `c2o`，因为：
- 客户端说的是 Claude `messages` 协议
- `co2` 再把它转换成 OpenAI `responses` 上游请求

反过来，`o2c` 适合“OpenAI 风格客户端去用 Claude”。

## 当前能力

### `o2c` 模式

- 对外暴露 OpenAI 风格接口
- 实际调用 Claude Messages 上游
- 支持 `Chat Completions` 文本与函数工具子集
- 支持 `Responses` 文本、`instructions` 与函数工具子集

### `c2o` 模式

- 对外暴露 Claude Messages 接口
- 实际调用 OpenAI `Responses` 上游
- 支持文本消息、核心工具回合，以及 `thinking -> reasoning` 请求映射
- 支持 `tool_use / tool_result` 往返映射

## 当前限制

以下能力不在 `V1`：
- 多模态输入输出
- `developer` 角色
- 并行 tool calls
- `previous_response_id`
- 返回侧不做 `thinking / reasoning` 的标准一对一还原
- `computer use`、`web search`、`file search`、`code interpreter`、`remote MCP`

## 环境要求

- Node.js `>= 22`
- `pnpm` `10.x`

## 安装

```bash
pnpm install
```

## 构建与测试

```bash
pnpm build
pnpm test
```

## 启动

### 开发模式

```bash
ANTHROPIC_API_KEY=your-key pnpm exec tsx src/cli/index.ts start --mode o2c --port 8000
OPENAI_API_KEY=your-key pnpm exec tsx src/cli/index.ts start --mode c2o --port 8000
```

### 构建后运行

```bash
pnpm build
ANTHROPIC_API_KEY=your-key node dist/cli/index.js start --mode o2c --port 8000
OPENAI_API_KEY=your-key node dist/cli/index.js start --mode c2o --port 8000
```

### 可选参数

```bash
co2 start --mode o2c --host 127.0.0.1 --port 8000 --log-level info
co2 start --mode c2o --config ./co2.config.json
```

## 路由矩阵

### `o2c`

- `GET /healthz`
- `POST /v1/chat/completions`
- `POST /v1/responses`

### `c2o`

- `GET /healthz`
- `POST /v1/messages`

非当前模式或未知路由统一返回 `404`。

## 配置

### 环境变量

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_VERSION`
- `CO2_CONFIG`

### 配置文件示例

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
      "baseUrl": "https://api.openai.com/v1"
    },
    "anthropic": {
      "baseUrl": "https://api.anthropic.com",
      "version": "2023-06-01"
    }
  },
  "routing": {
    "defaultOpenAIModel": "gpt-4.1",
    "defaultClaudeModel": "claude-sonnet-4-20250514"
  },
  "modelMap": {
    "gpt-4.1": "claude-sonnet-4-20250514",
    "claude-sonnet-4-20250514": "gpt-4.1"
  }
}
```

### 配置优先级

- 非敏感字段：`CLI > config file > defaults`
- 敏感密钥：`env > config file`




### thinking / reasoning 支持边界

当前 `V1` 的支持方式是：
- **请求侧正式支持**：Claude `thinking` 会近似映射到 OpenAI `responses.reasoning`
- **请求侧正式支持**：OpenAI `responses.reasoning` 会近似映射到 Claude `thinking`
- **返回侧保守处理**：不伪造标准 Claude `thinking` block，也不承诺把 OpenAI `reasoning` 无损还原成 Claude `thinking`

这意味着：
- 你可以在请求里继续传 `thinking` / `reasoning`
- 网关会尽量把“多想一点”的意图映射给对端模型
- 但返回结果默认仍以正常文本 / 工具结果为主

### 可配置默认请求头

你可以在配置文件中通过 `providers.openai.defaultHeaders` 或 `providers.anthropic.defaultHeaders` 为上游请求补充默认 header。

示例：

```json
{
  "providers": {
    "openai": {
      "baseUrl": "https://gmn.chuangzuoli.com/v1",
      "defaultHeaders": {
        "user-agent": "co2-local-test/0.1 curl-compatible",
        "x-client-name": "co2-local"
      }
    }
  }
}
```

规则：
- 配置中的 header 字段可以覆盖 SDK 默认 header 值
- 但不允许覆盖鉴权头
- OpenAI 不允许配置 `authorization`
- Anthropic 不允许配置 `x-api-key`

## 示例请求

### `o2c` / Chat Completions

```bash
curl http://127.0.0.1:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-4.1",
    "messages": [{"role": "user", "content": "你好"}],
    "max_completion_tokens": 128
  }'
```

### `o2c` / Responses

```bash
curl http://127.0.0.1:8000/v1/responses \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-4.1",
    "input": [{"role": "user", "content": [{"type": "input_text", "text": "你好"}]}],
    "instructions": "You are concise."
  }'
```

### `c2o` / Claude Messages

```bash
curl http://127.0.0.1:8000/v1/messages \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 128,
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

## 项目结构

```text
src/
  cli/
  server/
  config/
  schemas/
  protocols/
  adapters/
  upstream/
  shared/
tests/
docs/
```

## 文档

- `docs/research/README.md`
- `docs/spec/README.md`
- `docs/plan/README.md`
