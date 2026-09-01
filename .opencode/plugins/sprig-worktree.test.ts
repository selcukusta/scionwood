import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import {
  parseBool,
  normalizeBasePath,
  loadConfig,
  parseWorktree,
  findMainRepoRoot,
  shouldClean,
  resolveScriptPath,
  DEFAULT_CONFIG,
} from "./sprig-worktree.ts"

// ---------------------------------------------------------------------------
// suite-wide isolation: snapshot all WT_* env vars and clean temp dirs
// ---------------------------------------------------------------------------

const WT_KEYS = [
  "WT_BASE",
  "WT_BRANCH_PREFIX",
  "WT_NAME_PATTERN",
  "WT_FETCH_PRUNE",
  "WT_PULL_REBASE",
  "WT_CODEGRAPH",
  "WT_MAIN_ROOT",
  "WT_OPEN",
  "WT_BIN",
  "WT_FILES_TO_LINK",
  "WT_NPM_DIRS",
]

let savedEnv = new Map<string, string | undefined>()
let tmpDirs: string[] = []

beforeEach(() => {
  savedEnv = new Map()
  for (const k of WT_KEYS) savedEnv.set(k, process.env[k])
  tmpDirs = []
})

afterEach(() => {
  for (const [k, v] of savedEnv) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
  tmpDirs = []
})

function makeTmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "wt-test-"))
  tmpDirs.push(d)
  return d
}

function writeConfig(mainRoot: string, contents: string): string {
  const dir = path.join(mainRoot, ".opencode")
  mkdirSync(dir, { recursive: true })
  const cfgPath = path.join(dir, "wt.json")
  writeFileSync(cfgPath, contents)
  return cfgPath
}

// ---------------------------------------------------------------------------
// parseBool — exhaustive truthy/falsy/fallback
// ---------------------------------------------------------------------------

