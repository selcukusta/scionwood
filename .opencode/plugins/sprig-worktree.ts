import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const SCRIPT_REL = ".opencode/scripts/wt"
const CONFIG_REL = path.join(".opencode", "wt.json")

// Mirrors the post-phase-2 bash schema (defaults match bash's built-in defaults)
export type Config = {
  basePath: string
  branchPrefix: string
  namePattern: string
  fetchPrune: boolean
  pullRebase: boolean
  filesToLink: string[]
  npmInstallDirs: string[]
  tools: { codegraph: { enabled: boolean } }
}

export const DEFAULT_CONFIG: Config = {
  basePath: ".git-worktrees",
  branchPrefix: "review/",
  namePattern: "^review-pr-([0-9]+)$",
  fetchPrune: true,
  pullRebase: true,
  filesToLink: ["CLAUDE.local.md", ".claude/settings.local.json", ".env"],
  npmInstallDirs: [".", "apps/frontend"],
  tools: { codegraph: { enabled: true } },
}

type WorktreeInfo = {
  name: string
  root: string
  mainRoot: string
  codegraphDataDir: string
}

type Logger = (
  level: "debug" | "info" | "warn" | "error",
  message: string,
  extra?: Record<string, unknown>,
) => Promise<void>

export function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  switch (value.trim().toLowerCase()) {
    case "true":
    case "yes":
    case "1":
      return true
    case "false":
    case "no":
    case "0":
      return false
    default:
      return fallback
  }
}

export function normalizeBasePath(p: string): string {
  return p.replace(/\/+$/, "").replace(/^\.\//, "")
}

export function loadConfig(mainRoot: string, log?: Logger): Config {
  const config: Config = {
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      codegraph: { ...DEFAULT_CONFIG.tools.codegraph },
    },
  }
  const cfgPath = path.join(mainRoot, CONFIG_REL)
  if (existsSync(cfgPath)) {
    try {
      const raw = JSON.parse(readFileSync(cfgPath, "utf8")) as Partial<Config>
      config.basePath = typeof raw.basePath === "string" ? raw.basePath : config.basePath
      config.branchPrefix = typeof raw.branchPrefix === "string" ? raw.branchPrefix : config.branchPrefix
      config.namePattern = typeof raw.namePattern === "string" ? raw.namePattern : config.namePattern
      config.fetchPrune = typeof raw.fetchPrune === "boolean" ? raw.fetchPrune : config.fetchPrune
      config.pullRebase = typeof raw.pullRebase === "boolean" ? raw.pullRebase : config.pullRebase
      config.filesToLink = Array.isArray(raw.filesToLink) ? raw.filesToLink : config.filesToLink
      config.npmInstallDirs = Array.isArray(raw.npmInstallDirs) ? raw.npmInstallDirs : config.npmInstallDirs
      if (raw.tools && typeof raw.tools.codegraph?.enabled === "boolean") {
        config.tools.codegraph.enabled = raw.tools.codegraph.enabled
      }
    } catch (e: any) {
      void log?.("warn", `invalid ${CONFIG_REL}; using defaults`, { error: String(e?.message ?? e) })
    }
  }
  // env beats file beats defaults
  if (process.env.WT_BASE !== undefined) config.basePath = process.env.WT_BASE
  if (process.env.WT_BRANCH_PREFIX !== undefined) config.branchPrefix = process.env.WT_BRANCH_PREFIX
  if (process.env.WT_NAME_PATTERN !== undefined) config.namePattern = process.env.WT_NAME_PATTERN
  if (process.env.WT_FETCH_PRUNE !== undefined) config.fetchPrune = parseBool(process.env.WT_FETCH_PRUNE, config.fetchPrune)
  if (process.env.WT_PULL_REBASE !== undefined) config.pullRebase = parseBool(process.env.WT_PULL_REBASE, config.pullRebase)
  if (process.env.WT_CODEGRAPH !== undefined) config.tools.codegraph.enabled = parseBool(process.env.WT_CODEGRAPH, config.tools.codegraph.enabled)
  return config
}

export function parseWorktree(dir: string, basePath: string): { name: string; root: string } | undefined {
  const marker = `${path.sep}${normalizeBasePath(basePath)}${path.sep}`
  const resolved = path.resolve(dir)
  const idx = resolved.indexOf(marker)
  if (idx === -1) return undefined
  const name = resolved.slice(idx + marker.length).split(path.sep)[0]
  if (!name) return undefined
  return { name, root: path.join(resolved.slice(0, idx + marker.length), name) }
}

export function findMainRepoRoot(from: string, basePath: string): string | undefined {
  const worktreesSegment = `${path.sep}${normalizeBasePath(basePath)}${path.sep}`
  let current = path.resolve(from)
  for (;;) {
    if (!current.includes(worktreesSegment)) {
      const git = path.join(current, ".git")
      if (existsSync(git) && statSync(git).isDirectory()) return current
    }
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function makeLogger(client: any, service = "sprig-worktree"): Logger {
  return async (level, message, extra) => {
    try {
      await client.app.log({ body: { service, level, message, extra } })
    } catch {}
  }
}

async function runScript(
  directory: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
  let script = path.join(directory, SCRIPT_REL)
  if (!existsSync(script)) {
    // npm-installed fallback: bundled bash lives at node_modules/sprig-worktree/dist/scripts/wt
    const nodeModulesScript = path.join(directory, "node_modules", "sprig-worktree", "dist", "scripts", "wt")
    if (existsSync(nodeModulesScript)) {
      script = nodeModulesScript
    } else {
      return {
        code: 1,
        output: `wt script not found — looked at ${path.join(directory, SCRIPT_REL)} and ${nodeModulesScript}; install via 'npm install sprig-worktree' or copy .opencode/scripts/wt into your repo`,
      }
    }
  }
  try {
    const proc = Bun.spawn(["bash", script, ...args], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, WT_OPEN: "none", ...extraEnv },
    })
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    await proc.exited
    return { code: proc.exitCode ?? 1, output: `${out}\n${err}`.trim() }
  } catch (e: any) {
    return { code: 1, output: String(e?.message ?? e) }
  }
}

