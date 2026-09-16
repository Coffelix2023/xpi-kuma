# xpi-kuma

**English** · [简体中文](./README.zh-CN.md)

**A Pi Coding Agent extension that &lt;does one thing well&gt;.** <!-- TODO: replace with one concrete sentence: what it does, for whom, and what it replaces or removes. -->

**一个 &lt;把一件事做好&gt; 的 Pi Coding Agent 扩展。** <!-- TODO: 同上,中文一句话说清本扩展做什么、给谁用、替代了什么。 -->

<!-- TODO: add a LICENSE file (MIT) — the badge below links to it -->
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)

```text
> /xpi-kuma
```

## Why

<!-- TODO: describe the concrete pain this extension removes. One short paragraph beats a feature list. -->

Every extension in this repository starts from the same four rules:

- **No build step.** Pi loads `./src/index.ts` directly. No `dist/`, no bundler, no committed artifacts.
- **Pi-native UI.** Rendering goes through `ctx.ui.*` and `@earendil-works/pi-tui`. It never hijacks the terminal or pulls in a competing terminal framework.
- **No heavy runtime dependencies.** Host-provided APIs plus strict types; `typebox` for tool schemas, and nothing else unless it earns its place.
- **Strict gates, no exceptions.** TypeScript strict, Biome, and Vitest must all pass before any commit.

It also stays inside its lane: an extension is a plugin loaded into the Pi main process, not a separate service. If a task needs a process boundary, say so in an ADR before adding one.

## Tech stack

- [Node.js](https://nodejs.org/) + [pnpm](https://pnpm.io/), versions pinned in [`mise.toml`](./mise.toml)
- [Pi Coding Agent](https://github.com/earendil-works/pi) — the host, its extension API, and `@earendil-works/pi-tui`
- TypeScript strict (`target: ES2024`, `module: NodeNext`)
- [Biome](https://biomejs.dev/) for lint and format
- [Vitest](https://vitest.dev/) as the test runner

## Install

Requires a working Pi installation. The package is loaded straight from source, so there is nothing to build first.

```bash
pi install git:github.com/<owner>/xpi-kuma@<ref>
```

| Where | Command |
| --- | --- |
| Global (user settings) | `pi install git:github.com/<owner>/xpi-kuma@<ref>` |
| This project only (`.pi/settings.json`) | `pi install -l git:github.com/<owner>/xpi-kuma@<ref>` |

`pi install` writes to `~/.pi/agent/settings.json`; `-l` writes to the project settings, which Pi installs automatically once the project is trusted. A pinned git ref is not moved by `pi update`.

```bash
pi list                              # installed packages
pi update --extensions               # update packages and reconcile pinned refs
pi remove git:github.com/<owner>/xpi-kuma
```

Package-level debugging uses npm or git remote sources on purpose: a local-path install only records a reference to your working copy and leaves a stale entry in settings the moment you forget to `pi remove` it.

## Usage

| Command | Description |
| --- | --- |
| `/xpi-kuma` | Open the monitoring dashboard (vendor status, usage stats, cost/token trend) |

### Configuration

The extension reads `<project>/.pi/xpi-kuma/config.yaml`. The file is created from the
shipped template on first session start; edit it to list the vendors you want to monitor.

```yaml
vendors:
  - name: "OpenAI"
    endpoint: "https://api.openai.com/v1"
    model: "gpt-4o-mini"
    api_key: "${OPENAI_API_KEY}"   # resolved from the environment, never stored
    price: { input: 0.15, output: 0.6 }   # per 1K tokens
    probe:
      enabled: true
      interval: "5m"              # 5m / 30s / 1h
      timeout: 30000              # milliseconds

retention:
  raw_records: 7                  # days of raw records to keep
```

- `api_key` supports `${ENV_VAR}` placeholders and is expanded only in memory.
  An unset variable is left as-is so you notice it instead of silently probing with no key.
- Probes send a fixed `"hi"` prompt with `max_tokens: 1`, so each one costs a few tokens.
  Set `probe.enabled: false` for vendors you do not want probed (rate-limited gateways).
- Usage data is stored in `~/.pi/agent/data/xpi-kuma/usage.db`; the dashboard reads the same file.

Data written by the extension:

| Table | Written on | Contents |
| --- | --- | --- |
| `usage_records` | every assistant message (`message_end`) | real token counts and cost, as reported by the provider |
| `probe_records` | each scheduled or manual probe | status, TTFT, total response time |

The footer shows the current session totals as `💰 ¥0.05 | 📊 1.2K`, refreshed on every turn.

<!-- TODO: document every tool and command with its honest boundary: what it reads, what it changes, and what it refuses to do. -->

## Development

```bash
mise install                         # pinned Node.js and pnpm
pnpm install
```

| Gate | Command |
| --- | --- |
| Types | `pnpm typecheck` — `tsc --noEmit` |
| Lint and format | `pnpm -w run lint` — Biome across the repository |
| Tests | `pnpm test` — Vitest (`vitest run --passWithNoTests`) |

All three must pass before committing. Run `pnpm -w run lint` explicitly at the workspace root; the wrapper occasionally misreads a bare `pnpm run lint` as an unknown recursive command.

Two ways to run the extension while working on it:

```bash
pi -e ./src/index.ts                 # smoke test: load once, current run only
```

```bash
ln -s "$(pwd)" ~/.pi/agent/extensions/xpi-kuma   # live loop: /reload inside Pi
```

`pi -e` writes nothing to settings; the symlink is picked up from the extensions directory and is removed with `rm`.

## Directory structure

```text
.
├── mise.toml / package.json / biome.jsonc / tsconfig.json / pnpm-workspace.yaml
├── AGENTS.md / CONTEXT.md / DESIGN.md
├── docs/                      # Git workflow and repository guardrails
└── src/
    └── index.ts               # Extension entrypoint (register function)
```

## Design baseline

This project adopts the [Google Labs DESIGN.md format](https://github.com/google-labs-code/design.md) tailored for terminal TUI interfaces. See [`DESIGN.md`](./DESIGN.md) for the design tokens (colors, monospace typography, spacing, and component definitions).

## Conventions & constraints

- **Glossary** — [`CONTEXT.md`](./CONTEXT.md) defines the repository's unified terminology; terms must not drift in code, docs, or commits.
- **Git discipline** — read [`docs/GIT-WORKFLOW.md`](./docs/GIT-WORKFLOW.md) and [`docs/GITHUB-GUARD.md`](./docs/GITHUB-GUARD.md) before committing or pushing. Do not push to `main` by default; use small, granular Conventional Commits.
- **Token safety** — credentials and secret tokens are never written into code, logs, examples, or documentation.
- **Agent contract** — [`AGENTS.md`](./AGENTS.md) is the single source of truth for this repository. When an oral agreement, older code, or this README disagrees with it, `AGENTS.md` wins.

## Credits

- [Pi Coding Agent](https://github.com/earendil-works/pi) by [earendil-works](https://github.com/earendil-works) — the host this extension plugs into. The extension API, the `ctx.ui` contract, and the package manifest format are theirs.
<!-- TODO: credit every third-party repository you adopt or port from: project name, author, link, license, and what you took. -->

## License

MIT
