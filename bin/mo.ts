#!/usr/bin/env bun
import { homedir } from "os";
import { spawnSync } from "child_process";
import { readFileSync, existsSync, readdirSync, chmodSync } from "fs";
import { resolve, join } from "path";
import { ConfigManager } from "../src/core/config.ts";
import { RegistryManager } from "../src/core/registry.ts";
import { SkillScanner, dedupeByName } from "../src/core/scanner.ts";
import { GateReporter } from "../src/core/reporter.ts";
import { HealthChecker } from "../src/core/health.ts";
import { AgyGateGenerator } from "../src/adapters/agy/generator.ts";
import { ClaudeBridge } from "../src/adapters/claude/bridge.ts";
import { ClaudePluginIndex } from "../src/adapters/claude/plugins.ts";
import { ClaudePluginInstaller, defaultClaudePluginDir } from "../src/adapters/claude/setup.ts";
import { ClaudeSkillParker, SyncedPacker } from "../src/adapters/claude/parking.ts";
import { readJsonSafe, writeAtomicSync } from "../src/core/fs-atomic.ts";
import { RuleGenerator } from "../src/adapters/rules/generator.ts";
import { UniversalMcpServer } from "../src/adapters/mcp/server.ts";
import { resolveGateFile } from "../src/core/gates.ts";
import { searchComponents } from "../src/core/search.ts";
import { componentId } from "../src/core/registry.ts";
import type { RegistryComponent } from "../src/core/types.ts";

const args = process.argv.slice(2);

// Parse flags
let dataDir: string | undefined;
let sandboxRoot: string | undefined;
let isJson = false;
let source: string | undefined;
let cluster: string | undefined;
let domain: string | undefined;
let desc: string | undefined;
let protocolFrom: string | undefined;

const cleanArgs: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--data-dir" && i + 1 < args.length) {
    dataDir = args[++i];
  } else if (a === "--sandbox" && i + 1 < args.length) {
    sandboxRoot = args[++i];
  } else if (a === "--json") {
    isJson = true;
  } else if (a === "--source" && i + 1 < args.length) {
    source = args[++i];
  } else if (a === "--cluster" && i + 1 < args.length) {
    cluster = args[++i];
  } else if (a === "--domain" && i + 1 < args.length) {
    domain = args[++i];
  } else if (a === "--desc" && i + 1 < args.length) {
    desc = args[++i];
  } else if (a === "--protocol-from" && i + 1 < args.length) {
    protocolFrom = args[++i];
  } else {
    cleanArgs.push(a);
  }
}

const config = new ConfigManager({ dataDir, sandboxRoot });
// A quarantine wipes every confirmed classification, so the hook must be able to say so.
const registryExistedBefore = existsSync(config.getPaths().registryFile);
const registryManager = new RegistryManager(config);
const registryWasQuarantined =
  registryExistedBefore && readdirSync(config.getPaths().masterOfHome).some((f) => f.startsWith("registry.json.corrupt-"));
const pluginIndex = new ClaudePluginIndex(config.getPaths().claudeDir);
const healthChecker = new HealthChecker(config, registryManager, pluginIndex);
const reporter = new GateReporter(config, registryManager, healthChecker);

/** `mo --data-dir /tmp/scratch claude-sync` must not overwrite the live gates
 * the real Claude install reads; only the default data dir owns them. */
function assertOwnsClaudeDir(explicitTarget?: string): void {
  if (explicitTarget) return;
  const paths = config.getPaths();
  const defaultHome = resolve(homedir(), ".master-of");
  if (paths.masterOfHome === defaultHome) return;
  if (!paths.claudeDir.startsWith(resolve(homedir(), ".claude"))) return;
  console.error(
    `Refusing to write ${join(paths.claudeDir, "masterof")} from data dir ${paths.masterOfHome}.\n` +
      `Those gate files belong to the default data dir (${defaultHome}). Pass an explicit target directory to write elsewhere.`
  );
  process.exit(1);
}

const command = cleanArgs[0] || "status";

