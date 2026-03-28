# Changelog

## 2026-03-28

- 修复 `c2o /v1/messages` 对 Claude Code beta `output_config.effort` 的兼容性：入站 schema 现在额外接受 `none`、`minimal`、`xhigh` 这类 OpenAI 风格 effort 别名，并在标准化阶段分别映射到 OpenAI Responses `reasoning.effort`，避免 `beta=true` 请求因本地校验过严而报 `validation_error`。
- 补充 `c2o messages` 回归测试：覆盖 `beta=true` 请求里 `output_config.effort = minimal|none|xhigh` 的成功透传与映射，锁定这类 Claude Code 请求不再回退到 400。
- 调整 CLI `start` 成功后的标准输出：无论 `logLevel` 如何，都会额外输出一行人类可读的启动提示和一行客户端代理 `base URL` 提示；`claude-to-openai` 模式提示 `ANTHROPIC_BASE_URL=http://host:port`，`openai-to-claude` 模式提示 `OPENAI_BASE_URL=http://host:port/v1`，同时保留 `info` 级 JSON 启动日志。

## 2026-03-23

- 修复 `c2o /v1/messages` 的 Claude usage 兼容性：即使 OpenAI Responses 上游缺失 `usage`，非流式响应与流式 `message_start` 现在也会回传稳定的 Claude 风格 usage scaffold（补齐 `cache_creation_input_tokens`、`cache_read_input_tokens`、`server_tool_use`、`service_tier`、`cache_creation`、`inference_geo`、`iterations`、`speed` 等字段），避免 Claude Code 在读取 `usage.speed` 等扩展字段时因 `usage` 缺失而崩溃。
- 修复流式 token usage 映射：`o2c /v1/responses` 现在会在最终 `response.completed` 快照里携带 `usage`；`c2o /v1/messages` 现在会在最终 `message_delta` 里回写准确的 `input_tokens/output_tokens`；`o2c /v1/chat/completions` 新增 `stream_options.include_usage` 兼容，仅在显式开启时追加官方风格的最终 usage chunk。
- 收紧 `o2c /v1/chat/completions` 的 `stream_options` 边界：嵌套对象现在只接受 `include_usage`，未知字段会按严格校验直接报错；同时补充回归测试，锁定 `include_usage` 缺失或为 `false` 时不得额外发出 usage chunk。
- 修复 `c2o /v1/messages` 对 Claude Code 请求体的兼容性：入站 schema 现在接受 `output_config.effort`，并将其近似映射到 OpenAI `responses.reasoning.effort`；当请求同时携带 `thinking` 与 `output_config` 时，显式 `output_config.effort` 会覆盖由 `thinking` 推导出的默认 effort。
- 调整 `c2o /v1/messages` 的顶层字段策略为“分级兼容”而非全量严格：schema 现在允许未知扩展字段先进入本地判定；像 `future_extension` 这类非 typo 的新字段会被忽略以提高前向兼容性，而 `thinkingg`、`max_tokenss` 这类疑似拼写错误仍会在本地直接报 `Unrecognized key`。
- 为 `c2o /v1/messages` 增加显式边界拒绝：`context_management` 现在会返回稳定的 `unsupported_parameter` 错误，而不是继续落回通用 `Unrecognized key`；这样既避免 Anthropic 上下文裁剪语义被静默吞掉，也不需要因为普通新增字段就频繁升级网关。
- 新增 `routing.skipInboundFields` 配置：可按 `claudeMessages`、`openAIResponses`、`openAIChatCompletions` 三类入口分别声明要跳过的顶层字段；命中后网关会在边界层剥离这些字段、记录 `warn` 日志并继续处理请求，从而允许通过本地配置兼容未来 SDK 新增字段，而不必每次都升级版本。
- 更新本地 `co2.local.json`：默认跳过 Claude Code 当前会显式发送的 `context_management`，使本地 `c2o /v1/messages` 联调可以直接继续转发到 OpenAI 上游。
- 收紧入站 schema 的兼容边界：`chat/completions`、`responses`、`messages` 只对白名单控制面字段做显式兼容吸收，未知顶层字段重新恢复为严格校验，避免把 `max_tokenss`、`thinkingg` 这类拼写错误静默吞掉。
- 修复 `o2c /v1/responses` 的 SSE 编码稳定性：文本 output item 现在复用 Claude `content_block` 的真实 index，不再在“先 tool、后 text”的混合流里错误复用 `output_index: 0` 并覆盖已有 tool item；同一条流内 `response.created` 与 `response.completed` 现在会复用稳定的 `created_at`。
- 调整根 `package.json` 的 `dev/start` 脚本：保留 CLI `start` 子命令，但不再默认强绑仓库内的 `co2.config.json`；同时把仓库样例配置里的第三方代理地址恢复为官方 OpenAI / Anthropic API 地址，避免把个人上游配置误当成项目默认值。
- 将项目按公开 npm CLI 包形态收敛：包名改为 `@fastagent/co2`，移除 `private` 阻塞，补充 `description`、`license`、`homepage`、`repository`、`bugs`、`keywords`、`engines` 与 `publishConfig.access = "public"` 元数据。
- 为 npm 发包增加最小发布约束：新增 `files` 白名单，仅发布 `dist/`、`README.md`、`CHANGELOG.md` 与 `LICENSE`；新增 `prepublishOnly` 与 `prepack` 脚本，在发布前自动执行测试、类型检查与构建。
- 新增 `LICENSE`（MIT），并重写根 `README.md` 为面向 npm / GitHub 发布的 CLI 首页：只保留简介、安装、完整配置示例与快速使用说明，不再暴露内部 docs、项目结构或阶段性 `V1` 表述。
- 新增 CLI 包 manifest 回归测试，锁定 scoped 公共发布配置、运行时元数据、发包脚本与白名单文件。
- 修复 `o2c` 工具名兼容性：当 OpenAI 风格请求里的函数工具名不满足 Anthropic `^[a-zA-Z0-9_-]{1,128}$` 约束时，网关现在会在单次请求作用域内自动生成 Anthropic-safe 别名，并同步改写上游 `tools`、`tool_choice` 与历史 `function_call/tool_calls`，避免 `functions.exec_command`、`multi_tool_use.parallel` 这类真实客户端工具名触发上游 `400 Improperly formed request`。
- 补齐 `o2c` 工具名回写保真：Claude 非流式响应与 SSE `tool_use` 事件里的别名工具名现在会在返回 OpenAI `responses` / `chat.completions` 前还原为客户端原始工具名，保持客户端工具分发与历史对账稳定。
- 修复 `o2c /v1/responses` 的多轮工具历史映射：连续的 assistant `message/function_call` 与 user `function_call_output` 现在会在发往 Claude 前按 turn 合并，收敛成单个 assistant `tool_use...` turn 和紧随其后的 user `tool_result...` turn，避免真实客户端多工具回合被拆成 `assistant, assistant, user, user` 这类非标准结构后再触发上游 `400 Improperly formed request`。
- 新增回归测试：覆盖 `responses`、`chat/completions` 以及两条流式桥接路径上的“非法 Claude 工具名 -> Anthropic-safe 别名 -> 对外还原原名”全链路行为。
- 新增 `o2c responses` 回归测试，锁定 OpenAI Responses 工具历史必须按 Anthropic turn 语义合并，而不是逐 item 机械拆成多条消息。
- 调整协议边界为“兼容优先”策略：`chat/completions`、`responses`、`messages` 入站 schema 改为接受额外控制面字段，不再因无关 SDK 参数直接触发 `Unrecognized key`。
- 为 `o2c /v1/responses` 增加显式边界拒绝：`previous_response_id`、`conversation`、`text` 配置，以及 `parallel_tool_calls=true` 现在会在本地返回稳定的 `unsupported_parameter` 错误，而不是把不兼容请求直接推给上游。
- 为 `o2c /v1/chat/completions` 增加兼容别名与公共采样参数支持：接受 `max_tokens` 作为 `max_completion_tokens` 兼容别名，接受官方 `reasoning_effort` 并映射到 Claude `thinking/output_config`，同时补齐 `top_p` → Claude `top_p` 映射。
- 为 `o2c /v1/chat/completions` 增加显式边界拒绝：`parallel_tool_calls=true`、非文本 `modalities` 与 `audio` 输出配置会在本地稳定报错；非 `function` 工具类型改为显式 `unsupported_tool_type`。
- 为 `c2o /v1/messages` 增加兼容与收敛：接受额外 Claude 控制面字段，补齐 `top_p` → OpenAI Responses `top_p` 映射，并在存在工具时显式下发 `parallel_tool_calls: false`，锁定 `V1` 的顺序工具调用约束。
- 为 `c2o /v1/messages` 增加显式边界拒绝：`top_k` 以及带 `type` 的 Anthropic server tools 现在会在本地直接报错，避免语义不保真的字段静默漂移到 OpenAI 上游。
- 补充兼容性回归测试：覆盖额外控制面字段容忍、`previous_response_id`/`top_k`/并行工具调用的显式拒绝、`top_p` 映射，以及 OpenAI Chat 兼容别名与 `reasoning_effort` 映射。
- 修复根 `package.json` 的 `dev/start` 脚本：显式补上 CLI `start` 子命令，避免本地执行时只打印帮助信息后退出。
- 新增 `tests/cli/package-scripts.test.ts` 回归测试，锁定本地脚本必须携带 `start` 子命令，且不能依赖仓库内 `co2.config.json` 才能运行。
- 配置加载新增 `ANTHROPIC_AUTH_TOKEN` 兼容别名；当 `ANTHROPIC_API_KEY` 未设置时可回退使用，若两者同时非空但值不同则启动失败。
- 调整 `o2c` 缺失凭证报错文案，明确提示 `ANTHROPIC_API_KEY` 与 `ANTHROPIC_AUTH_TOKEN` 二选一即可。
- 补充运行时配置回归测试，覆盖 Anthropic env 别名回退、双变量一致、双变量冲突与缺失提示文案。
- 放宽 `o2c /v1/responses` 入站校验：接受官方 typed message item 子集，包括显式 `type: "message"`、`developer` 角色，以及 assistant 历史里的 `output_text` 文本块。
- 修复 `o2c /v1/responses` 映射：OpenAI `developer` 消息现在会并入 Claude `system` 指令，不再在本地 schema 阶段误报 `input` 非法。
- 新增 `o2c responses` 回归测试，覆盖 typed message item、developer 指令与 assistant `output_text` 历史输入。
- 修复 `o2c /v1/responses` 的 SSE `response.created` 事件：现在会初始化 `response.output: []`，避免快照式客户端在处理后续 `response.output_item.added` 时因 `snapshot.output` 未定义而崩溃。
- 补充流桥接回归测试，锁定 `response.created` 事件必须携带空 `output` 数组。
- 进一步修复 `o2c /v1/responses` SSE 事件与 `openai@6.27.0` `ResponseStream` 的兼容性：message `output_item.added` 现在预置空 `output_text` content，`response.completed` 会携带最终 `output` 快照，文本/函数参数流事件补充 `sequence_number`，文本事件补充空 `logprobs`，函数参数完成事件补充 `name`。

