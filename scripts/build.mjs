import { mkdirSync, copyFileSync, chmodSync, writeFileSync, rmSync } from "node:fs"

mkdirSync("dist/scripts", { recursive: true })

// tsc mirrors the source filename (scionwood.ts → dist/scionwood.js).
// Rename to plugin.js/plugin.d.ts to match the package's published entry points
// (main/types/exports) and the default-export wrapper below.
copyFileSync("dist/scionwood.js", "dist/plugin.js")
copyFileSync("dist/scionwood.d.ts", "dist/plugin.d.ts")
rmSync("dist/scionwood.js")
rmSync("dist/scionwood.d.ts")

// Copy bash script with executable bit preserved
copyFileSync(".opencode/scripts/wt", "dist/scripts/wt")
chmodSync("dist/scripts/wt", 0o755)

// Default-export wrapper — source uses named export to keep helpers testable,
// this satisfies opencode's default-export convention
writeFileSync(
  "dist/index.js",
  `import { ScionwoodPlugin } from "./plugin.js";\n` +
  `export default ScionwoodPlugin;\n` +
  `export { ScionwoodPlugin };\n`
)

console.log("build: dist/plugin.js, dist/plugin.d.ts, dist/index.js, dist/scripts/wt")