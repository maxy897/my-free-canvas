#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# 一键部署脚本
#   - 自动检测并执行远程数据库迁移（仅在有未应用迁移时执行）
#   - 部署 Worker API
#   - 构建并部署 Web 前端
#
# 用法:
#   pnpm run deploy                # 全量部署
#   bash scripts/deploy.sh         # 同上
#   bash scripts/deploy.sh --skip-migrate    # 跳过数据库迁移检测
#   bash scripts/deploy.sh --worker          # 仅部署 Worker
#   bash scripts/deploy.sh --web             # 仅部署 Web
#   bash scripts/deploy.sh --worker --web    # 组合部署
#
# 必填环境变量:
#   PUBLIC_API_URL    前端构建时注入的 API 地址（如 https://api.example.com）
#   WEB_PROJECT       Cloudflare Pages 用户前端 project 名
#
# 建议把上述变量写进本地未提交的 `.env.deploy` 或 shell rc，
# 例如：
#   export PUBLIC_API_URL=https://api.example.com
#   export WEB_PROJECT=my-canvas
# ──────────────────────────────────────────────────────────────────────────

# 切换到仓库根目录（脚本位于 scripts/ 下）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# 自动加载本地未提交的 deploy 环境变量（可选）
if [ -f "$REPO_ROOT/.env.deploy" ]; then
  # shellcheck disable=SC1091
  set -a; . "$REPO_ROOT/.env.deploy"; set +a
fi

# ── 配置（必填，从环境变量读取，缺失则报错）────────────────────────────────
require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "✗ 必需环境变量未设置: $name" >&2
    echo "  请在 .env.deploy 或 shell 中导出后重试，例如：export $name=..." >&2
    exit 1
  fi
}

PAGES_BRANCH="${PAGES_BRANCH:-main}"

# ── 颜色输出 ──────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"; GREEN="$(printf '\033[32m')"
  BLUE="$(printf '\033[34m')"; YELLOW="$(printf '\033[33m')"
  RED="$(printf '\033[31m')"; RESET="$(printf '\033[0m')"
else
  BOLD=""; GREEN=""; BLUE=""; YELLOW=""; RED=""; RESET=""
fi

step()  { echo; echo "${BOLD}${BLUE}▶ $*${RESET}"; }
ok()    { echo "${GREEN}✓ $*${RESET}"; }
warn()  { echo "${YELLOW}! $*${RESET}"; }
fail()  { echo "${RED}✗ $*${RESET}" >&2; }

# ── 参数解析 ──────────────────────────────────────────────────────────────
SKIP_MIGRATE=false
DEPLOY_WORKER=false
DEPLOY_WEB=false
SELECTED=false

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-migrate) SKIP_MIGRATE=true ;;
    --worker)       DEPLOY_WORKER=true; SELECTED=true ;;
    --web)          DEPLOY_WEB=true;    SELECTED=true ;;
    -h|--help)
      cat <<'EOF'
一键部署脚本

用法:
  pnpm run deploy                       # 全量部署（自动检测迁移 + Worker + Web）
  bash scripts/deploy.sh                # 同上
  bash scripts/deploy.sh --skip-migrate # 跳过数据库迁移检测
  bash scripts/deploy.sh --worker       # 仅部署 Worker
  bash scripts/deploy.sh --web          # 仅部署 Web
  bash scripts/deploy.sh --worker --web # 组合部署

必需环境变量:
  PUBLIC_API_URL    前端构建注入的 API 地址，例如 https://api.example.com
  WEB_PROJECT       Cloudflare Pages 用户前端 project 名

可选环境变量:
  PAGES_BRANCH      Cloudflare Pages 部署分支（默认 main）
EOF
      exit 0 ;;
    *)
      fail "未知参数: $1"
      exit 1 ;;
  esac
  shift
done

# 未指定具体目标时，默认全量部署
if [ "$SELECTED" = false ]; then
  DEPLOY_WORKER=true
  DEPLOY_WEB=true
fi

# ── 必需变量校验（解析参数后再做，方便 --help 不需要 env 即可显示）────────
require_env PUBLIC_API_URL
require_env WEB_PROJECT

START_TS=$(date +%s)

# ── 1. 数据库迁移（自动检测）─────────────────────────────────────────────
if [ "$SKIP_MIGRATE" = true ]; then
  step "跳过数据库迁移检测 (--skip-migrate)"
else
  step "检测远程数据库待应用的迁移"
  # 用 binding 名 DB 让 wrangler 自己解析数据库（无需外部 env）
  LIST_OUTPUT="$(pnpm --filter worker exec wrangler d1 migrations list DB --remote 2>&1 || true)"
  echo "$LIST_OUTPUT"

  if echo "$LIST_OUTPUT" | grep -qiE "No migrations to apply"; then
    ok "没有待应用的迁移，跳过"
  else
    warn "检测到未应用的迁移，开始执行远程迁移"
    pnpm --filter worker db:migrate:remote
    ok "数据库迁移完成"
  fi
fi

# ── 2. 部署 Worker API ────────────────────────────────────────────────────
if [ "$DEPLOY_WORKER" = true ]; then
  step "部署 Worker API"
  pnpm --filter worker run deploy
  ok "Worker API 部署完成"
fi

# ── 3. 构建并部署 Web 前端 ────────────────────────────────────────────────
if [ "$DEPLOY_WEB" = true ]; then
  step "构建 Web 前端 (PUBLIC_API_URL=$PUBLIC_API_URL)"
  PUBLIC_API_URL="$PUBLIC_API_URL" pnpm --filter web build
  ok "Web 构建完成"

  step "部署 Web 前端到 Cloudflare Pages ($WEB_PROJECT)"
  npx wrangler pages deploy apps/web/dist \
    --project-name="$WEB_PROJECT" \
    --branch="$PAGES_BRANCH"
  ok "Web 前端部署完成"
fi

# ── 完成 ──────────────────────────────────────────────────────────────────
END_TS=$(date +%s)
echo
ok "全部完成，用时 $((END_TS - START_TS)) 秒"
