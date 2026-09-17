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
    expect(existsSync(join(agyTargetDir, "master-of-design", "SKILL.md"))).toBe(true);
    expect(existsSync(join(agyTargetDir, "master-of-dev", "SKILL.md"))).toBe(true);
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
    expect(pending.map((c: any) => c.name)).toContain("parked-tool");
    // Loaded-by-Claude skills are never listed: their category changes nothing.
    expect(pending.map((c: any) => c.name)).not.toContain("animate");

    expect(run("classify", "parked-tool", "nope").status).toBe(1);
    const ok = run("classify", "parked-tool", "pipelines", "--cluster", "motion");
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("parked-tool → /pipelines (motion)");

    expect(run("sync").status).toBe(0);
    const after = JSON.parse(run("search", "parked-tool", "--json").stdout)[0];
    expect(after.category).toBe("pipelines");
    expect(after.cluster).toBe("motion");
    expect(after.classification).toBe("confirmed");
    expect(JSON.parse(run("unclassified", "--json").stdout).map((c: any) => c.name)).not.toContain("parked-tool");
  });

  it("reads a gate for a specific source", () => {
    const res = run("gate", "design", "--source", "gemini");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain(", gemini)");
    expect(run("gate", "design", "--source", "../claude").status).toBe(1);
  });
});

describe("Claude plugin install and session-start hook", () => {
  const root = PROJECT_ROOT;
  const binMo = join(root, "bin", "mo.ts");
  const sandbox = join(root, "sandbox");
  const dataDir = join(sandbox, "masterof-home-cli-setup");
  const pluginDir = join(sandbox, "masterof-home-cli-setup-plugin");
  const run = (...cmd: string[]) =>
    spawnSync("bun", ["run", binMo, ...cmd, "--data-dir", dataDir, "--sandbox", sandbox], { encoding: "utf8" });

  it("writes gate protocol files, a hook, and a mo-driven check-skills", () => {
    for (const d of [dataDir, pluginDir]) if (existsSync(d)) rmSync(d, { recursive: true, force: true });
    const protocol = join(root, "plugins", "master-of");
    const res = run("claude-setup", pluginDir, "--protocol-from", protocol);
    expect(res.status).toBe(0);
    const fs = require("fs");
    expect(fs.readFileSync(join(pluginDir, "skills", "dev", "SKILL.md"), "utf8")).toBe(fs.readFileSync(join(protocol, "skills", "dev", "SKILL.md"), "utf8"));
    const check = fs.readFileSync(join(pluginDir, "skills", "check-skills", "SKILL.md"), "utf8");
    expect(check).toContain("mo unclassified --source claude --json");
    // v2: check-skills uses the ~/.master-of/mo wrapper, not a hardcoded bin/mo.ts path
    expect(check).toContain("~/.master-of/mo");
    expect(check).not.toContain(binMo); // no hardcoded absolute paths in the skill text
    expect(check.length).toBeLessThan(6000); // v1 was 19KB
    expect(JSON.parse(fs.readFileSync(join(pluginDir, "hooks", "hooks.json"), "utf8")).hooks.SessionStart[0].hooks[0].command).toContain("session-start.sh");
    expect(fs.statSync(join(pluginDir, "hooks", "session-start.sh")).mode & 0o111).not.toBe(0);
    // claude-setup also writes the ~/.master-of/mo wrapper
    const wrapper = join(dataDir, "mo");
    expect(fs.existsSync(wrapper)).toBe(true);
    expect(fs.statSync(wrapper).mode & 0o111).not.toBe(0); // executable
    expect(fs.readFileSync(wrapper, "utf8")).toContain(binMo); // wrapper references the actual CLI
  });

  it("fails loudly when protocol files are missing", () => {
    const res = run("claude-setup", join(sandbox, "masterof-home-cli-setup-empty"), "--protocol-from", join(sandbox, "nowhere"));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Protocol files not found");
  });

  it("session-start speaks only when something changed", () => {
    if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
    const first = run("session-start");
    expect(first.status).toBe(0);
    const ctx = JSON.parse(first.stdout).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("category guess");
    expect(ctx.length).toBeLessThan(1500);

    const second = run("session-start");
    expect(second.status).toBe(0);
    expect(second.stdout.trim()).toBe("");

    expect(run("ignore", "parked-tool").status).toBe(0);
    // Count went 1 -> 0: a change, so the hook speaks once more (health only, no guesses left).
    const third = run("session-start");
    expect(third.stdout.trim()).toBe("");
    expect(JSON.parse(run("unclassified", "--source", "claude", "--json").stdout)).toEqual([]);
    expect(JSON.parse(run("unclassified", "--source", "gemini", "--json").stdout).length).toBeGreaterThan(0);
  });

  it("classify --desc sets the Korean one-liner shown in the gate", () => {
    expect(run("classify", "better-ui", "design", "--desc", "UI 한 줄 요약").status).toBe(0);
    const comp = JSON.parse(run("search", "better-ui", "--json").stdout)[0];
    expect(comp.description_ko).toBe("UI 한 줄 요약");
  });

  it("lists unparked skills via CLI and parks one into skills-library", () => {
    const unparked = JSON.parse(run("unparked", "--json").stdout);
    expect(Array.isArray(unparked)).toBe(true);
    expect(unparked.map((u: any) => u.name)).toContain("animate");

    const parkRes = run("park", "animate", "design");
    expect(parkRes.status).toBe(0);
    expect(parkRes.stdout).toContain("Parked 'animate' into skills-library/design/animate");

    // Unpark it back so sandbox state stays clean
    const unparkRes = run("unpark", "animate");
    expect(unparkRes.status).toBe(0);
  });
});

describe("Live-install safety", () => {
  const root = PROJECT_ROOT;
  const binMo = join(root, "bin", "mo.ts");
  const sandbox = join(root, "sandbox");

  it("refuses to write the real ~/.claude/masterof from a non-default data dir", () => {
    const scratch = join(sandbox, "masterof-home-guard");
    if (existsSync(scratch)) rmSync(scratch, { recursive: true, force: true });
    // No --sandbox, so claudeDir is the user's real ~/.claude.
    const res = spawnSync("bun", ["run", binMo, "claude-sync", "--data-dir", scratch], { encoding: "utf8" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Refusing to write");

    // An explicit destination is allowed.
    const dest = join(scratch, "explicit-dest");
    const ok = spawnSync("bun", ["run", binMo, "claude-sync", dest, "--data-dir", scratch], { encoding: "utf8" });
    expect(ok.status).toBe(0);
    expect(existsSync(join(dest, "gates", "design.txt"))).toBe(true);
  });

  it("claude-setup writes nothing when protocol files are missing", () => {
    const target = join(sandbox, "masterof-home-halfinstall");
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    const res = spawnSync("bun", ["run", binMo, "claude-setup", target, "--protocol-from", join(sandbox, "nowhere"), "--data-dir", join(sandbox, "masterof-home-halfinstall-data"), "--sandbox", sandbox], { encoding: "utf8" });
    expect(res.status).toBe(1);
    // No hook and no plugin.json may survive a refused install.
    expect(existsSync(join(target, "hooks", "session-start.sh"))).toBe(false);
    expect(existsSync(join(target, ".claude-plugin", "plugin.json"))).toBe(false);
  });
});