describe("parseBool", () => {
  test("truthy spellings (case-insensitive)", () => {
    for (const v of ["true", "TRUE", "True", "yes", "YES", "1"]) {
      expect(parseBool(v, false)).toBe(true)
    }
  })

  test("falsy spellings (case-insensitive)", () => {
    for (const v of ["false", "FALSE", "False", "no", "No", "0"]) {
      expect(parseBool(v, true)).toBe(false)
    }
  })

  test("unknown spellings fall back (never crash)", () => {
    for (const v of ["", "maybe", "2", "off"]) {
      expect(parseBool(v, true)).toBe(true)
      expect(parseBool(v, false)).toBe(false)
    }
  })

  test("undefined falls back", () => {
    expect(parseBool(undefined, true)).toBe(true)
    expect(parseBool(undefined, false)).toBe(false)
  })

  test("trims surrounding whitespace", () => {
    expect(parseBool("  true  ", false)).toBe(true)
    expect(parseBool("\tNO\n", true)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// normalizeBasePath — path normalization
// ---------------------------------------------------------------------------

describe("normalizeBasePath", () => {
  test("already-normalized paths pass through", () => {
    expect(normalizeBasePath(".git-worktrees")).toBe(".git-worktrees")
    expect(normalizeBasePath(".claude/worktrees")).toBe(".claude/worktrees")
  })

  test("strips leading ./", () => {
    expect(normalizeBasePath("./.git-worktrees")).toBe(".git-worktrees")
  })

  test("strips trailing slash", () => {
    expect(normalizeBasePath(".git-worktrees/")).toBe(".git-worktrees")
    expect(normalizeBasePath(".claude/worktrees/")).toBe(".claude/worktrees")
  })

  test("strips both leading ./ and trailing slash", () => {
    expect(normalizeBasePath("./.git-worktrees/")).toBe(".git-worktrees")
  })

  test("multiple trailing slashes collapse to a clean path", () => {
    expect(normalizeBasePath(".wt//")).toBe(".wt")
  })
})

// ---------------------------------------------------------------------------
// loadConfig — config loading + env precedence (env > file > default)
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
  test("non-existent main root returns DEFAULT_CONFIG (no crash)", () => {
    expect(loadConfig("/nonexistent/path")).toEqual(DEFAULT_CONFIG)
  })

  test("empty valid JSON config returns DEFAULT_CONFIG", () => {
    const tmp = makeTmp()
    writeConfig(tmp, "{}")
    expect(loadConfig(tmp)).toEqual(DEFAULT_CONFIG)
  })

  test("partial config merges with DEFAULT_CONFIG", () => {
    const tmp = makeTmp()
    writeConfig(tmp, JSON.stringify({ basePath: ".wt-trees" }))
    const cfg = loadConfig(tmp)
    expect(cfg.basePath).toBe(".wt-trees")
    expect(cfg.branchPrefix).toBe(DEFAULT_CONFIG.branchPrefix)
    expect(cfg.fetchPrune).toBe(DEFAULT_CONFIG.fetchPrune)
    expect(cfg.tools.codegraph.enabled).toBe(DEFAULT_CONFIG.tools.codegraph.enabled)
    expect(cfg).toEqual({ ...DEFAULT_CONFIG, basePath: ".wt-trees" })
  })

  test("full config is honored field-by-field", () => {
    const tmp = makeTmp()
    const full = {
      basePath: ".wt-trees",
      branchPrefix: "pr/",
      namePattern: "^pr-([0-9]+)$",
      fetchPrune: false,
      pullRebase: false,
      filesToLink: [".env"],
      npmInstallDirs: ["apps/api"],
      tools: { codegraph: { enabled: false } },
    }
    writeConfig(tmp, JSON.stringify(full))
    expect(loadConfig(tmp)).toEqual(full)
  })

  test("malformed JSON warns via logger and falls back to DEFAULT_CONFIG", () => {
    const tmp = makeTmp()
    writeConfig(tmp, "{ not valid json !!!")
    const calls: Array<{ level: string; message: string }> = []
    const log = async (level: any, message: any, _extra?: any) => {
      calls.push({ level, message })
    }
    const cfg = loadConfig(tmp, log)
    expect(cfg).toEqual(DEFAULT_CONFIG)
    expect(calls.some((c) => c.level === "warn" && c.message.includes("wt.json"))).toBe(true)
  })

  test("type-mismatched fields are rejected and fall back", () => {
    const tmp = makeTmp()
    writeConfig(tmp, JSON.stringify({ basePath: 123, fetchPrune: "yes", tools: { codegraph: { enabled: "0" } } }))
    const cfg = loadConfig(tmp)
    expect(cfg.basePath).toBe(DEFAULT_CONFIG.basePath)
    expect(cfg.fetchPrune).toBe(DEFAULT_CONFIG.fetchPrune)
    expect(cfg.tools.codegraph.enabled).toBe(DEFAULT_CONFIG.tools.codegraph.enabled)
  })

  test("WT_BASE env overrides file value", () => {
    const tmp = makeTmp()
    writeConfig(tmp, JSON.stringify({ basePath: ".wt-trees" }))
    process.env.WT_BASE = ".env-base"
    expect(loadConfig(tmp).basePath).toBe(".env-base")
  })

  test("WT_FETCH_PRUNE env parses false/true over file value", () => {
    const tmp = makeTmp()
    writeConfig(tmp, JSON.stringify({ fetchPrune: true }))
    process.env.WT_FETCH_PRUNE = "false"
    expect(loadConfig(tmp).fetchPrune).toBe(false)
    process.env.WT_FETCH_PRUNE = "no"
    expect(loadConfig(tmp).fetchPrune).toBe(false)
  })

  test("WT_CODEGRAPH env disables codegraph with 0/false/no", () => {
    const tmp = makeTmp()
    for (const v of ["0", "false", "no"]) {
      process.env.WT_CODEGRAPH = v
      expect(loadConfig(tmp).tools.codegraph.enabled).toBe(false)
    }
    process.env.WT_CODEGRAPH = "1"
    expect(loadConfig(tmp).tools.codegraph.enabled).toBe(true)
  })

  test("unset env vars have no effect", () => {
    const tmp = makeTmp()
    writeConfig(tmp, JSON.stringify({ basePath: ".wt-trees" }))
    delete process.env.WT_BASE
    delete process.env.WT_CODEGRAPH
    const cfg = loadConfig(tmp)
    expect(cfg.basePath).toBe(".wt-trees")
    expect(cfg.tools.codegraph.enabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// parseWorktree — worktree detection
// ---------------------------------------------------------------------------

describe("parseWorktree", () => {
  test("detects worktree under basePath", () => {
    const tmp = makeTmp()
    const wt = parseWorktree(path.join(tmp, ".git-worktrees", "review-pr-1234", "src"), ".git-worktrees")
    expect(wt).toEqual({ name: "review-pr-1234", root: path.join(tmp, ".git-worktrees", "review-pr-1234") })
  })

  test("returns undefined when basePath segment absent", () => {
    const tmp = makeTmp()
    expect(parseWorktree(path.join(tmp, "src"), ".git-worktrees")).toBeUndefined()
  })

  test("custom basePath is honored", () => {
    const tmp = makeTmp()
    const wt = parseWorktree(path.join(tmp, ".wt-trees", "foo"), ".wt-trees")
    expect(wt).toEqual({ name: "foo", root: path.join(tmp, ".wt-trees", "foo") })
  })

  test("normalized ./ prefix yields same result as bare basePath", () => {
    const tmp = makeTmp()
    const withPrefix = parseWorktree(path.join(tmp, ".", ".git-worktrees", "review-pr-42"), ".git-worktrees")
    const withoutPrefix = parseWorktree(path.join(tmp, ".git-worktrees", "review-pr-42"), ".git-worktrees")
    expect(withPrefix).toEqual(withoutPrefix)
    expect(withPrefix?.name).toBe("review-pr-42")
  })

  test("base directory itself (no name segment) yields no worktree", () => {
    const tmp = makeTmp()
    // path.resolve normalizes away a trailing separator, so a path ending at
    // the basePath dir cannot match the marker and yields undefined
    expect(parseWorktree(path.join(tmp, ".git-worktrees"), ".git-worktrees")).toBeUndefined()
    expect(parseWorktree(path.join(tmp, ".git-worktrees", ""), ".git-worktrees")).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// findMainRepoRoot — main repo detection
// ---------------------------------------------------------------------------

describe("findMainRepoRoot", () => {
  function makeRepo(basePathName: string, worktreeName: string, withGitDir: boolean): string {
    const tmp = makeTmp()
    const main = path.join(tmp, "repo")
    mkdirSync(path.join(main, basePathName, worktreeName), { recursive: true })
    if (withGitDir) mkdirSync(path.join(main, ".git"))
    return main
  }

  test("finds main root above a worktree (.git is a directory)", () => {
    const main = makeRepo(".git-worktrees", "review-pr-1234", true)
    expect(existsSync(path.join(main, ".git"))).toBe(true)
    expect(findMainRepoRoot(path.join(main, ".git-worktrees", "review-pr-1234"), ".git-worktrees")).toBe(main)
  })

  test("returns undefined when no .git directory exists anywhere up the tree", () => {
    const main = makeRepo(".git-worktrees", "review-pr-1234", false)
    expect(existsSync(path.join(main, ".git"))).toBe(false)
    expect(findMainRepoRoot(path.join(main, ".git-worktrees", "review-pr-1234"), ".git-worktrees")).toBeUndefined()
  })

  test("custom basePath is honored", () => {
    const main = makeRepo(".wt-trees", "foo", true)
    expect(findMainRepoRoot(path.join(main, ".wt-trees", "foo"), ".wt-trees")).toBe(main)
  })

  test("worktree whose .git is a file (not dir) is not mistaken for main", () => {
    const tmp = makeTmp()
    const main = path.join(tmp, "repo")
    mkdirSync(path.join(main, ".git-worktrees", "review-pr-1234"), { recursive: true })
    writeFileSync(path.join(main, ".git"), "gitdir: ../.git-worktrees/review-pr-1234/.git\n")
    expect(findMainRepoRoot(path.join(main, ".git-worktrees", "review-pr-1234"), ".git-worktrees")).toBeUndefined()
  })
})
describe("shouldClean", () => {
  const dir = "/repo/.git-worktrees/review-pr-1"

  test("cleans when no other session remains for this directory", () => {
    expect(shouldClean([{ id: "a", directory: dir }], "a", dir)).toBe(true)
  })

  test("does not clean while another session is open in this directory", () => {
    expect(shouldClean([{ id: "a", directory: dir }, { id: "b", directory: dir }], "a", dir)).toBe(false)
  })

  test("ignores sessions belonging to other directories", () => {
    expect(shouldClean([{ id: "a", directory: dir }, { id: "b", directory: "/elsewhere" }], "a", dir)).toBe(true)
  })

  test("fails closed when the session list is unavailable", () => {
    expect(shouldClean(undefined, "a", dir)).toBe(false)
  })
})

describe("resolveScriptPath", () => {
  const repo = "/repo"
  const cacheDist = "/home/u/.cache/opencode/node_modules/sprig-worktree/dist"
  const only = (...present: string[]) => (p: string) => present.includes(p)

  test("prefers the repository's own copy", () => {
    const repoCopy = path.join(repo, ".opencode", "scripts", "wt")
    const bundled = path.join(cacheDist, "scripts", "wt")
    expect(resolveScriptPath(repo, cacheDist, only(repoCopy, bundled))).toBe(repoCopy)
  })

  test("finds the bundled script beside the plugin module in opencode's cache", () => {
    const bundled = path.join(cacheDist, "scripts", "wt")
    expect(resolveScriptPath(repo, cacheDist, only(bundled))).toBe(bundled)
  })

  test("finds the source script when running from a checkout", () => {
    const srcDir = "/checkout/.opencode/plugins"
    const source = path.join("/checkout", ".opencode", "scripts", "wt")
    expect(resolveScriptPath(repo, srcDir, only(source))).toBe(source)
  })

  test("falls back to the repository's node_modules", () => {
    const legacy = path.join(repo, "node_modules", "sprig-worktree", "dist", "scripts", "wt")
    expect(resolveScriptPath(repo, cacheDist, only(legacy))).toBe(legacy)
  })

  test("returns undefined when nothing is present", () => {
    expect(resolveScriptPath(repo, cacheDist, () => false)).toBeUndefined()
  })
})
