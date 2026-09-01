# Migrating 0.1.x → 0.2.0

The config schema changed. There is no compatibility shim: a config carrying a
removed field makes `wt` stop with a message naming the field and its
replacement. That is deliberate — silently ignoring a field you wrote means your
worktrees quietly stop behaving the way you configured them.

## What changed

| 0.1.x | 0.2.0 | Why |
| --- | --- | --- |
| `basePath` | unchanged | — |
| `branchPrefix` | unchanged; default is now `wt/` | the tool is no longer review-only |
| `namePattern` | **removed** | the source is a CLI flag now, not a naming convention |
| `fetchPrune` | **removed** | `wt new` always fetches; fetching is read-only and safe |
| `pullRebase` | **removed** | rebasing your checked-out branch as a side effect of creating a worktree is a footgun |
| `filesToLink` | unchanged; entries can now be removed with `!` | — |
| `npmInstallDirs` | **removed** | replaced by `hooks.postCreate`, a script you own |
| `tools.<n>.enabled` | **removed** | replaced by `detect`, or remove the entry with `!<n>` |
| — | `prRef` **new** | works on GitLab, Gitea and Bitbucket |
| — | `hooks` **new** | `postCreate`, `preTeardown` |
| — | `tools` **new** | `detect`, `dataDir`, `env`, `setup`, `teardown` |

## Before

```json
{
  "basePath": ".git-worktrees",
  "branchPrefix": "review/",
  "namePattern": "^review-pr-([0-9]+)$",
  "fetchPrune": true,
  "pullRebase": true,
  "filesToLink": ["CLAUDE.local.md", ".env"],
  "npmInstallDirs": [".", "apps/frontend"],
  "tools": { "codegraph": { "enabled": true } }
}
```

## After

```json
{
  "basePath": ".git-worktrees",
  "branchPrefix": "wt/",
  "prRef": "pull/{n}/head",
  "filesToLink": ["CLAUDE.local.md", ".env"],
  "hooks": {
    "postCreate": ".opencode/hooks/post-create.sh"
  }
}
```

`tools` is omitted entirely because the built-in default already provides
codegraph. `npmInstallDirs` becomes a script:

```bash
#!/usr/bin/env bash
# .opencode/hooks/post-create.sh
set -euo pipefail
npm install --no-fund --no-audit
(cd apps/frontend && npm install --no-fund --no-audit)
```

`wt init` writes both the config and a starter hook for you.

## Command changes

| 0.1.x | 0.2.0 |
| --- | --- |
| `wt new review-pr-1234` | `wt new review-pr-1234 --pr 1234` |
| — | `wt new spike-auth` (branch from the default branch) |
| — | `wt new hotfix --from v2.1.0` |
| — | `wt new theirs --branch feat-x` |
| `wt install --defaults --non-interactive` | `wt install` (machine) then `wt init` (repo) |
| — | `wt config [--layers]` |

## One thing that will surprise you

**Teardown refuses to destroy work.** `wt teardown` now checks for uncommitted
changes and unmerged commits and stops rather than discarding them. Pass
`--force` for the old behaviour.