export const SprigWorktreePlugin: Plugin = async ({ client, directory }) => {
  const log = makeLogger(client)

  // First pass with default basePath to find main
  const defaultBasePath = DEFAULT_CONFIG.basePath
  let mainRoot = findMainRepoRoot(directory, defaultBasePath)
  if (!mainRoot) {
    // Try with common alternative bases too: ".claude/worktrees" — handle rename case
    mainRoot = findMainRepoRoot(directory, ".claude/worktrees")
  }
  if (!mainRoot) {
    await log("error", `could not locate main repository root above ${directory}`)
    return {}
  }

  // Load config from main
  const config = loadConfig(mainRoot, log)

  // Detect worktree using config's basePath (fall back to default)
  let wt = parseWorktree(directory, config.basePath)
  if (!wt && config.basePath !== defaultBasePath) {
    await log("warn", `directory does not contain configured basePath "${config.basePath}"; falling back to default`, { directory })
    wt = parseWorktree(directory, defaultBasePath)
  }
  if (!wt) return {}

  // First-run bootstrap if no config existed
  const cfgPath = path.join(mainRoot, CONFIG_REL)
  if (!existsSync(cfgPath)) {
    const r = await runScript(directory, ["install"], { WT_MAIN_ROOT: mainRoot })
    if (r.code === 0) {
      await log("info", "first-run bootstrap complete", { mainRoot })
      // install writes the shim, but this session's PATH predates it — check and
      // log an actionable hint; never fail the session over a missing shim.
      if (!Bun.which("wt")) {
        const candidates = ["/opt/homebrew/bin/wt", "/usr/local/bin/wt", path.join(process.env.HOME ?? "", ".local/bin/wt")]
        const shim = candidates.find((c) => existsSync(c))
        await log("warn", "`wt` shim is not on PATH for this session; restart opencode or add its directory to PATH", {
          ...(shim ? { shim, hint: `export PATH="${path.dirname(shim)}:$PATH"` } : { hint: "run `wt install` manually" }),
        })
      }
    } else {
      await log("warn", "first-run bootstrap failed; run `wt install` manually", { output: r.output.slice(-500) })
    }
  }

  const codegraphEnabled = config.tools.codegraph.enabled
  const info: WorktreeInfo = {
    ...wt,
    mainRoot,
    codegraphDataDir: codegraphEnabled ? path.join(wt.root, `.codegraph-${wt.name}`) : "",
  }

  if (codegraphEnabled) {
    process.env.CODEGRAPH_PROJECT_PATH = info.root
    process.env.CODEGRAPH_DATA_DIR = info.codegraphDataDir
  }
  // (else: leave process.env alone — bash gates codegraph internally too)

  const ready = runScript(directory, ["bootstrap", info.root]).then(async (r) => {
    if (r.code !== 0) {
      await log("warn", "bootstrap failed", { output: r.output.slice(-500) })
      return
    }
    await log("info", "bootstrap complete", codegraphEnabled ? { dataDir: info.codegraphDataDir } : { codegraph: "disabled" })
    try {
      await client.tui.showToast({
        body: { message: `worktree ${info.name}: bootstrap complete${codegraphEnabled ? "" : " (codegraph disabled)"}`, variant: "success" },
      })
    } catch {}
  })
  void ready

  return {
    config: async (cfg) => {
      cfg.mcp = cfg.mcp ?? {}
      if (codegraphEnabled) {
        for (const [name, server] of Object.entries(cfg.mcp)) {
          if (!server || server.type !== "local") continue
          const cmd = Array.isArray(server.command) ? server.command.join(" ") : ""
          if (name.toLowerCase().includes("codegraph") || cmd.includes("codegraph")) {
            server.environment = {
              CODEGRAPH_PROJECT_PATH: info.root,
              CODEGRAPH_DATA_DIR: info.codegraphDataDir,
              ...server.environment,
            }
          }
        }
      }
      cfg.permission = cfg.permission ?? {}
      const perm = cfg.permission as unknown as { external_directory?: Record<string, "ask" | "allow" | "deny"> }
      perm.external_directory = {
        ...(perm.external_directory ?? {}),
        [`${info.mainRoot}/**`]: "allow",
      }
    },
    "shell.env": async (_input, output) => {
      if (codegraphEnabled) {
        output.env.CODEGRAPH_PROJECT_PATH = info.root
        output.env.CODEGRAPH_DATA_DIR = info.codegraphDataDir
      }
    },
    event: async ({ event }) => {
      if (event.type !== "session.deleted") return
      const deletedId = (event as any).properties?.info?.id
      let remaining = true
      try {
        const res = await client.session.list()
        remaining = (res.data ?? []).some(
          (s: any) => s.id !== deletedId && (s.directory ? s.directory === directory : true),
        )
      } catch {
        remaining = false
      }
      if (remaining) return
      const r = await runScript(directory, ["clean", info.root])
      await log(r.code === 0 ? "info" : "warn", "worktree artifacts cleaned", {
        ...(codegraphEnabled ? { dataDir: info.codegraphDataDir } : {}),
        ...(r.code === 0 ? {} : { output: r.output.slice(-500) }),
      })
    },
  }
}