# n8n-nodes-cursor-agent

面向 **n8n** 的社区节点包：**Cursor Agent**。通过 [`@cursor/sdk`](https://cursor.com/docs/sdk/typescript) 在本机 **local runtime** 运行 Cursor Agent，支持配置 MCP 服务器、Skills 工作目录与 Redis 多轮会话。

- **npm：** [`n8n-nodes-cursor-agent`](https://www.npmjs.com/package/n8n-nodes-cursor-agent)
- **源码：** <https://github.com/liuhauyao/n8n-nodes-cursor-agent>

---

## 前置条件

| 项 | 说明 |
|----|------|
| Node.js | `>= 22.16`（与 n8n 运行环境一致） |
| Cursor API Key | 在 n8n 中配置 **Cursor API** 凭证，或设置环境变量 `CURSOR_API_KEY` |
| Redis | 节点要求配置 n8n 内置 **Redis** 凭证（用于 `sessionId` → `agentId` 映射） |
| 本机 Cursor CLI | local runtime 需在 n8n 进程所在机器上可运行 Cursor Agent |

**当前限制：** 仅支持 **local runtime**，不支持 cloud agent。

---

## 安装

### n8n 社区节点 UI

Settings → Community Nodes → Install → 输入 `n8n-nodes-cursor-agent`

### Docker / 自托管

在 `N8N_COMMUNITY_PACKAGES` 或 `~/.n8n/nodes/package.json` 中加入本包后重启 n8n。

### 宿主依赖（必配，符合 n8n 社区节点规范）

本包 **不含** runtime `dependencies`（n8n 社区节点规范要求）。`@cursor/sdk` 及其 Linux 平台二进制需在 **`~/.n8n/nodes`** 目录单独安装，与社区节点包同级解析：

```json
{
  "dependencies": {
    "n8n-nodes-cursor-agent": "2.2.0",
    "@cursor/sdk": "1.0.13"
  },
  "optionalDependencies": {
    "@cursor/sdk-linux-x64": "1.0.13",
    "@cursor/sdk-linux-arm64": "1.0.13"
  }
}
```

在 `~/.n8n/nodes` 执行 `npm install` 后重启 n8n。版本号须与 `@cursor/sdk` 一致。

节点内 Redis 访问使用 Node.js 内置 `node:net`（RESP 协议），**不**再依赖 `redis` npm 包。在 n8n 中配置 **Redis** 凭证（host/port/密码等）即可。

---

## 节点参数

| 参数 | 说明 |
|------|------|
| **System Message** | 首轮与 User Message 拼接；resume 已有会话时忽略 |
| **User Message** | 必填，当前轮用户输入 |
| **Session ID** | 可选；非空时通过 Redis 恢复同一 Cursor agent |
| **Skills Root Directory** | 可选；含 `.cursor/skills/` 的目录，作为 `local.cwd` 数组第一项 |
| **Working Directories** | 一个或多个绝对路径，映射为 `local.cwd: string[]` |
| **Working Directory (legacy)** | 兼容 2.0.0 单目录；与上述字段合并去重 |
| **Setting Sources** | 从本地加载 Cursor 设置层，默认 `project`（加载 cwd 下 `.cursor/`） |
| **Model** | 动态从 `Cursor.models.list()` 加载，失败时回退静态列表 |
| **Additional Options → MCP Servers** | 表单配置 HTTP / SSE / stdio MCP |
| **Additional Options → MCP Servers JSON** | JSON 对象，**非空时覆盖表单** |
| **Additional Options → Session TTL** | Redis 键 TTL（秒），默认 604800 |
| **Options → Agent Behavior → Permission Preset** | 见下方 preset 矩阵（与 Claude Agent 选项名一致） |

### Permission Preset（与 Claude Agent 对齐）

| Preset | 内置工具 | MCP | Skills | 实现方式 |
|--------|----------|-----|--------|----------|
| **`mcp_skills_only`** | 由 Skills Root 下 `.cursor/cli.json` 配置 | 是 | 是 | 推荐：MCP + project skills |
| **`plan_only`** | 由 `.cursor/cli.json` 配置 | **否**（节点强制清空 MCP） | 是 | 推荐：无工具、仅对话 |
| `customer_service` / `read_only` | 无硬限制 | 是 | 是 | 遗留选项，同 `full_agent` |
| `full_agent` | 全部 | 是 | 是 | 默认 |

**Cursor 与 Claude 的差异：** Claude 通过 `disallowedTools` + `dontAsk` **拒绝执行**但保留 tool 流式事件；Cursor 依赖 `.cursor/cli.json` 拒绝执行，SDK 仍会发出 `tool-call-started` 事件供 UI 展示。

**工作区约定：** `mcp_skills_only` / `plan_only` 会强制 `settingSources: ['project']`；Skills Root 宜指向含 `.cursor/skills/` 与 `.cursor/cli.json` 的目录，具体 allow/deny 由你在该目录维护。

### MCP Tool Filter（Options → MCP）

每次执行前将过滤规则合并进 **Skills Root** 下的 `.cursor/cli.json`（`Mcp(server:tool)` deny/allow）。

| Filter Mode | 行为 |
|-------------|------|
| **No Filter**（默认） | 不修改 MCP 权限段 |
| **Deny List** | 对列出的工具名写入 deny，并自动 `allow: Mcp(server:*)`（与 Claude ≥1.3.9 的 `mcp__server__*` 预批准对齐） |
| **Allow List** | allow 列出项；可选 **Tool Catalog** 用于 deny 其余工具 |

### Skills

将 skill 放在工作目录下的 `.cursor/skills/<skill-name>/SKILL.md`，并把 **Setting Sources** 包含 `project`（默认已选）。

**Skills Root Directory** 应指向含 `.cursor/skills/` 的仓库根；它会作为 `local.cwd` 的第一项，确保 skill 从指定根加载。

### 多工作目录示例

跨前后端仓库检索时：

| 参数 | 值 |
|------|-----|
| Skills Root Directory | `/data/workspace/frontend` |
| Working Directories | `/data/workspace/frontend`、`/data/workspace/backend` |

SDK 收到 `local.cwd: [frontend, frontend, backend]` 去重后为 `[frontend, backend]`。

---

## MCP 配置示例

### 表单（HTTP）

- Name: `my-api`
- Transport: HTTP
- URL: `https://example.com/mcp`
- Headers: `Authorization` = `Bearer <token>`

### JSON 覆盖

```json
{
  "my-api": {
    "type": "http",
    "url": "https://example.com/mcp",
    "headers": { "Authorization": "Bearer xxx" }
  },
  "local-tool": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "some-mcp-server"]
  }
}
```

Inline MCP 在 **create、resume、send** 时均需传入；本节点已自动处理。

---

## 输出字段

| 字段 | 说明 |
|------|------|
| `output` | 带 `<cursor_meta>` 的完整输出（含 timeline / suggestions） |
| `textOutput` | 纯 Markdown 正文 |
| `model` | 使用的模型 id |
| `agentId` | Cursor agent id |
| `runId` | 本次 run id |
| `sessionId` | 回传输入的 session id |

### 流式事件（`__cursor__`）

启用 n8n 流式响应时，节点通过 `sendChunk` 输出 JSON 行，marker 为 `__cursor__`：

| kind | 含义 |
|------|------|
| `thinking_start` / `thinking_chunk` / `thinking_end` | 思考过程 |
| `text` | 正文增量 |
| `text_reset` | 清空流式正文（工具/思考前丢弃过程过渡段） |
| `text_replace` | 运行结束用规范化后的最终正文覆盖流式累积 |
| `tool_start` / `tool_end` | 工具调用 |
| `status` | 任务状态 |

### 输出字段

| 字段 | 说明 |
|------|------|
| `output` | 带 timeline 元数据的完整输出 |
| `textOutput` | 纯 Markdown 正文 |
| `model` | 使用的模型 id |
| `agentId` | Cursor agent id |
| `runId` | 本次 run id |
| `sessionId` | 回传输入的 session id |

> headless 模式下 Cursor SDK 不提供 AskQuestion / Todo 交互；节点会过滤相关回退文案，且不在工具链 UI 展示这些内部工具。

---

## 本地 POC

```bash
export CURSOR_API_KEY=...
export POC_CWD=/path/to/your/project
export POC_MCP_SERVERS_JSON='{"demo":{"type":"http","url":"https://example.com/mcp"}}'
npm run poc
```

---

## 开发

```bash
npm install
npm run verify   # build + eslint + package.json lint
npm run dev      # tsc --watch
```

---

## 相关文档

- [Cursor SDK (TypeScript)](https://cursor.com/docs/sdk/typescript)
- [Cursor MCP](https://cursor.com/docs/mcp)
- [n8n Community Nodes](https://docs.n8n.io/integrations/community-nodes/)
