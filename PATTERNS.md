# Patterns

## Code Structure Pattern

- 单包仓库，按 `src/cli`、`src/server`、`src/config`、`src/schemas`、`src/protocols`、`src/adapters`、`src/upstream`、`src/shared` 分层。
- `zod` 仅用于边界层校验，不进入核心转换逻辑。
- 对外协议与内部 normalized model 解耦。
- OpenAI Responses function tools 默认使用 `strict: false`，除非用户明确要求走严格 schema 模式。

## Gateway Pattern

- `contract` 与 `transport` 严格分层。
- `V1` 支持文本、核心函数工具与图片输入；图片输出、生图、音频与文件输入继续留在后续版本。
- 路由注册按 `o2c / c2o` 模式显式分流。
- SSE 路径一旦开始写流，后续异常必须回写流内 `error` 事件，不能再回退到普通 JSON 错误响应。

## Protocol Defaults

- `o2c` 同时暴露 `chat/completions` 与 `responses`。
- `c2o` 默认以上游 OpenAI `responses` contract 为目标。
- 核心工具调用仅支持函数 / JSON Schema 子集；并行工具与内建工具进入 `V2`。
- 边界层顶层字段默认采用“分级兼容”而不是全量严格：已知可本地消费或可无损忽略的字段进入显式 allowlist；已知但语义敏感且当前无等价映射的字段必须稳定返回 `unsupported_parameter`；真正未知且不像 typo 的扩展字段可先忽略以保持前向兼容；疑似拼写错误仍应直接报 `Unrecognized key`。
- 对不支持但语义敏感的字段，必须在边界层返回稳定错误并指出参数名，例如 `previous_response_id`、`conversation`、`parallel_tool_calls=true`、`top_k`，而不是把请求原样推给上游后再吃随机 `400`。
- 图片输入统一先归一化到内部 `NormalizedContentPart.type = "image"`，只保留两类 source：`url` 与 `base64`；任何 provider-specific 结构都不应穿透到内部 normalized model。
- `o2c /v1/responses` 与 `o2c /v1/chat/completions` 当前只接收图片输入，不接收图片输出；OpenAI 图片输入来源只支持 `http(s)` URL 与 `data:image/...;base64,...`。
- `o2c /v1/responses` 对 `input_image.file_id` 必须在边界层显式返回 `unsupported_parameter`；`V1` 纯协议代理不负责把 OpenAI 文件句柄解析成 Anthropic 可消费的图片内容。
- `c2o /v1/messages` 当前接收 Anthropic `image` content block，并映射到 OpenAI `input_image`；Anthropic `source.type` 只支持 `url` 与 `base64`。
- 图片输入只在用户消息里视为可保真语义；非 user 角色的图片 history block 必须忽略并输出 `warn`，不能偷偷映射到上游。
- 图片输入上的控制字段若当前无法保真，例如 OpenAI `detail`，必须输出 `warn` 后继续转发可保真的主语义，不能静默吞掉。
- 无法解析的图片块、当前版本不支持的多模态控制字段，统一走“忽略并警示”策略；如果过滤后整条消息为空，必须在边界层返回 `validation_error`，不能把空消息继续推给上游。
- `o2c /v1/chat/completions` 的 user message 可接受 `string` 或 `[text, image_url]` 多模态数组；`audio` 与包含非 `text` 的 `modalities` 需要在边界层剥离并记录 `warn`，不能再直接报错阻塞请求。
- `o2c /v1/responses` 必须接受官方 typed message item 子集：允许显式 `type: 'message'`，允许 `developer` 角色并映射为 Claude `system`，允许 assistant 历史中的 `output_text` 文本块；当前 `V1` 额外支持 `input_image` 图片输入块。
- `o2c /v1/responses` 在把 OpenAI `input` 映射到 Claude `messages` 时，不能按 item 机械一一翻译；同一回合中相邻的 assistant 文本与 `function_call` 必须合并成一个 assistant turn，相邻的 `function_call_output` 必须合并成紧随其后的一个 user turn，保持 Anthropic tool-use 的 turn 语义。
- `o2c /v1/chat/completions` 与 `o2c /v1/responses` 应优先补齐双方共有且可安全保真的公共参数，如 `top_p`；OpenAI Chat 的常见兼容别名 `max_tokens`、`functions`、`function_call` 也应在边界层吸收并归一化，避免客户端因历史参数名直接失败。
- `o2c` 遇到不满足 Anthropic 命名约束的 OpenAI 工具名时，必须使用“请求作用域、可逆”的别名映射，而不是直接拒绝或做会碰撞的简单替换；别名需要同时作用于上游 `tools`、`tool_choice`、历史 `tool-call` 消息，并在 Claude 回包与流式事件中还原为客户端原始工具名。
- `OpenAI Chat reasoning_effort` 与 `OpenAI Responses reasoning.effort` 在 `o2c` 路径都应复用同一套 Claude `thinking / output_config.effort` 解析逻辑，避免不同入口对同一推理强度语义出现漂移。
- `o2c /v1/responses` 的 SSE `response.created` 事件必须初始化 `response.output = []`；否则依赖快照重建的客户端会在后续 `response.output_item.added` 阶段因 `snapshot.output.push(...)` 崩掉。
- `o2c /v1/responses` 的文本流事件必须兼容 OpenAI SDK `ResponseStream` 的快照累加逻辑：`response.output_item.added` 的 message item 需要预置空 `output_text` content；`response.completed` 必须携带最终 `output` 快照；相关流事件需带 `sequence_number`，文本 delta/done 需稳定带 `logprobs: []`。
- `o2c /v1/responses` 的最终 `response.completed` 事件必须携带完整 `usage` 快照，供 OpenAI Responses 流式客户端在收尾阶段获取 token 统计；`response.created` 不得伪造最终 usage。
- `o2c /v1/responses` 在编码 Claude 流式 `content_block` 时，必须保留真实的 block index；混合 `tool_use` 与文本输出时禁止把文本 item 硬编码到 `output_index: 0`，否则会破坏最终 `output` 快照顺序。
- 同一条 `o2c /v1/responses` SSE 流里的 `response.created` 与 `response.completed` 必须复用同一个 `created_at`，因为它们是同一逻辑 response 资源的不同快照。
- `o2c /v1/chat/completions` 只有在请求显式传 `stream_options.include_usage = true` 时，才应追加官方风格的最终 usage chunk；未开启时不得在流里注入 usage。
- `o2c /v1/chat/completions` 的 `stream_options` 必须保持显式 allowlist 且严格校验；当前仅接受 `include_usage`，未知嵌套字段应直接报 `Unrecognized key`，避免客户端拼写错误被静默放过。
- `c2o /v1/messages` 在桥接 OpenAI Responses 流时，不得伪造中途累计 usage；应在拿到最终 `response.completed.usage` 后，把准确的 `input_tokens/output_tokens` 写入最后一个 Claude `message_delta.usage`。
- `o2c` 可通过 `routing.claudeOutputEffort` 仅为完全未传 `reasoning` 的请求补默认 Claude `output_config.effort`；若请求已显式传 `reasoning`（包括只有 `summary` 或 `effort: 'none'`），必须以请求映射结果为准，且默认值生效时必须同时补 `thinking: { type: 'adaptive' }`。
- `c2o` 可通过 `routing.openAIReasoningEffort` 为未显式传 `thinking` 的请求补默认 OpenAI `reasoning.effort`；若请求已有 `thinking/reasoning`，必须以请求值优先。
- `c2o /v1/messages` 需显式兼容 Claude `output_config.effort`；它属于可本地消费的控制面字段，必须近似映射到 OpenAI `responses.reasoning.effort`，且当请求同时携带 `thinking` 与 `output_config.effort` 时，以显式 `output_config.effort` 为准。
- `c2o /v1/messages` 不应因为 Anthropic 新增的普通顶层扩展字段就频繁发版；但像 `context_management` 这类会影响上下文裁剪的字段也不能默认静默吞掉。未配置跳过时，必须在本地显式报 `unsupported_parameter`，避免客户端误以为语义已生效。
- 若需要兼容真实客户端已知会发送、但当前网关暂不支持语义的新增顶层字段，应优先通过 `routing.skipInboundFields` 做“按入口协议、按字段名”的显式跳过，而不是继续放宽全局 schema。跳过只允许精确命中顶层字段，并必须输出 `warn` 日志；未配置的字段仍按原有边界规则处理。
- `routing.skipInboundFields` 需按三类入站协议分别配置：`claudeMessages`、`openAIResponses`、`openAIChatCompletions`。这样未来 OpenAI / Claude 任一侧新增字段时，都可以仅改本地配置完成兼容，而不影响其他入口的校验策略。
- 环境变量边界层需把空字符串视为未设置，仅在真正需要对应 provider key 的模式下再做缺失校验，避免无关 provider 的空 env 提前阻塞启动。
- Anthropic 凭证允许兼容读取 `ANTHROPIC_AUTH_TOKEN`，但它只是 `ANTHROPIC_API_KEY` 的 env 别名；两个 env 同时非空时必须一致，禁止静默偏向任一方。
- 所有响应统一回写 `x-co2-request-id`。
- 工具参数 JSON 必须严格保真；解析失败直接返回映射错误，禁止静默兜底为空对象。
- Anthropic 上游请求统一携带配置化 `anthropic-version` 默认头。
- `c2o` 发往 OpenAI Responses 的工具请求必须显式约束 `parallel_tool_calls: false`，与网关 `V1` 仅支持顺序工具调用的声明保持一致，不能依赖上游默认值。

