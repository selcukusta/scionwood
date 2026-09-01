import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const SCRIPT_REL = ".opencode/scripts/wt"
const CONFIG_REL = path.join(".opencode", "wt.json")

// Mirrors the 0.2.0 bash schema (defaults match bash's built-in defaults)
export type ToolSpec = {
  detect?: string
  dataDir?: string
  env?: Record<string, string>
  setup?: string
  teardown?: string
}

export type Config = {
  basePath: string
  branchPrefix: string
  prRef: string
  filesToLink: string[]
  hooks: { postCreate?: string; preTeardown?: string }
  tools: Record<string, ToolSpec>
}

export const DEFAULT_CONFIG: Config = {
  basePath: ".git-worktrees",
  branchPrefix: "review/",
  prRef: "pull/{n}/head",
  filesToLink: ["CLAUDE.local.md", ".claude/settings.local.json", ".env"],
  hooks: {},
  tools: {
    codegraph: {
      detect: "codegraph",
      dataDir: ".codegraph-{name}",
      env: { CODEGRAPH_PROJECT_PATH: "{worktree}", CODEGRAPH_DATA_DIR: "{dataDir}" },
      setup: "codegraph init -i && codegraph sync",
    },
  },
}

/** Substitute {placeholders}. An unknown placeholder is left as-is so a typo is
 *  visible in the output rather than silently becoming an empty string. */
export function expandTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? vars[key] : whole))
}

function varsForTool(spec: ToolSpec, vars: Record<string, string>): Record<string, string> {
  if (!spec.dataDir) return vars
  return { ...vars, dataDir: path.join(vars.worktree ?? "", expandTemplate(spec.dataDir, vars)) }
}

/** Every configured tool's env, expanded and merged. */
export function toolEnv(
  tools: Record<string, ToolSpec>,
  vars: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const spec of Object.values(tools ?? {})) {
    if (!spec?.env) continue
    const v = varsForTool(spec, vars)
    for (const [k, tpl] of Object.entries(spec.env)) out[k] = expandTemplate(tpl, v)
  }
  return out
}

/** Env for the tool this MCP server belongs to, matched by tool key against the
 *  server's name or command. Returns undefined when no tool claims it. */
export function mcpEnvFor(
  serverName: string,
  serverCommand: string,
  tools: Record<string, ToolSpec>,
  vars: Record<string, string>,
): Record<string, string> | undefined {
  for (const [key, spec] of Object.entries(tools ?? {})) {
    const k = key.toLowerCase()
    if (!serverName.toLowerCase().includes(k) && !serverCommand.toLowerCase().includes(k)) continue
    if (!spec?.env) return {}
    const v = varsForTool(spec, vars)
    const out: Record<string, string> = {}
    for (const [ek, tpl] of Object.entries(spec.env)) out[ek] = expandTemplate(tpl, v)
    return out
  }
  return undefined
}

type WorktreeInfo = {
  name: string
  root: string
  mainRoot: string
}

type Logger = (
  level: "debug" | "info" | "warn" | "error",
  message: string,
  extra?: Record<string, unknown>,
) => Promise<void>

