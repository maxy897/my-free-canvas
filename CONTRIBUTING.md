# Contributing

Thanks for your interest in Free Canvas.

## Development

```bash
pnpm install
pnpm --filter worker db:migrate:local
pnpm --filter worker dev
pnpm --filter web dev
```

Copy example configuration files before running services locally:

```bash
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
cp apps/worker/wrangler.toml.example apps/worker/wrangler.toml
```

## Quality checks

Run these before opening a pull request:

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Secrets

Never commit secrets or real deployment configuration. Use `.env.example`, `.dev.vars.example`, and `wrangler.toml.example` for placeholders only.
