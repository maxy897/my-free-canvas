# Free Canvas

AI 图像生成画布应用，基于 Cloudflare 全栈架构。项目包含 Astro/React 前端、Cloudflare Worker API、D1/KV/R2 数据层，以及可独立部署的 Deno Relay 图像生成中继服务。

## 开源前安全提醒

本仓库只应提交示例配置（如 `.env.example`、`apps/worker/.dev.vars.example`、`apps/worker/wrangler.toml.example`）。真实的 `.env*`、`.dev.vars`、`wrangler.toml`、Cloudflare IDs、OAuth secrets、AI provider keys、日志和用户数据导出都应保留在本地并被 `.gitignore` 忽略。

如果这些敏感值曾经被提交到 git 历史，请在公开仓库前轮换密钥，并用 `git filter-repo` / BFG 等工具清理历史。

## 架构概览

应用由三部分组成：

| 服务 | 说明 | 部署目标 |
|------|------|----------|
| Web | 用户前端、画布编辑器 | Cloudflare Pages |
| Worker API | 认证、画布项目、任务、文件 API | Cloudflare Workers |
| Deno Relay | 图像生成 provider 调度、轮询与回调 | Deno Deploy / 任意 Deno 运行环境 |

域名与运行时配置通过 `wrangler.toml`、`PUBLIC_API_URL`、`FRONTEND_URL`、`DENO_RELAY_URL` 等环境变量设置，仓库内只保留示例配置。

### 技术栈

| 层 | 技术 |
|---|------|
| 前端 | Astro + React + Tailwind CSS |
| 画布 | React Flow + Zustand + LocalForage |
| 后端 | Hono + Cloudflare Workers |
| 认证 | Better Auth + OAuth |
| 数据库 | Cloudflare D1 (SQLite) |
| 缓存/状态 | Cloudflare KV |
| 文件存储 | Cloudflare R2 |
| 图像中继 | Deno + provider adapters |
| Monorepo | pnpm workspaces |

## 功能模块

- **可视化画布**：节点式编辑、拖拽连接、自动保存、撤销/重做。
- **项目同步**：本地 IndexedDB 缓存 + 服务端 D1 持久化。
- **异步任务**：提交任务到 Worker，Worker 转发到 Deno Relay，Relay 完成后回调 Worker。
- **实时更新**：SSE 优先，失败后自动降级轮询。
- **文件存储**：上传文件到 R2，支持 MIME 校验、hash 去重和缓存读取。
- **认证**：Google / GitHub / Microsoft / Discord / LinuxDo 等 OAuth provider 可按需启用。
- **图像生成 provider**：ChatGPT2API、OpenAI-compatible、FAL.ai、Replicate、Kling、HF video 等实现位于 `deno-relay/providers/`。

## Quick Start

```bash
# 安装依赖
pnpm install

# 准备本地配置
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
cp apps/worker/wrangler.toml.example apps/worker/wrangler.toml

# 迁移本地数据库
pnpm --filter worker db:migrate:local

# 启动开发服务
pnpm --filter worker dev   # Worker API: http://localhost:8787
pnpm --filter web dev      # Web:        http://localhost:4321
```

也可以一键启动前后端：

```bash
pnpm dev
```

## 配置

### Worker 本地变量

本地 Worker 使用 `apps/worker/.dev.vars`。从示例复制后至少设置：

```bash
BETTER_AUTH_SECRET=your-random-32-byte-hex-string
```

如需启用 OAuth，按 provider 填入对应的 Client ID / Secret：

```bash
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
LINUXDO_CLIENT_ID=
LINUXDO_CLIENT_SECRET=
```

### Google OAuth

1. 前往 Google Cloud Console 创建 OAuth 2.0 Client ID（Web application）。
2. 配置 JavaScript 来源：
   - `http://localhost:4321`
   - `https://<your-web-domain>`
3. 配置重定向 URI：
   - `http://localhost:8787/api/auth/callback/google`
   - `https://<your-api-domain>/api/auth/callback/google`
4. 将 Client ID 和 Secret 填入 `apps/worker/.dev.vars`。

常见问题：

- `redirect_uri_mismatch`：检查 Google Console 中的重定向 URI 是否与实际请求完全一致。
- 登录后跳转到线上环境：本地 Worker 需要使用 `wrangler dev --env dev`。
- 登录后跳转到 `localhost:8787` 而非 `localhost:4321`：前端 `callbackURL` 必须是包含 `window.location.origin` 的绝对 URL。

### LinuxDo Connect OAuth

