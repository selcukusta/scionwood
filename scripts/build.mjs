import { mkdirSync, copyFileSync, chmodSync, writeFileSync, rmSync } from "node:fs"

mkdirSync("dist/scripts", { recursive: true })

// tsc mirrors the source filename (sprig-worktree.ts → dist/sprig-worktree.js).
// Rename to plugin.js/plugin.d.ts to match the package's published entry points
// (main/types/exports) and the default-export wrapper below.
copyFileSync("dist/sprig-worktree.js", "dist/plugin.js")
copyFileSync("dist/sprig-worktree.d.ts", "dist/plugin.d.ts")
rmSync("dist/sprig-worktree.js")
rmSync("dist/sprig-worktree.d.ts")

// Copy bash script with executable bit preserved
copyFileSync(".opencode/scripts/wt", "dist/scripts/wt")
chmodSync("dist/scripts/wt", 0o755)

// Default-export wrapper — source uses named export to keep helpers testable,
// this satisfies opencode's default-export convention
writeFileSync(
  "dist/index.js",
  `import { SprigWorktreePlugin } from "./plugin.js";\n` +
  `export default SprigWorktreePlugin;\n` +
  `export { SprigWorktreePlugin };\n`
)

console.log("build: dist/plugin.js, dist/plugin.d.ts, dist/index.js, dist/scripts/wt")