# Regenerate with:  vhs assets/demo.tape   (run from the repository root)
#
# Self-contained: clones this repo from GitHub into a scratch directory so a
# real pull request is fetchable, records, and cleans up. pull/N/head refs
# persist after a PR is closed, so PR #1 stays fetchable indefinitely.

Output assets/demo.gif

Set Shell bash
Set FontSize 13
Set Width 1100
Set Height 720
Set Padding 18
Set TypingSpeed 45ms
Set Theme "Catppuccin Mocha"

# --- setup, not recorded -----------------------------------------------------
Hide
Type "rm -rf /tmp/scionwood-demo && mkdir -p /tmp/scionwood-demo" Enter
Type "git clone -q https://github.com/selcukusta/scionwood /tmp/scionwood-demo/scionwood" Enter
Type "cd /tmp/scionwood-demo/scionwood" Enter
Type "printf 'API_KEY=local-dev-secret\n' > .env" Enter
Type "printf 'project notes\n' > CLAUDE.local.md" Enter
# GIT_PAGER: vhs gives git a real terminal, so `git log` would open less and
# swallow every keystroke after it.
Type "export WT_OPEN=none GIT_PAGER=cat PAGER=cat PS1='$ '" Enter
Type "clear" Enter
Show

# --- 1. pull someone else's PR into a worktree of its own --------------------
Type "wt new review --pr 1"
Sleep 600ms
Enter
Sleep 6s

# --- 2. it really is the PR's code, on its own branch ------------------------
Type "cd .git-worktrees/review && git log --oneline -1"
Sleep 400ms
Enter
Sleep 2s

Type "ls .github/ISSUE_TEMPLATE/"
Sleep 400ms
Enter
Sleep 2s

# --- 3. and it will not let you throw work away ------------------------------
Type "echo '# reviewer note' >> README.md"
Sleep 400ms
Enter
Sleep 800ms

Type "wt teardown"
Sleep 600ms
Enter
Sleep 4s

Type "wt teardown --force"
Sleep 600ms
Enter
Sleep 3500ms

# --- cleanup, not recorded ---------------------------------------------------
Hide
Type "cd / && rm -rf /tmp/scionwood-demo" Enter
Show