## 2026-03-16

- 新增 `routing.claudeOutputEffort` 配置项；未配置时不传，配置后仅在 `o2c -> Claude Messages` 请求完全未带 `reasoning` 时作为默认 `output_config.effort` 下发；若请求已显式传 `reasoning`（包括仅 `summary` 或 `effort: 'none'`），则仍以请求映射结果为准。
- 新增 `routing.openAIReasoningEffort` 配置项；未配置时不传，配置后作为 `c2o -> OpenAI Responses` 的默认 `reasoning.effort` 下发，且请求显式 `thinking/reasoning` 仍优先。
- 修复运行时配置加载：环境变量中的空字符串现在视为“未设置”，不再因为无关 provider 的空 key 在启动前触发 `Zod` 边界错误。
- 补充配置加载回归测试：覆盖“无关 provider 空 env 被忽略”与“当前模式必需 key 为空时按缺失处理”的行为。
- 补充 `o2c` 回归测试与日志覆盖：显式 `reasoning.summary` 不再误触发默认 Claude effort，显式 `reasoning.effort: 'none'` 会稳定压过配置默认值。

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
- 增加完整上游请求体日志：在调用 OpenAI / Anthropic 上游前输出脱敏前的完整请求结构，便于和客户端直连请求做逐字段对比。
- 调整 `tool_choice` 默认行为：当请求包含 `tools` 且未显式指定时，自动补 `auto`。
- 调整 OpenAI Responses function tools 的默认 `strict` 标志为 `false`，以贴近真实客户端实现与常见兼容实现。