## Documentation Pattern

- 面向 npm 发布的 CLI 包必须把 `package.json` 收敛为“可消费产品”元数据：使用 scoped 名称、显式 `publishConfig.access = "public"`、`engines.node`、`license`、`homepage/repository`，并保证 `bin` 入口只指向构建产物。
- CLI 包发布必须使用 `files` 白名单控制 tarball 内容，只发布运行时产物与必要说明文件；`src/`、`tests/`、`docs/`、本地 config 样例默认不进入 npm 包。
- npm 发布前必须通过生命周期脚本自动校验：`prepublishOnly` 负责测试与静态检查，`prepack` 负责构建，避免手工发布遗漏。
- 面向 npm / GitHub 的 CLI 首页 README 必须是“产品入口页”而不是研发备忘：开头只保留一句简介、安装命令、完整配置示例与快速使用说明；不要暴露内部 docs 目录、项目结构、阶段标签（例如 `V1`）或大段实现细节。
- 根 `README.md` 必须反映当前真实可运行命令，而不是计划中的命令。
- 根 `README.md` 必须显式说明模式路由矩阵、配置优先级与 `V1` 限制。
- 根 `README.md` 必须明确解释 `o2c / c2o` 的方向含义，并给出客户端选择对照。
- 本地联调用 `co2.config.json` 时，示例配置优先贴近当前实现的默认模式和最小必填字段。
- 图片输入能力需要在 README 明确写清支持范围：只支持 URL/base64 输入，不支持图片输出；所有示例必须与集成测试里的真实 payload 形状保持一致。
- 上游默认请求头通过 `providers.*.defaultHeaders` 配置；允许覆盖 SDK 默认 header，但禁止覆盖鉴权头。
- `thinking / reasoning` 目前只做请求侧近似映射；返回侧不伪造标准 Claude thinking block。
- 错误日志必须输出安全上下文：请求方法、URL、body 顶层 keys、关键 header 摘要与校验 issue；禁止记录敏感 header 值。
- 上游调用前必须记录安全的请求摘要日志，例如 transport、工具数量、工具名、thinking/reasoning、system/instructions 与模型名。
- 调试上游兼容性时，除摘要外还应输出完整上游请求体日志，便于逐字段和客户端直连请求对比。
- 当请求包含 `tools` 且客户端未显式给出 `tool_choice` 时，默认补 `auto`，保持工具使用行为稳定。
