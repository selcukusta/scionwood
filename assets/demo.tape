# Regenerate with:  vhs assets/demo.tape   (run from the repository root)
#
# Self-contained: clones this repo into a scratch directory, records the demo
# there, and cleans up. Re-run it whenever the CLI output changes.

Output assets/demo.gif

Set Shell bash
Set FontSize 13
Set Width 1100
Set Height 780
Set Padding 18
Set TypingSpeed 45ms
Set Theme "Catppuccin Mocha"

# --- setup, not recorded -----------------------------------------------------
Hide
Type "rm -rf /tmp/scionwood-demo && mkdir -p /tmp/scionwood-demo" Enter
Type "git clone -q $PWD /tmp/scionwood-demo/scionwood" Enter
Type "cd /tmp/scionwood-demo/scionwood" Enter
Type "printf 'API_KEY=local-dev-secret\n' > .env" Enter
Type "printf 'project notes\n' > CLAUDE.local.md" Enter
Type "export WT_OPEN=none PS1='$ '" Enter
Type "clear" Enter
Show

# --- 1. create an isolated worktree ------------------------------------------
Type "wt new spike-auth"
Sleep 600ms
Enter
Sleep 4s

# --- 2. it is a real worktree, on its own branch ------------------------------
Type "wt list"
Sleep 400ms
Enter
Sleep 1500ms

# --- 3. do some work in it ---------------------------------------------------
Type "cd .git-worktrees/spike-auth"
Sleep 300ms
Enter
Sleep 600ms

Type "echo '// half-finished experiment' >> scripts/build.mjs"
Sleep 400ms
Enter
Sleep 1s

# --- 4. teardown refuses to throw the work away ------------------------------
Type "wt teardown"
Sleep 600ms
Enter
Sleep 4s

# --- 5. --force is the deliberate way out ------------------------------------
Type "wt teardown --force"
Sleep 600ms
Enter
Sleep 4s

# --- cleanup, not recorded ---------------------------------------------------
Hide
Type "cd / && rm -rf /tmp/scionwood-demo" Enter
Show
