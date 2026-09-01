# What runs, and when

`wt` executes shell commands that come from a config file. That file is normally
committed to the repository, which means it arrives with a `git clone`. This page
says exactly what can execute and what stops it.

## The two fields that execute

| Field | Runs |
| --- | --- |
| `hooks.postCreate` | inside a new worktree, after symlinks, before tools |
| `hooks.preTeardown` | inside the worktree, just before it is removed |
| `tools.<name>.setup` | inside a new worktree, after hooks |
| `tools.<name>.teardown` | inside the worktree, before removal |

Nothing else executes. `basePath`, `branchPrefix`, `prRef`, `filesToLink`,
`tools.<name>.env`, `tools.<name>.dataDir` and `tools.<name>.detect` are data.
`detect` is a binary *name* that is looked up on `PATH`, never run.

## The gate

Provenance decides:

- **`~/.config/wt/config.json` is yours.** You wrote it, it is not in any
  repository, and its commands run unconditionally.
- **`<repo>/.opencode/wt.json` came from a clone.** Its commands need one
  approval per repository.

```
$ wt new spike-auth
This repository's config wants to run commands:
  hook  postCreate: .opencode/hooks/post-create.sh
  tool  codegraph setup: codegraph init -i && codegraph sync
  run them for this repository? [y/N]:
```

Approval is recorded in `~/.config/wt/trust.json` — **outside** the repository, so
a repo cannot approve itself. The record is a SHA-256 digest of only the
command-bearing fields, so editing any command re-arms the gate and you are asked
again. Changing `basePath` does not.

`wt trust` records approval without waiting to be asked.

## Non-interactive sessions fail closed

With no TTY — CI, a script, a cron job, an opencode session — `wt` never prompts.
It warns, skips the commands, and carries on:

```
wt: warning: skipping commands from /repo/.opencode/wt.json (repository not trusted)
wt: warning: review them, then run 'wt trust' in that repository
```

The worktree is still created and still usable. Skipping a dependency install is
recoverable; running an unreviewed command is not.

## Inspecting before approving

`wt config` prints the effective config, including every command that would run,
without running anything:

```bash
wt config | jq '{hooks, tools}'
```

`wt config --layers` additionally shows which file each value came from, so you
can tell your own defaults apart from the repository's.

## What this does not protect against

- A tool binary you already trust doing something unexpected. `detect` only
  checks that a name is on `PATH`.
- Anything outside `wt`. Cloning a hostile repository is dangerous for many
  reasons; this gate closes one of them.
- Your own global config. It is not gated by design.
