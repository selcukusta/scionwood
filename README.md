<p align="center"><img src="./assets/sprig-worktree-logo.png" alt="sprig-worktree logo" width="400"></p>

# sprig-worktree

> A sprig of your repo for worktrees — instant isolated environments for PR review, with codegraph integration.

PR-review worktrees for [opencode](https://opencode.ai). One command creates an isolated worktree with its own codegraph index and symlinks to your ignored files; one command tears it down. The LLM never touches worktree management — no tokens, no non-determinism.

## Why

Reviewing a PR in opencode today means juggling the worktree, the codegraph reindex, the symlinks to `.env` / `CLAUDE.local.md`, and the cleanup. Every step is a place to forget. This toolkit turns the whole cycle into two commands.

Inspired by the worktree + bootstrap/teardown flow of Spotify's Xirp for Claude Code, reimplemented natively for opencode.

## Install

### Option A — copy the toolkit (recommended)

Copy `.opencode/` into your project repo and commit it:

```bash
git clone https://github.com/selcukusta/sprig-worktree /tmp/sprig
cp -R /tmp/sprig/.opencode .
rm -rf /tmp/sprig
git add .opencode && git commit -m "add sprig-worktree"
```

Then install once per machine, and optionally once per repository:

```bash
.opencode/scripts/wt install   # machine: the global `wt` command + ~/.config/wt/config.json
wt init                        # repository: .opencode/wt.json + hook scaffolds (only if it needs its own settings)
```

`wt install` never writes into a repository, and `wt init` never writes outside
one. Most repositories need no config at all — the built-in defaults plus your
global config are enough.

The global wrapper is deliberately **not** bound to the repository you installed it from. It `exec`s the script and lets `wt` find the repository from your current directory, the way `git` does — so one install serves every repo you own, and `wt new` can never create a worktree in the wrong one.

### Option B — npm

```bash
npm install --save-dev sprig-worktree
```

The package exposes `dist/plugin.js` (opencode plugin entry, default-exported) and `dist/scripts/wt` (the bash CLI). Configure your opencode `plugin` list to load it from `node_modules`. On the first opencode session inside your repo, the plugin auto-runs `wt install` to write `.opencode/wt.json` and the global `wt` shim — it finds the bundled bash at `node_modules/sprig-worktree/dist/scripts/wt` automatically, so you don't need to copy anything. After that, `wt` works from any directory via the package's `bin` entry.

> **Note on npm v11+**: this package intentionally has **no** `postinstall` script. Recent npm versions block unfamiliar postinstall scripts by default (via `npm approve-scripts`), which would leave the package unconfigured after install. Instead, the plugin auto-bootstraps on the first opencode session — no script approval needed.

### First-run behavior

The plugin detects first use inside your repo (including right after a fresh `npm install`) and runs `wt install` for you, creating `.opencode/wt.json` with the recommended defaults and writing the global `wt` shim. In a TTY session you'll see prompts — press Enter through them to accept each default. Subsequent opens load it directly. No manual bootstrap step is required unless you want to review or customize the defaults first.

## Quick start

```bash
wt new review-pr-1234
```

That single command:

1. `git fetch --prune` and `git pull --rebase` on main (configurable).
2. Fetches `pull/1234/head` from origin into a local `review/review-pr-1234` branch.
3. Creates the worktree `.git-worktrees/review-pr-1234` checked out on that branch.
4. Symlinks the ignored files from your main repo root (see `filesToLink` in [Config](#config)).
5. Runs `npm install` in the configured dirs (root + `apps/frontend` by default).
6. Runs `codegraph init && codegraph sync` with an isolated data dir.
7. Launches opencode **in the same terminal tab**, inside the worktree.

When you're done:

```bash
wt teardown review-pr-1234
```

Removes the codegraph data, symlinks, worktree, and branch — but only after checking that you are not about to lose anything. If the worktree has uncommitted changes, or the branch has commits that are not merged, teardown refuses and tells you what it found. Pass `--force` to discard them anyway.

## Commands

| Command | Description |
| --- | --- |
| `wt new <name> [--pr N \| --branch <ref> \| --from <ref>] [--no-open]` | Create `.git-worktrees/<name>`, bootstrap it, open opencode. With no source flag it branches from the repo's default branch. `wt new --pr N` auto-names the worktree `pr-N`. |
| `wt config [--layers]` | Print the effective config, and where each layer came from. |
| `wt trust` | Approve this repository's hooks and tool commands. |
| `wt init [--force]` | Write `<repo>/.opencode/wt.json`. |
| `wt list` | List open review worktrees and their branches. |
| `wt open <name>` | Open opencode in an existing worktree. |
| `wt bootstrap [name\|path]` | Re-run symlinks + codegraph indexing. Idempotent. |
| `wt clean [name\|path]` | Remove worktree artifacts only (symlinks + codegraph data), keep the worktree and branch. |
| `wt teardown [name\|path] [--force]` | Remove worktree, branch, and codegraph data. Refuses if the worktree is dirty or the branch has unmerged commits; `--force` discards them. Bare `wt teardown` tears down the worktree you're standing in. |
| `wt install [--config-home <dir>]` | Machine setup, once: the global `wt` command and `~/.config/wt/config.json`. Never writes into a repository. |
| `wt test` | Run the built-in smoke tests (throwaway repo, no side effects). |

Name-based commands work from any directory, and bare commands work from anywhere inside a worktree, including its subdirectories. Paths are also accepted (e.g. `wt teardown .git-worktrees/review-pr-1234`).

### Zero tokens

The plugin never invokes the model. It registers no tool, injects nothing into any
prompt, and ships no slash commands — its whole surface is three non-model hooks
(`config`, `shell.env`, `event`) that set environment variables and a permission rule.

Worktree management is a command you run. Other opencode worktree plugins hand the
agent a `worktree_create` tool and spend model tokens on every decision; this one
cannot, because it never had the tool. A test enforces it.

## Config

Six keys. Everything optional — with no config at all, `wt new spike-auth` works.

```json
{
  "basePath":     ".git-worktrees",
  "branchPrefix": "wt/",
  "prRef":        "pull/{n}/head",
  "filesToLink":  ["CLAUDE.local.md", ".claude/settings.local.json", ".env"],
  "hooks":        { "postCreate": ".opencode/hooks/post-create.sh",
                    "preTeardown": ".opencode/hooks/pre-teardown.sh" },
  "tools":        { "codegraph": { "detect": "codegraph",
                                   "dataDir": ".codegraph-{name}",
                                   "env": { "CODEGRAPH_PROJECT_PATH": "{worktree}",
                                            "CODEGRAPH_DATA_DIR": "{dataDir}" },
                                   "setup": "codegraph init -i && codegraph sync" } }
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `basePath` | `.git-worktrees` | Directory under the repo root where worktrees are created. |
| `branchPrefix` | `wt/` | Branch name = `${branchPrefix}${worktree-name}`. |
| `prRef` | `pull/{n}/head` | Ref that `--pr N` fetches. GitLab: `merge-requests/{n}/head`. |
| `filesToLink` | `[CLAUDE.local.md, .claude/settings.local.json, .env]` | Repo-relative paths symlinked from the main repo into each worktree. |
| `hooks.postCreate` | — | Script or command run in a new worktree. |
| `hooks.preTeardown` | — | Script or command run before a worktree is removed. |
| `tools` | codegraph | Per-worktree tooling. See [docs/extending.md](docs/extending.md). |

Placeholders usable in `tools` values: `{name}`, `{worktree}`, `{mainRoot}`,
`{branch}`, `{dataDir}`.

### Where config comes from

Four layers, lowest precedence first:

```
built-in defaults
  ← ~/.config/wt/config.json      your defaults, every repo, not in git
    ← <repo>/.opencode/wt.json    this project, committed, optional
      ← WT_* env vars             this invocation
```

`wt config` prints the effective result; `wt config --layers` also shows which
file each layer came from.

**Merge rules.** Maps merge by key, arrays union preserving order. A `!`-prefixed
name removes something you inherited — an array entry or a map key:

```json
// global: { "filesToLink": ["CLAUDE.local.md", ".env"] }
// repo:   { "filesToLink": [".env.test", "!.env"], "tools": { "!codegraph": true } }
// result: filesToLink is [CLAUDE.local.md, .env.test], codegraph is gone
```

So a repo can add a tool without redeclaring yours, and drop one it does not want.

### Commands in config need approval

`hooks.*` and `tools.*.setup|teardown` execute shell commands, and a repo config
arrives with a `git clone`. Run `wt trust` once per repository; editing a command
re-arms the gate. Non-interactive sessions never prompt and never execute — they
warn and carry on. See [docs/security.md](docs/security.md).

## Environment overrides

| Variable | Overrides |
| --- | --- |
| `WT_BASE` | `basePath` |
| `WT_BRANCH_PREFIX` | `branchPrefix` |
| `WT_PR_REF` | `prRef` |
| `WT_FILES_TO_LINK` | `filesToLink` (comma-separated) |

Plus runtime controls:

| Variable | Default | Meaning |
| --- | --- | --- |
| `WT_OPEN` | `auto` | How opencode is launched after `new`/`open`. `auto`: same tab from a real terminal, otherwise a new tab (iTerm2) / window (Ghostty). `exec`: always same tab. `tab`: force new tab. `none`: print the `cd` line only. |
| `WT_MAIN_ROOT` | autodetected | Act on this repository instead of the one containing your current directory. |
| `WT_CONFIG_HOME` | `~/.config` | Where the global config and trust record live. |
| `WT_BIN` | — | Install target directory for `wt install`. |

Precedence: **env > repo file > global file > built-in default**.


## How isolation works

- **Tools**: each `tools` entry's `env` is exported around its `setup`/`teardown`, injected into every shell command in the worktree, and injected into any local MCP server whose name or command matches the tool key. The shipped `codegraph` entry uses this to give each worktree its own index. Remove it with `"tools": { "!codegraph": true }`, or add your own — see [docs/extending.md](docs/extending.md).
- **Ignored files**: paths in `filesToLink` are symlinked from the main repo into each worktree. Real files in the worktree are never overwritten; only previously created symlinks are replaced or removed.
- **Permissions**: the plugin adds an `external_directory` allow rule for the main repo root, so reads through the symlinks work inside the worktree.
- **Teardown safety**: only symlinks are deleted (never real files); branches are removed only when git allows it.

## Requirements

- [opencode](https://opencode.ai) ≥ 1.18
- git
- `jq` — required for `wt install` config writes. Install with `brew install jq`.
- CodeGraph CLI (`codegraph` on PATH) — optional; a tool whose `detect` binary is missing is skipped with a warning
- macOS for the terminal-launch magic (iTerm2 / Ghostty / Terminal). On other OSes commands print the `cd` line instead.
- `bun` — only needed to run the plugin's unit tests, not for normal use.

## Testing

```bash
# Bash CLI integration tests (27 groups, no side effects)
wt test

# Plugin unit tests (42 tests, requires bun)
npm test
# or: bun test ./.opencode/plugins/sprig-worktree.test.ts
```

`wt test` builds a throwaway repo and exercises the full cycle — config write, install, worktree creation, symlinks, codegraph env contract, listing, clean, idempotent bootstrap, teardown. Run it after any change to the bash script.

## Troubleshooting

- **`wt: command not found`** — run `.opencode/scripts/wt install`, or invoke by its path.
- **`'jq' is required`** — install jq (`brew install jq`) and re-run `wt install`.
- **CodeGraph errors during bootstrap** — bootstrap continues without the index; fix your CodeGraph install and run `wt bootstrap <name>`.
- **No iTerm2/Ghostty tab opens** — from a normal terminal prompt, opencode deliberately runs in the same tab; a new tab (iTerm2) / window (Ghostty) is opened only when `wt` runs without a TTY and `WT_OPEN=auto`. Detection uses `TERM_PROGRAM` (`iTerm.app` / `ghostty`); anything else falls back to printing the `cd` command.
- **`git worktree add` fails with "already checked out"** — the branch is open in another worktree; pick a different branch or close that worktree first.

## For contributors

```bash
git clone https://github.com/selcukusta/sprig-worktree
cd sprig-worktree
npm install     # builds via `prepare`
npm run build   # rebuild after editing .opencode/plugins/*.ts
npm test        # bun + bash
npm pack --dry-run   # verify the published tarball
```

The package is `sprig-worktree`. The build emits `dist/plugin.js`, `dist/plugin.d.ts`, `dist/index.js` (default-export wrapper), and `dist/scripts/wt` (executable bash CLI).

## License

[MIT](LICENSE)