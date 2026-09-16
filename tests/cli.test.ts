import { describe, it, expect } from "bun:test";
import { resolve, join } from "path";
import { spawnSync } from "child_process";
import { existsSync, rmSync } from "fs";
import { PROJECT_ROOT } from "./helpers.ts";

describe("CLI (bin/mo.ts) End-to-End Tests", () => {
  const root = PROJECT_ROOT;
  const binMo = join(root, "bin", "mo.ts");
  const sandbox = join(root, "sandbox");
  const cliDataDir = join(sandbox, "masterof-home-cli");
  const agyTargetDir = join(sandbox, "mock-gemini-gates");

  it("executes mo sync, status, gate, search, and agy-setup in sandbox", () => {
    if (existsSync(cliDataDir)) rmSync(cliDataDir, { recursive: true, force: true });
    if (existsSync(agyTargetDir)) rmSync(agyTargetDir, { recursive: true, force: true });

    // 1. Run mo sync
    const syncRes = spawnSync("bun", [
      "run", binMo, "sync",
      "--data-dir", cliDataDir,
      "--sandbox", sandbox,
    ], { encoding: "utf8" });
    expect(syncRes.status).toBe(0);

    // 2. Run mo status
    const statusRes = spawnSync("bun", [
      "run", binMo, "status",
      "--data-dir", cliDataDir,
      "--sandbox", sandbox,
    ], { encoding: "utf8" });
    expect(statusRes.status).toBe(0);
    expect(statusRes.stdout).toContain("master-of 현황 (요약)");
    expect(statusRes.stdout).toContain("게이트별 구성요소 수");

    // 3. Run mo gate design
    const gateRes = spawnSync("bun", [
      "run", binMo, "gate", "design",
      "--data-dir", cliDataDir,
      "--sandbox", sandbox,
    ], { encoding: "utf8" });
    expect(gateRes.status).toBe(0);
    // ~/.claude/skills/* is loaded by Claude itself, so it is always-on and not gated.
    expect(gateRes.stdout).not.toContain("animate |");
    const alwaysRes = spawnSync("bun", ["run", binMo, "gate", "always_on", "--data-dir", cliDataDir, "--sandbox", sandbox], { encoding: "utf8" });
    expect(alwaysRes.stdout).toContain("animate |");

    // 4. Run mo search
    const searchRes = spawnSync("bun", [
      "run", binMo, "search", "모션",
      "--data-dir", cliDataDir,
      "--sandbox", sandbox,
    ], { encoding: "utf8" });
    expect(searchRes.status).toBe(0);
    expect(searchRes.stdout).toContain("animate");

    // 5. Run mo doctor
    const doctorRes = spawnSync("bun", [
      "run", binMo, "doctor",
      "--data-dir", cliDataDir,
      "--sandbox", sandbox,
    ], { encoding: "utf8" });
    expect(doctorRes.status).toBe(0);
    expect(doctorRes.stdout).toContain("master-of Doctor Diagnostics");

    // 6. Run mo agy-setup
    const agyRes = spawnSync("bun", [
      "run", binMo, "agy-setup", agyTargetDir,
      "--data-dir", cliDataDir,
      "--sandbox", sandbox,
    ], { encoding: "utf8" });
    expect(agyRes.status).toBe(0);
    expect(existsSync(join(agyTargetDir, "gate-design", "SKILL.md"))).toBe(true);
    expect(existsSync(join(agyTargetDir, "gate-dev", "SKILL.md"))).toBe(true);
    expect(existsSync(join(agyTargetDir, "master-of-check", "SKILL.md"))).toBe(true);
  });
});

describe("CLI exit codes and JSON output", () => {
  const root = PROJECT_ROOT;
  const binMo = join(root, "bin", "mo.ts");
  const sandbox = join(root, "sandbox");
  const dataDir = join(sandbox, "masterof-home-cli-exit");
  const run = (...cmd: string[]) =>
    spawnSync("bun", ["run", binMo, ...cmd, "--data-dir", dataDir, "--sandbox", sandbox], { encoding: "utf8" });

  it("exits non-zero for an unknown command and prints help to stderr", () => {
    const res = run("frobnicate");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown command: frobnicate");
    expect(res.stdout).toBe("");
  });

  it("exits zero for help", () => {
    expect(run("help").status).toBe(0);
  });

  it("exits non-zero for a traversal gate name and for a missing gate", () => {
    if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
    expect(run("gate", "../../etc/passwd").status).toBe(1);
    expect(run("gate", "no-such-gate").status).toBe(1);
  });

  it("removes a component and reports it via --json sync", () => {
    if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
    const sync = run("sync", "--json");
    expect(sync.status).toBe(0);
    const summary = JSON.parse(sync.stdout);
    expect(summary.added).toContain("animate");
    expect(summary.pruned).toEqual([]);

    expect(run("remove", "animate").status).toBe(0);
    expect(run("remove", "animate").status).toBe(1);
    expect(run("search", "animate", "--json").stdout.trim()).toBe("[]");
  });
});

describe("Classification workflow", () => {
  const root = PROJECT_ROOT;
  const binMo = join(root, "bin", "mo.ts");
  const sandbox = join(root, "sandbox");
  const dataDir = join(sandbox, "masterof-home-cli-classify");
  const run = (...cmd: string[]) =>
    spawnSync("bun", ["run", binMo, ...cmd, "--data-dir", dataDir, "--sandbox", sandbox], { encoding: "utf8" });

  it("lists scanner guesses, confirms one, and keeps it across a resync", () => {
    if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
    expect(run("sync").status).toBe(0);

    const pending = JSON.parse(run("unclassified", "--json").stdout);
    expect(pending.map((c: any) => c.name)).toContain("animate");

    expect(run("classify", "animate", "nope").status).toBe(1);
    const ok = run("classify", "animate", "pipelines", "--cluster", "motion");
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("animate → /pipelines (motion)");

    expect(run("sync").status).toBe(0);
    const after = JSON.parse(run("search", "animate", "--json").stdout)[0];
    expect(after.category).toBe("pipelines");
    expect(after.cluster).toBe("motion");
    expect(after.classification).toBe("confirmed");
    expect(JSON.parse(run("unclassified", "--json").stdout).map((c: any) => c.name)).not.toContain("animate");
  });

  it("reads a gate for a specific source", () => {
    const res = run("gate", "design", "--source", "gemini");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain(", gemini)");
    expect(run("gate", "design", "--source", "../claude").status).toBe(1);
  });
});