1. 在 LinuxDo Connect 后台创建 OAuth 应用。
2. 配置回调地址：
   - `http://localhost:8787/api/auth/oauth2/callback/linuxdo`
   - `https://<your-api-domain>/api/auth/oauth2/callback/linuxdo`
3. 将 Client ID 和 Secret 填入 `apps/worker/.dev.vars`。

默认端点为：

```bash
LINUXDO_AUTHORIZE_URL=https://connect.linux.do/oauth2/authorize
LINUXDO_TOKEN_URL=https://connect.linux.do/oauth2/token
LINUXDO_USERINFO_URL=https://connect.linux.do/api/user
LINUXDO_SCOPES=user
LINUXDO_TOKEN_AUTH_METHOD=client_secret_post
LINUXDO_USE_PKCE=true
```

## Deno Relay 图像中继

Relay 负责接收 Worker 派发的任务、调用图像 provider、轮询异步结果、必要时重托管资源，并将最终结果回调 Worker。

### 本地启动

```bash
cd deno-relay
PORT=8001 DENO_SECRET=dev-webhook-secret deno run --allow-net --allow-env main.ts
```

Worker 侧对应配置：

```bash
DENO_RELAY_URL=http://localhost:8001
CANVAS_WEBHOOK_BASE_URL=http://localhost:8787
DENO_SECRET=dev-webhook-secret
```

### Provider 配置示例

```bash
# ChatGPT2API / async image API
CHATGPT2API_BASE_URL=https://<your-chatgpt2api-host>
CHATGPT2API_KEY=

# OpenAI-compatible / provider outputs re-hosting
ASSET_SERVICE_URL=https://<your-asset-service-host>
ASSET_SERVICE_API_KEY=

# Optional fallback providers
FAL_API_KEY=
REPLICATE_API_TOKEN=
KLING_API_KEY=
HF_SPACES_URL=
```

未配置真实 provider 时，部分流程会进入 mock/fallback 模式，便于本地调试。

### 任务链路

```text
Frontend POST /api/canvas/tasks
  → Worker 校验请求并创建任务记录
  → Worker POST /tasks 到 Deno Relay
  → Relay 调用 provider / 轮询异步结果
  → Relay 获取输出 URL 或重新上传生成文件
  → Relay POST /api/canvas/webhooks/task-complete 回调 Worker
  → Worker 更新任务状态
  → Frontend 通过 SSE 或 polling 展示结果
```

## 部署到 Cloudflare

```bash
# 1. 准备 Worker 配置
cp apps/worker/wrangler.toml.example apps/worker/wrangler.toml
# 编辑 wrangler.toml，把 <your-...> 占位替换为实际值

# 2. 创建 Cloudflare 资源
wrangler d1 create <your-d1-database-name>
wrangler kv namespace create <your-kv-binding-name>
wrangler r2 bucket create <your-r2-bucket-name>

# 3. 将 D1 database_id / KV id / R2 bucket name 写回 apps/worker/wrangler.toml

# 4. 设置 Worker secrets
wrangler secret put BETTER_AUTH_SECRET
# 按需设置 OAuth / AI provider / Relay secrets
# wrangler secret put GOOGLE_CLIENT_ID
# wrangler secret put GOOGLE_CLIENT_SECRET
# wrangler secret put DENO_SECRET
# wrangler secret put CHATGPT2API_KEY
# wrangler secret put FAL_API_KEY

# 5. 迁移远程数据库
pnpm --filter worker db:migrate:remote

# 6. 部署 Worker
pnpm --filter worker deploy

# 7. 构建并部署前端
PUBLIC_API_URL=https://<your-api-domain> pnpm --filter web build
wrangler pages deploy apps/web/dist --project-name=<your-web-pages-project> --branch=main
```

仓库也提供一键部署脚本：

```bash
# 本地创建未提交的 .env.deploy，写入 PUBLIC_API_URL / WEB_PROJECT
pnpm run deploy
```

## 项目结构

```text
free-canvas/
├── apps/
│   ├── worker/                  # Cloudflare Worker API
│   │   ├── src/
│   │   │   ├── index.ts          # 入口：CORS + 路由挂载
│   │   │   ├── types.ts          # Env bindings 定义
│   │   │   ├── middleware/       # auth, request guards, error-tracking
│   │   │   ├── lib/              # auth, storage, task orchestration, monitoring
│   │   │   └── routes/           # auth, canvas, files, tasks, webhooks 等
│   │   ├── migrations/           # D1 SQL migrations
│   │   ├── wrangler.toml.example # Worker 配置模板
│   │   └── .dev.vars.example     # 本地变量模板
│   └── web/                      # Astro + React 前端
│       ├── public/brand/         # 品牌资产
│       └── src/
│           ├── layouts/
│           ├── pages/
│           ├── components/
│           └── lib/
├── packages/
│   └── shared/                   # 共享类型、DAG 执行器等
├── deno-relay/                   # Deno 图像生成中继服务
├── scripts/                      # 开发/部署/清理脚本
└── README.md
```

