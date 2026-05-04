# 16. Infrastructure & Deployment

## Monorepo management

- **Bun workspaces**: Package management and linking (defined in root `package.json`)
- **Turborepo 2.8.13**: Build orchestration and caching (defined in `turbo.json`)
- **Workspace structure**: `packages/*`, `packages/console/*`, `packages/sdk/js`, `packages/slack`

## Infrastructure as Code (SST)

`infra/` directory and `sst.config.ts` define deployment infrastructure:

```
infra/
├── app.ts           # Main app (Cloudflare Workers)
├── console.ts       # Admin console
├── enterprise.ts    # Enterprise app
├── secret.ts        # Secrets management
└── stage.ts         # Deployment stages
```

Targets:
- **Cloudflare Workers**: Edge deployment for web app and API
- **PlanetScale**: MySQL-compatible database (via Drizzle)
- **Stripe**: Payment processing

## Docker containers

`packages/containers/`:

| Container | Purpose |
|-----------|---------|
| `base` | Base image with Bun runtime |
| `bun-node` | Bun + Node.js for tool compatibility |
| `tauri-linux` | Linux dependencies for Tauri desktop builds |
| `rust` | Rust toolchain for Tauri native code |

## Desktop apps

### Tauri v2 (`packages/desktop/`)
- Rust backend with Bun frontend
- Native window via Tauri (WebView-based)
- Plugins: clipboard, deep-link, dialog, notification, updater
- Platform-specific features via Tauri API

### Electron (`packages/desktop-electron/`)
- Alternative desktop wrapper
- Electron + electron-builder
- Full Node.js integration

## Web deployment

### Web app (`packages/app/`)
- SolidJS SPA built with Vite
- Connects to the API server
- E2E tests with Playwright

### Docs site (`packages/web/`)
- Astro + Starlight
- Deployed to Cloudflare Pages

### Landing page (`landing/`)
- Astro static site
- Marketing/conversion focused

### Enterprise (`packages/enterprise/`)
- SolidStart-based full-stack app
- Team management, authentication, Stripe billing
- Cloudflare Workers deployment

### Console (`packages/console/`)
- SolidStart admin console
- Stripe payments, OpenAuth authentication
- Transactional email via JSX-email

## Slack integration

`packages/slack/`:
- Slack bot using `@slack/bolt`
- Connects to Conclave via `@opencode-ai/sdk`
- Handles slash commands and interactive messages

## Development tools

| Tool | Purpose |
|------|---------|
| **Husky** | Git hooks (pre-commit) |
| **Oxlint** | Linting (fast Rust-based linter) |
| **Prettier** | Code formatting |
| **Playwright** | E2E testing |
| **Nix** | Reproducible dev environment (`flake.nix`) |
| **GitHub Actions** | CI/CD pipelines |