export function normalizeBasePath(p: string): string {
  return p.replace(/\/+$/, "").replace(/^\.\//, "")
}

export function loadConfig(mainRoot: string, log?: Logger): Config {
  const config: Config = {
    ...DEFAULT_CONFIG,
    hooks: { ...DEFAULT_CONFIG.hooks },
    tools: JSON.parse(JSON.stringify(DEFAULT_CONFIG.tools)) as Record<string, ToolSpec>,
  }
  const cfgPath = path.join(mainRoot, CONFIG_REL)
  if (existsSync(cfgPath)) {
    try {
      const raw = JSON.parse(readFileSync(cfgPath, "utf8")) as Partial<Config>
      config.basePath = typeof raw.basePath === "string" ? raw.basePath : config.basePath
      config.branchPrefix = typeof raw.branchPrefix === "string" ? raw.branchPrefix : config.branchPrefix
      config.prRef = typeof raw.prRef === "string" ? raw.prRef : config.prRef
      config.filesToLink = Array.isArray(raw.filesToLink) ? raw.filesToLink : config.filesToLink
      if (raw.hooks && typeof raw.hooks === "object") config.hooks = { ...config.hooks, ...raw.hooks }
      if (raw.tools && typeof raw.tools === "object") config.tools = { ...config.tools, ...raw.tools }
    } catch (e: any) {
      void log?.("warn", `invalid ${CONFIG_REL}; using defaults`, { error: String(e?.message ?? e) })
    }
  }
  // env beats file beats defaults
  if (process.env.WT_BASE !== undefined) config.basePath = process.env.WT_BASE
  if (process.env.WT_BRANCH_PREFIX !== undefined) config.branchPrefix = process.env.WT_BRANCH_PREFIX
  if (process.env.WT_PR_REF !== undefined) config.prRef = process.env.WT_PR_REF
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

/**
 * Locate the bash CLI. The repository's own copy wins so a user's edited script
 * is always the one that runs; otherwise fall back to whatever ships with this
 * module -- which, for a global npm install, lives under opencode's plugin cache
 * (~/.cache/opencode/node_modules/...) rather than anywhere inside the repo.
 */
export function resolveScriptPath(
  directory: string,
  moduleDir: string,
  exists: (p: string) => boolean,
): string | undefined {
  const candidates = [
    path.join(directory, SCRIPT_REL),
    path.join(moduleDir, "scripts", "wt"),
    path.join(moduleDir, "..", "scripts", "wt"),
    path.join(directory, "node_modules", "sprig-worktree", "dist", "scripts", "wt"),
  ]
  return candidates.find(exists)
}

const MODULE_DIR: string =
  typeof (import.meta as any).dir === "string"
    ? (import.meta as any).dir
    : path.dirname(new URL(import.meta.url).pathname)

/**
 * Decide whether the worktree's artifacts may be cleaned after a session closes.
 * Fails closed: an unknown session list (an API error) never authorises deletion.
 */
export function shouldClean(
  sessions: Array<{ id: string; directory?: string }> | undefined,
  deletedId: string | undefined,
  directory: string,
): boolean {
  if (!sessions) return false
  const others = sessions.filter((s) => s.id !== deletedId && (s.directory ? s.directory === directory : true))
  return others.length === 0
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
  const script = resolveScriptPath(directory, MODULE_DIR, existsSync)
  if (!script) {
    return {
      code: 1,
      output:
        `wt script not found. Looked beside this plugin (${MODULE_DIR}) and in ${directory}. ` +
        `Install with 'npm install sprig-worktree', or copy .opencode/scripts/wt into your repo.`,
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

  const info: WorktreeInfo = { ...wt, mainRoot }

  // Every configured tool's env, expanded once. Adding a tool is config only:
  // nothing here names a specific tool.
  const templateVars: Record<string, string> = {
    name: info.name,
    worktree: info.root,
    mainRoot: info.mainRoot,
    dataDir: "",
  }
  const env = toolEnv(config.tools, templateVars)
  for (const [k, v] of Object.entries(env)) process.env[k] = v

  const ready = runScript(directory, ["bootstrap", info.root]).then(async (r) => {
    if (r.code !== 0) {
      await log("warn", "bootstrap failed", { output: r.output.slice(-500) })
      return
    }
    const toolNames = Object.keys(config.tools ?? {})
    await log("info", "bootstrap complete", { tools: toolNames })
    try {
      await client.tui.showToast({
        body: { message: `worktree ${info.name}: bootstrap complete`, variant: "success" },
      })
    } catch {}
  })
  void ready

  return {
    config: async (cfg) => {
      cfg.mcp = cfg.mcp ?? {}
      for (const [name, server] of Object.entries(cfg.mcp)) {
        if (!server || server.type !== "local") continue
        const cmd = Array.isArray(server.command) ? server.command.join(" ") : ""
        const injected = mcpEnvFor(name, cmd, config.tools, templateVars)
        if (!injected) continue
        server.environment = { ...injected, ...server.environment }
      }
      cfg.permission = cfg.permission ?? {}
      const perm = cfg.permission as unknown as { external_directory?: Record<string, "ask" | "allow" | "deny"> }
      perm.external_directory = {
        ...(perm.external_directory ?? {}),
        [`${info.mainRoot}/**`]: "allow",
      }
    },
    "shell.env": async (_input, output) => {
      for (const [k, v] of Object.entries(env)) output.env[k] = v
    },
    event: async ({ event }) => {
      if (event.type !== "session.deleted") return
      const deletedId = (event as any).properties?.info?.id
      let sessions: Array<{ id: string; directory?: string }> | undefined
      try {
        const res = await client.session.list()
        sessions = (res.data ?? []) as Array<{ id: string; directory?: string }>
      } catch (e: any) {
        await log("warn", "could not list sessions; skipping cleanup (failing closed)", {
          error: String(e?.message ?? e),
        })
        return
      }
      if (!shouldClean(sessions, deletedId, directory)) return
      const r = await runScript(directory, ["clean", info.root])
      await log(r.code === 0 ? "info" : "warn", "worktree artifacts cleaned", {
        ...(r.code === 0 ? {} : { output: r.output.slice(-500) }),
      })
    },
  }
}