## Canvas 架构要点

- **React Flow + Zustand + LocalForage**：节点可视化、状态管理、本地持久化。
- **DAG 拓扑排序**：Kahn 算法检测环路，并按层级生成并发执行计划。
- **Callback 注入模式**：节点组件保持纯 UI，业务回调由 `CanvasApp` 注入到 `node.data`。
- **Auto-save**：监听 store 变更，防抖后同步到 D1。
- **SSE + Polling 双模**：实时更新优先使用 SSE，异常时降级轮询。

### 节点类型

| Type | Category | Purpose |
|------|----------|---------|
| `prompt` | Input | 文本提示输入 |
| `model-config` | Input | 模型参数配置 |
| `number-input` | Input | 数值输入 |
| `image-input` | Input | 图片 URL 输入 |
| `txt2img` | Generate | 文生图 |
| `img2img` | Generate | 图生图 |
| `img2video` | Generate | 图生视频 |
| `text-modifier` | Process | 文本变换 |
| `preview` | Output | 显示生成结果 |

端口类型：`text`、`image`、`video`、`number`、`model-config`，连接时会做类型匹配。

## API 端点概览

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | No | 健康检查 |
| GET | `/api/auth/providers` | No | 可用 OAuth providers |
| GET | `/api/canvas/projects` | Yes | 列出用户项目 |
| POST | `/api/canvas/projects` | Yes | 创建项目 |
| GET | `/api/canvas/projects/:id` | Yes | 获取项目 |
| PUT | `/api/canvas/projects/:id` | Yes | 更新项目 |
| DELETE | `/api/canvas/projects/:id` | Yes | 删除项目 |
| POST | `/api/canvas/tasks` | Yes | 提交生成任务 |
| GET | `/api/canvas/tasks/:id` | Yes | 获取任务状态 |
| GET | `/api/canvas/tasks/:id/stream` | Yes | SSE 任务流 |
| POST | `/api/canvas/tasks/:id/cancel` | Yes | 取消任务 |
| POST | `/api/canvas/files/upload` | Yes | 上传文件 |
| GET | `/api/canvas/files/:key` | Yes | 获取文件 |
| POST | `/api/canvas/webhooks/task-complete` | Secret | Relay 任务完成回调 |

## Testing

```bash
# 全量检查
pnpm typecheck
pnpm test
pnpm build

# Worker tests
pnpm --filter worker test

# Web tests
pnpm --filter web test
```

### 测试结构

| 类型 | 文件 | 说明 |
|------|------|------|
| E2E | `canvas-e2e.test.ts` | 真实 D1 + cookie 认证链路 |
| 单元 | `canvas.test.ts` | 项目 CRUD 路由 |
| 单元 | `canvas-tasks.test.ts` | 任务提交/轮询/取消 |
| 单元 | `canvas-tasks-sse.test.ts` | Server-Sent Events 实时推送 |
| 单元 | `dag-solver.test.ts` | DAG 拓扑排序、环检测、子图提取 |
| 单元 | `dag-executor.test.ts` | 分层并发执行计划 |
| 单元 | `file-storage.test.ts` | R2 文件存储 |
| 单元 | `auth-enhanced.test.ts` | 认证中间件增强逻辑 |
| 单元 | `error-handling.test.ts` | 错误处理与标准化响应 |
| 单元 | `monitoring.test.ts` | 监控指标与请求追踪 |
| 性能 | `performance.test.ts`, `api-performance.test.ts` | 性能基准 |

### E2E 测试认证机制

E2E 测试通过真实 cookie 签名走完整认证路径，不使用 header bypass：

```text
1. wrangler d1 migrations apply --local 建表
2. wrangler d1 execute --local seed user/session
3. HMAC-SHA256 签名 session token，构造 better-auth cookie
4. unstable_dev 启动 Worker
5. 请求携带签名 cookie，经过 better-auth 与 authMiddleware
```

单元测试在 `ENVIRONMENT="test"` 下可使用 `x-test-user-id` header bypass，便于快速覆盖路由逻辑。

## License

MIT

## Acknowledgments

- [LinuxDo](https://linux.do) — 学 AI，上 L 站