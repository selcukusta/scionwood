# Extending wt

Three extension points, all config. Nothing here needs TypeScript.

- **`tools`** — anything that wants its own state per worktree
- **`hooks`** — anything that should run at a lifecycle moment
- **`prRef`** — which forge you are on

## 1. Add a tool

A tool is any program that should be isolated per worktree. Six lines, no code:

```json
{
  "tools": {
    "ctags": {
      "detect": "ctags",
      "dataDir": ".tags-{name}",
      "env": { "CTAGS_FILE": "{dataDir}/tags" },
      "setup": "ctags -R -f \"$CTAGS_FILE\" ."
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `detect` | binary that must exist on `PATH`; absent means skip this tool with a warning and carry on |
| `dataDir` | per-worktree directory, created before `setup`, deleted by `clean` and `teardown` |
| `env` | variables exported around `setup`/`teardown` — and the payload, see below |
| `setup` | runs after a worktree is created |
| `teardown` | runs before a worktree is removed |

Every field is optional. Placeholders: `{name}`, `{worktree}`, `{mainRoot}`,
`{branch}`, `{dataDir}`.

### How `env` reaches your agent

This is the part that makes a tool actually isolated rather than merely
configured. The same `env` map is applied in three places:

1. **The CLI** exports it around `setup` and `teardown`.
2. **The plugin** injects it into `shell.env`, so every shell command the agent
   runs inside the worktree sees it.
3. **The plugin** injects it into any MCP server whose name or command contains
   the tool key — so an MCP-based indexer is scoped to the worktree without a
   line of code.

That third one is why the key matters: a tool called `ctags` will match an MCP
server named `ctags`, `ctags-mcp`, or one whose command mentions `ctags`.

`dataDir` is resolved relative to the worktree and is only ever deleted from
inside it. An absolute or `../`-bearing `dataDir` is refused with a warning
rather than followed.

### A second example: isolate docker

Two worktrees running `docker compose` collide on container names and volumes.
Six lines fixes it:

```json
{
  "tools": {
    "docker": {
      "detect": "docker",
      "env": { "COMPOSE_PROJECT_NAME": "wt-{name}" },
      "teardown": "docker compose down -v"
    }
  }
}
```

No `setup`, no `dataDir` — this tool is purely an environment variable and a
cleanup command. That is a complete, valid tool.

### Removing an inherited tool

Config layers merge, so the built-in `codegraph` entry reaches every repository.
To drop it, prefix the key with `!`:

```json
{ "tools": { "!codegraph": true } }
```

The same `!` prefix removes an entry from `filesToLink`. One rule, two shapes.

## 2. Edit a hook

`wt init` scaffolds `.opencode/hooks/post-create.sh` and `pre-teardown.sh`. Edit
them; there is nothing else to configure.

```bash
#!/usr/bin/env bash
# cwd: the worktree
# env: WT_NAME  WT_ROOT  WT_MAIN_ROOT  WT_BRANCH
set -euo pipefail

if   [ -f pnpm-lock.yaml ];    then pnpm install
elif [ -f bun.lockb ];         then bun install
elif [ -f yarn.lock ];         then yarn install
elif [ -f package-lock.json ]; then npm install
fi
```

A hook value can also be an inline command:

```json
{ "hooks": { "postCreate": "make setup" } }
```

The rule for telling the two apart: a value containing whitespace is a command; a
bare word that looks like a path (`.sh` suffix, or containing `/`) is a file, and
a warning is printed if it is missing rather than handing your typo to the shell.

A hook that fails warns; it never blocks the worktree.

Note what this means: a repository's config can run commands on your machine when
you create a worktree in it. `wt` prints every command as it runs, but it does not
ask first — the same way `npm install` does not ask before running postinstall
scripts. Read a config before working in a repository you do not know.

## 3. Support a different forge

`prRef` is the ref template `--pr` expands, with `{n}` for the number:

| Forge | `prRef` |
| --- | --- |
| GitHub (default) | `pull/{n}/head` |
| GitLab | `merge-requests/{n}/head` |
| Gitea / Forgejo | `pull/{n}/head` |
| Bitbucket Server | `pull-requests/{n}/from` |

```json
{ "prRef": "merge-requests/{n}/head" }
```

Then `wt new review --pr 42` fetches merge request 42.

## When you actually need TypeScript

The plugin exists to inject environment and permissions into an opencode session.
Its whole surface is three hooks — `config`, `shell.env`, `event` — and adding a
tool never requires touching it.

One constraint is permanent: **the plugin must never register an LLM `tool` hook,
inject anything into a prompt, or ship slash commands.** Worktree management is a
command you run, which is why the plugin costs zero tokens. A test enforces this;
if you are about to add a fourth hook, that is the thing to think about first.