switch (command) {
  case "status":
  case "check": {
    const { briefReport, tokenSavings } = reporter.renderAll();
    if (isJson) {
      console.log(JSON.stringify(tokenSavings, null, 2));
    } else {
      console.log(briefReport);
    }
    break;
  }

  case "full": {
    const isRaw = cleanArgs.includes("--raw") || cleanArgs.includes("--all") || args.includes("--raw");
    if (isRaw) {
      const { fullReport } = reporter.renderAll();
      console.log(fullReport);
    } else {
      const isEn = config.ensureConfigFile().report_language === "en";
      console.log(reporter.renderCompactInventory(isEn));
    }
    break;
  }

  case "gate": {
    const gateName = (cleanArgs[1] || "").trim().toLowerCase();
    if (!gateName) {
      console.error("Usage: mo gate <category>  (e.g., mo gate design)");
      process.exit(1);
    }
    const gatePath = resolveGateFile(config.getPaths().gatesDir, gateName, source);
    if (!gatePath) {
      console.error(`Gate '${gateName}' is not a valid gate name.`);
      process.exit(1);
    }
    if (!existsSync(gatePath)) {
      reporter.renderAll();
    }
    if (existsSync(gatePath)) {
      console.log(readFileSync(gatePath, "utf8"));
    } else {
      console.error(`Gate '${gateName}' not found.`);
      process.exit(1);
    }
    break;
  }

  case "search": {
    const query = cleanArgs.slice(1).join(" ");
    if (!query) {
      console.error("Usage: mo search <keyword>");
      process.exit(1);
    }
    const matches = searchComponents(registryManager.getRegistry(), query);

    if (isJson) {
      console.log(JSON.stringify(matches, null, 2));
    } else {
      console.log(`\nSearch results for '${query}': (${matches.length} found)\n`);
      for (const m of matches) {
        console.log(`- [${m.category}] ${m.name}: ${m.description_ko || m.description}`);
      }
      console.log("");
    }
    break;
  }

  case "doctor": {
    const issues = healthChecker.checkAll();
    if (isJson) {
      console.log(JSON.stringify(issues, null, 2));
    } else {
      console.log("\n# master-of Doctor Diagnostics\n");
      if (issues.length === 0) {
        console.log("✓ All checks passed. No broken dependencies or missing files found.\n");
      } else {
        for (const iss of issues) {
          console.log(`[${iss.severity.toUpperCase()}] ${iss.subject}: ${iss.detail}`);
          console.log(`  Fix: ${iss.fix}\n`);
        }
      }
    }
    break;
  }

  case "sync": {
    const scanner = new SkillScanner();
    const paths = config.getPaths();
    const fullPathOf = (c: RegistryComponent) => registryManager.resolveFullPath(c);
    const { unique: scanned, collisions } = dedupeByName(
      [
        ...(existsSync(paths.claudeDir) ? scanner.scanDirectory(paths.claudeDir, "claude") : [])
          // Leftover cache dirs from earlier plugin versions only shadow the live install.
          .filter((c) => !pluginIndex.isStaleCachePath(fullPathOf(c)))
          // Still-loaded components are always-on: kept in the registry for the
          // report, left out of gate files (a confirmed value is never overridden).
          .map((c) => ({ ...c, always_on: !pluginIndex.isDormant(c) })),
        ...(existsSync(paths.geminiDir) ? scanner.scanDirectory(paths.geminiDir, "gemini") : []),
      ],
      fullPathOf
    );
    const { added, updated } = registryManager.upsertScanned(scanned);
    const pruned = registryManager.pruneMissing(["claude", "gemini"]);

    const { tokenSavings } = reporter.renderAll();
    if (isJson) {
      console.log(JSON.stringify({ scanned: scanned.length, added, updated: updated.length, pruned, collisions, tokenSavings }, null, 2));
    } else {
      console.log(
        `✓ Synced ${scanned.length} components (${added.length} new, ${updated.length} refreshed, ${pruned.length} pruned). Token reduction: ${tokenSavings.pct}% saved.`
      );
      for (const c of collisions) {
        console.error(`! '${c.name}' found at ${1 + c.dropped.length} paths — kept ${c.kept}, ignored ${c.dropped.join(", ")}`);
      }
    }
    break;
  }

  case "classify": {
    const [, name, category] = cleanArgs;
    if (!name || !category) {
      console.error("Usage: mo classify <component-name> <category> [--cluster <name>] [--domain <gate>]");
      process.exit(1);
    }
    try {
      const language = config.ensureConfigFile().report_language;
      const comp = registryManager.classify(name, category, { cluster, domain, description: desc, language });
      if (!comp) {
        console.error(`Component '${name}' not found in the registry.`);
        process.exit(1);
      }
      reporter.renderAll();
      console.log(`✓ ${comp.name} → /${comp.category}${comp.cluster ? ` (${comp.cluster})` : ""}`);
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
    break;
  }

  case "ignore": {
    const name = cleanArgs[1];
    if (!name) {
      console.error("Usage: mo ignore <component-name>");
      process.exit(1);
    }
    if (!registryManager.ignore(name)) {
      console.error(`Component '${name}' not found in the registry.`);
      process.exit(1);
    }
    reporter.renderAll();
    console.log(`✓ '${name}' ignored — out of every gate and the unclassified list.`);
    break;
  }

  case "claude-setup": {
    const targetDir = cleanArgs[1] || defaultClaudePluginDir(config.getPaths().claudeDir);
    const protocolDir = protocolFrom || targetDir;
    const installer = new ClaudePluginInstaller(config);
    const { written, missingProtocol } = installer.install(targetDir, protocolDir);
    console.log(`✓ Wrote ${written.length} plugin files to ${targetDir}`);
    if (missingProtocol.length > 0) {
      console.error(`! Protocol files not found in ${protocolDir}: ${missingProtocol.join(", ")} — gates will not activate until they exist.`);
      process.exit(1);
    }
    break;
  }

  case "session-start": {
    // Runs from the Claude SessionStart hook: refresh everything, then speak
    // only if something changed since the last session. Silence costs nothing.
    const paths = config.getPaths();
    const scanner = new SkillScanner();
    const fullPathOf = (c: RegistryComponent) => registryManager.resolveFullPath(c);
    const { unique } = dedupeByName(
      [
        ...(existsSync(paths.claudeDir) ? scanner.scanDirectory(paths.claudeDir, "claude") : [])
          .filter((c) => !pluginIndex.isStaleCachePath(fullPathOf(c)))
          .map((c) => ({ ...c, always_on: !pluginIndex.isDormant(c) })),
        ...(existsSync(paths.geminiDir) ? scanner.scanDirectory(paths.geminiDir, "gemini") : []),
      ],
      fullPathOf
    );
    registryManager.upsertScanned(unique);
    registryManager.pruneMissing(["claude", "gemini"]);
    assertOwnsClaudeDir();
    new ClaudeBridge(config, registryManager, reporter).syncToClaude();

    // Ensure ~/.master-of/mo wrapper exists so skills can call mo directly
    const wrapperPath = resolve(paths.masterOfHome, "mo");
    if (!existsSync(wrapperPath)) {
      const scriptPath = resolve(process.argv[1]);
      const execLine = scriptPath.endsWith(".ts")
        ? `exec bun run "${scriptPath}" --data-dir "${paths.masterOfHome}" "$@"`
        : `exec node "${scriptPath}" --data-dir "${paths.masterOfHome}" "$@"`;
      const wrapperContent = `#!/bin/sh\n# ~/.master-of/mo — generated automatically\n${execLine}\n`;
      writeAtomicSync(wrapperPath, wrapperContent);
      chmodSync(wrapperPath, 0o755);
    }

    const issues = healthChecker.checkAll();
    const pending = registryManager.unclassified().filter((c) => (c.source ?? "claude") === "claude");
    const parker = new ClaudeSkillParker(config, registryManager);
    const unparked = parker.listUnparked();
    const stateFile = resolve(paths.masterOfHome, "state.json");
    const prev = readJsonSafe<{ issue_keys?: string[]; pending_names?: string[]; unparked_names?: string[] }>(stateFile, {});
    const issueKeys = issues.map((i) => `${i.kind}:${i.subject}`).sort();
    // Keyed on the actual names, not a count: classifying one component while
    // another is discovered leaves the count equal but the work is not the same.
    const pendingNames = pending.map((c) => componentId(c)).sort();
    const unparkedNames = unparked.map((u) => u.name).sort();
    const same = (a: string[], b: string[] | undefined) => JSON.stringify(a) === JSON.stringify(b ?? null);
    const unparkedChanged = !same(unparkedNames, prev.unparked_names);
    const changed = !same(pendingNames, prev.pending_names) || !same(issueKeys, prev.issue_keys) || unparkedChanged;

    const lines: string[] = [];
    if (registryWasQuarantined) {
      lines.push(
        `master-of: registry.json was unreadable and was moved aside, so every confirmed classification is gone and ${pendingNames.length} component(s) fell back to the scanner's guess. Tell the user this happened and that ${paths.masterOfHome} holds a registry.json.corrupt-* they may want to restore from.`
      );
    }
    if (issues.length > 0) {
      lines.push(`master-of: ${issues.length} health issue(s) — say so in one line; 'check-skills' has the fixes.`);
      for (const i of issues.slice(0, 5)) lines.push(`- [${i.severity}] ${i.subject}: ${i.fix}`);
      if (issues.length > 5) lines.push(`- … +${issues.length - 5} more`);
    }
    if (unparked.length > 0 && unparkedChanged) {
      lines.push(
        `master-of: ${unparked.length} raw skill(s) in ~/.claude/skills/ are always-on (wasting ~${Math.round(unparked.length * 104)} tokens every session). Run 'mo park --all' (or 'mo park <name>') to park them in skills-library and make them dormant.`
      );
    }
    if (pending.length > 0) {
      lines.push(
        `master-of: ${pending.length} Claude component(s) still carry the scanner's category guess (they are gated under that guess meanwhile). Do NOT classify now; mention it in one line and offer 'check-skills' when the user has time.`
      );
    }
    // Record only after deciding, so a crash mid-run does not mark work as seen.
    writeAtomicSync(
      stateFile,
      JSON.stringify({ issue_keys: issueKeys, pending_names: pendingNames, unparked_names: unparkedNames, at: new Date().toISOString() }, null, 2)
    );

    if (args.includes("--agy")) {
      const hasUnparked = unparked.length > 0;
      if (lines.length > 0 || hasUnparked) {
        const msg = [
          `[master-of Token Gatekeeper]`,
          ...lines,
          hasUnparked ? `현재 ${unparked.length}개의 낱개 스킬이 Always-on 상태로 30,000+ 토큰을 낭비하고 있습니다. 사용자에게 'check-skill'을 실행하거나 'mo park --all'로 도메인 게이트에 주차할지 적극적으로 제안하세요.` : ""
        ].filter(Boolean).join("\n");
        console.log(JSON.stringify({
          injectSteps: [
            { ephemeralMessage: msg }
          ]
        }));
      } else {
        console.log(JSON.stringify({ injectSteps: [] }));
      }
      break;
    }

    if (!changed && !registryWasQuarantined) break;
    if (lines.length === 0) break;
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") } }));
    break;
  }

  case "unclassified": {
    const pending = registryManager.unclassified().filter((c) => !source || (c.source ?? "claude") === source);
    if (isJson) {
      console.log(JSON.stringify(pending, null, 2));
    } else if (pending.length === 0) {
      console.log("✓ Every component has a confirmed category.");
    } else {
      console.log(`\n${pending.length} component(s) still carry the scanner's guess — confirm with: mo classify <name> <category>\n`);
      for (const c of pending) {
        const typePrefix = c.type === "skill" ? "" : `[${c.type}] `;
        console.log(`- ${typePrefix}${c.name}  (guess: ${c.category}, ${c.source ?? "claude"})\n    ${c.description.slice(0, 120)}`);
      }
      console.log("");
    }
    break;
  }

  case "remove": {
    const name = cleanArgs[1];
    if (!name) {
      console.error("Usage: mo remove <component-name>");
      process.exit(1);
    }
    if (registryManager.removeComponent(name)) {
      reporter.renderAll();
      console.log(`✓ Removed '${name}' from the registry.`);
    } else {
      console.error(`Component '${name}' not found in the registry.`);
      process.exit(1);
    }
    break;
  }

  case "agy-setup": {
    const targetDir = cleanArgs[1] || resolve(config.getPaths().geminiDir, "config", "skills");
    const gen = new AgyGateGenerator(config, registryManager, reporter);
    const created = gen.generateAgyGates(targetDir);
    console.log(`✓ Generated ${created.length} AGY gate skills in: ${targetDir}`);
    break;
  }

  case "claude-sync": {
    const targetDir = cleanArgs[1];
    assertOwnsClaudeDir(targetDir);
    const bridge = new ClaudeBridge(config, registryManager, reporter);
    const { syncedFiles } = bridge.syncToClaude(targetDir);
    console.log(`✓ Synced ${syncedFiles.length} gate & report files to Claude masterof directory.`);
    break;
  }

  case "unparked": {
    const parker = new ClaudeSkillParker(config, registryManager);
    const list = parker.listUnparked();
    if (isJson) {
      console.log(JSON.stringify(list, null, 2));
    } else if (list.length === 0) {
      console.log("✓ No unparked raw skills in ~/.claude/skills/. All skills are dormant in skills-library.");
    } else {
      console.log(`\n${list.length} raw skill(s) currently always-on in ~/.claude/skills/:\n`);
      for (const item of list) {
        console.log(`- ${item.name} (suggested gate: /${item.category})`);
      }
      console.log(`\nRun 'mo park --all' to move all to skills-library and save tokens.\n`);
    }
    break;
  }

  case "park": {
    const target = cleanArgs[1];
    const targetCat = cleanArgs[2];
    if (!target) {
      console.error("Usage: mo park <skill-name> [category]  OR  mo park --all");
      process.exit(1);
    }
    assertOwnsClaudeDir();
    const parker = new ClaudeSkillParker(config, registryManager);
    if (target === "--all") {
      const results = parker.parkAll();
      console.log(`✓ Parked ${results.length} skills into skills-library.`);
    } else if (existsSync(join(config.getPaths().claudeDir, "skills", target))) {
      const res = parker.parkSkill(target, targetCat);
      console.log(`✓ Parked '${res.name}' into skills-library/${res.category}/${res.name}`);
    } else if (existsSync(join(config.getPaths().claudeDir, "agents", `${target}.md`))) {
      const res = parker.parkComponentFile(target, "agents", targetCat);
      console.log(`✓ Parked agent '${res.name}' into skills-library/${res.category}/agents/${res.name}.md`);
    } else if (existsSync(join(config.getPaths().claudeDir, "commands", `${target}.md`))) {
      const res = parker.parkComponentFile(target, "commands", targetCat);
      console.log(`✓ Parked command '${res.name}' into skills-library/${res.category}/commands/${res.name}.md`);
    } else {
      const res = parker.parkSkill(target, targetCat); // let this throw its own "not found" error
      console.log(`✓ Parked '${res.name}' into skills-library/${res.category}/${res.name}`);
    }
    // Re-sync after parking so registry and gates reflect the new dormant state
    const scanner = new SkillScanner();
    const paths = config.getPaths();
    const fullPathOf = (c: RegistryComponent) => registryManager.resolveFullPath(c);
    const { unique: scanned } = dedupeByName(
      [
        ...(existsSync(paths.claudeDir) ? scanner.scanDirectory(paths.claudeDir, "claude") : [])
          .filter((c) => !pluginIndex.isStaleCachePath(fullPathOf(c)))
          .map((c) => ({ ...c, always_on: !pluginIndex.isDormant(c) })),
        ...(existsSync(paths.geminiDir) ? scanner.scanDirectory(paths.geminiDir, "gemini") : []),
      ],
      fullPathOf
    );
    registryManager.upsertScanned(scanned);
    registryManager.pruneMissing(["claude", "gemini"]);
    if (existsSync(paths.claudeDir)) {
      new ClaudeBridge(config, registryManager, reporter).syncToClaude();
    }
    const { tokenSavings } = reporter.renderAll();
    console.log(`✓ Gates refreshed. Token reduction: ${tokenSavings.pct}% saved (${tokenSavings.before - tokenSavings.after} tok saved).`);
    break;
  }

  case "unpark": {
    const target = cleanArgs[1];
    if (!target) {
      console.error("Usage: mo unpark <skill-name>");
      process.exit(1);
    }
    assertOwnsClaudeDir();
    const parker = new ClaudeSkillParker(config, registryManager);
    let unparkMsg: string;
    try {
      const res = parker.unparkSkill(target);
      unparkMsg = `✓ Unparked '${res.name}' back to ~/.claude/skills/${res.name}`;
    } catch {
      try {
        const res = parker.unparkComponentFile(target, "agents");
        unparkMsg = `✓ Unparked agent '${res.name}' back to ~/.claude/agents/${res.name}.md`;
      } catch {
        const res = parker.unparkComponentFile(target, "commands");
        unparkMsg = `✓ Unparked command '${res.name}' back to ~/.claude/commands/${res.name}.md`;
      }
    }
    console.log(unparkMsg);
    // Re-sync
    const scanner = new SkillScanner();
    const paths = config.getPaths();
    const fullPathOf = (c: RegistryComponent) => registryManager.resolveFullPath(c);
    const { unique: scanned } = dedupeByName(
      [
        ...(existsSync(paths.claudeDir) ? scanner.scanDirectory(paths.claudeDir, "claude") : [])
          .filter((c) => !pluginIndex.isStaleCachePath(fullPathOf(c)))
          .map((c) => ({ ...c, always_on: !pluginIndex.isDormant(c) })),
        ...(existsSync(paths.geminiDir) ? scanner.scanDirectory(paths.geminiDir, "gemini") : []),
      ],
      fullPathOf
    );
    registryManager.upsertScanned(scanned);
    registryManager.pruneMissing(["claude", "gemini"]);
    if (existsSync(paths.claudeDir)) {
      new ClaudeBridge(config, registryManager, reporter).syncToClaude();
    }
    const { tokenSavings } = reporter.renderAll();
    console.log(`✓ Gates refreshed. Token reduction: ${tokenSavings.pct}% saved.`);
    break;
  }

  case "cowork": {
    // Account-synced Cowork packs (plugins/synced/*, skills/synced/*) have no
    // marketplace entry, but `claude plugin` still recognizes them under a
    // "<domain>@synced" id and can enable/disable them like any other plugin.
    // That toggle lives in settings.json and survives the harness re-syncing
    // the underlying files back onto disk — unlike moving the files ourselves,
    // which loses that race (confirmed: the harness re-created a parked
    // folder within the same session). So this drives the real switch instead
    // of hiding files.
    const sub = cleanArgs[1];
    const syncedPacker = new SyncedPacker(config);
    const domains = [...new Set(syncedPacker.list().map((e) => e.domain))].sort();

    if (sub === "list" || !sub) {
      if (domains.length === 0) {
        console.log("No account-synced Cowork packs currently present.");
      } else {
        console.log(`${domains.length} synced pack(s): ${domains.join(", ")}`);
        console.log("Usage: mo cowork on|off [domain]  (omit domain for all)");
      }
      break;
    }

    if (sub !== "on" && sub !== "off") {
      console.error("Usage: mo cowork [list | on [domain] | off [domain]]");
      process.exit(1);
    }

    const target = cleanArgs[2];
    const targets = target ? [target] : domains;
    if (target && !domains.includes(target)) {
      console.error(`'${target}' is not a currently-present synced pack. Known: ${domains.join(", ") || "(none)"}`);
      process.exit(1);
    }

    const action = sub === "on" ? "enable" : "disable";
    for (const d of targets) {
      const result = spawnSync("claude", ["plugin", action, `${d}@synced`], { encoding: "utf-8" });
      const line = (result.stdout || result.stderr || "").trim().split("\n")[0];
      console.log(line || `${d}@synced: ${action} (no output)`);
    }

    // Re-sync so registry/gates reflect the new enabled/disabled state. The
    // top-level `pluginIndex` was built from settings.json at process start,
    // before the `claude plugin` calls above just rewrote it — read it fresh
    // or the rescan below re-applies the stale enabled/disabled state.
    const freshPluginIndex = new ClaudePluginIndex(config.getPaths().claudeDir);
    const scanner = new SkillScanner();
    const paths = config.getPaths();
    const fullPathOf = (c: RegistryComponent) => registryManager.resolveFullPath(c);
    const { unique: scanned } = dedupeByName(
      [
        ...(existsSync(paths.claudeDir) ? scanner.scanDirectory(paths.claudeDir, "claude") : [])
          .filter((c) => !freshPluginIndex.isStaleCachePath(fullPathOf(c)))
          .map((c) => ({ ...c, always_on: !freshPluginIndex.isDormant(c) })),
        ...(existsSync(paths.geminiDir) ? scanner.scanDirectory(paths.geminiDir, "gemini") : []),
      ],
      fullPathOf
    );
    registryManager.upsertScanned(scanned);
    registryManager.pruneMissing(["claude", "gemini"]);
    if (existsSync(paths.claudeDir)) {
      new ClaudeBridge(config, registryManager, reporter).syncToClaude();
    }
    const { tokenSavings } = reporter.renderAll();
    console.log(`✓ Gates refreshed. Token reduction: ${tokenSavings.pct}% saved (${tokenSavings.before - tokenSavings.after} tok saved).`);
    break;
  }

  case "init-agents": {
    const ruleGen = new RuleGenerator(config, registryManager);
    const agentsMd = ruleGen.generateAgentsMd();
    console.log(agentsMd);
    break;
  }

  case "mcp-snippet": {
    const ruleGen = new RuleGenerator(config, registryManager);
    console.log(ruleGen.generateMcpSnippet());
    break;
  }

  case "mcp": {
    const mcpServer = new UniversalMcpServer(config, registryManager, healthChecker);
    mcpServer.startStdio();
    break;
  }

  case "help":
  case "--help":
  default: {
    const isUnknown = command !== "help" && command !== "--help";
    if (isUnknown) console.error(`Unknown command: ${command}\n`);
    (isUnknown ? console.error : console.log)(`
master-of (v2.0.0) — Universal AI Skill & Context Gateway

Usage:
  mo [command] [options]

Commands:
  status, check     Show brief gate status, broken dependencies & token savings
  full [--raw]      Show skill inventory (safe compact summary by default; --raw for full text)
  gate <domain>     Print pre-rendered gate index (e.g. mo gate design --source gemini)
  search <query>    Search across all indexed skills
  doctor            Run diagnostic health checks
  sync              Scan Claude/AGY skills, prune gone files, regenerate gates
  classify <name> <category>  Confirm a component's gate (--desc "<one-liner>", --cluster, --domain)
  ignore <name>     Keep a component out of every gate and the unclassified list
  claude-setup [dir]  Write the Claude Code plugin (gate skills + hook driven by mo)
  session-start     Hook entry: rescan, re-render, report only what changed
  unclassified      List components still carrying the scanner's category guess (--source filters)
  remove <name>     Remove one component from the registry
  agy-setup [dir]   Generate AGY gate skills (master-of-design, master-of-dev, etc.)
  claude-sync [dir] Sync gate & report files to Claude masterof directory
  unparked          List raw skills currently always-on in ~/.claude/skills
  park <name> [cat] Park a raw skill into skills-library (or mo park --all)
  unpark <name>     Move a parked skill back to ~/.claude/skills
  cowork [list|on|off] [domain]  Toggle account-synced Cowork packs (figma, design, …) via claude plugin enable/disable
  init-agents       Output AGENTS.md / Cursor rules template
  mcp-snippet       Output JSON config for Cursor, Windsurf, Claude Desktop
  mcp               Start Model Context Protocol (MCP) Stdio server

Options:
  --data-dir <dir>  Use custom master-of data directory
  --sandbox <dir>   Enforce sandbox boundary
  --source <name>   Gate view to read: claude (default) or gemini
  --json            Output in JSON format
`);
    if (isUnknown) process.exit(1);
    break;
  }
}
