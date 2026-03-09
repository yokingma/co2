# Changelog

## 2026-03-09

- 初始化 `co2` 单包 TypeScript 项目骨架。
- 新增 CLI、配置、路由、协议映射、流式桥接与测试基础设施。
- 实现 `Chat Completions`、`Responses`、`Messages` 与核心函数工具调用的 `V1` 网关能力。
- 完成 `V1` 实现并通过 `pnpm build` 与 `pnpm test` 验证。
- 修复流式响应在已发送头后出错时的 SSE 内联错误回写，避免 `ERR_HTTP_HEADERS_SENT`。
- 修复 Claude `tool_use` → OpenAI Responses 流式桥接时丢失工具名称与参数的问题。
- 修复 Anthropic 上游客户端未透传 `anthropic-version` 配置的问题，并对非法工具参数 JSON 改为显式报错。
- 更新根 `README.md`：按当前真实实现补齐运行方式、路由矩阵、配置优先级、示例请求与 `V1` 限制说明。
- 更新根 `README.md`：补充 `o2c / c2o` 的方向说明、客户端对照表，以及 Claude 风格客户端应优先使用 `c2o` 的解释。
- 更新根 `README.md`：补充一句防歧义说明，明确模式名表示“入口协议 -> 上游协议”，返回协议默认跟入口一致。
- 新增 `co2.config.json` 本地测试配置样例，按 `c2o` + OpenAI-compatible 上游方式预置基础字段。
- 支持通过 `providers.openai.defaultHeaders` 与 `providers.anthropic.defaultHeaders` 配置上游默认请求头，且显式禁止覆盖鉴权头。
- 正式支持请求侧 `thinking / reasoning` 映射：Claude `thinking` 可映射到 OpenAI `responses.reasoning`，OpenAI `reasoning` 可映射到 Claude `thinking`。
- 更新根 `README.md`：补充 `thinking / reasoning` 的支持边界，明确请求侧正式支持、返回侧保守处理。
- 补强路由失败日志：记录安全的错误上下文，包括方法、URL、body 顶层 keys、关键请求头摘要与 Zod issue 列表。
- 增加上游请求摘要日志：在调用 OpenAI / Anthropic 上游前输出安全的参数摘要，便于定位具体是哪组映射参数触发上游错误。
- 修正根 `README.md` 的开发模式命令，改为实际可运行的 `pnpm exec tsx ... start ...` 用法。
