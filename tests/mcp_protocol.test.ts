import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { existsSync, rmSync } from "fs";
import { ConfigManager } from "../src/core/config.ts";
import { RegistryManager } from "../src/core/registry.ts";
import { GateReporter } from "../src/core/reporter.ts";
import { HealthChecker } from "../src/core/health.ts";
import { UniversalMcpServer } from "../src/adapters/mcp/server.ts";
import { SANDBOX } from "./helpers.ts";

describe("MCP JSON-RPC line handling", () => {
  const testDataDir = join(SANDBOX, "masterof-home-rpc");
  let written: string[] = [];
  let restoreStdout: () => void;

  const makeServer = () => {
    const config = new ConfigManager({ dataDir: testDataDir, sandboxRoot: SANDBOX });
    const registry = new RegistryManager(config);
    registry.addComponent({
      name: "test-ui-skill",
      type: "skill",
      category: "design",
      description: "Test UI Design Skill",
      path_anchor: "sandbox",
      rel_path: "mock-claude/skills/better-ui/SKILL.md",
    });
    new GateReporter(config, registry).renderAll();
    return new UniversalMcpServer(config, registry, new HealthChecker(config, registry));
  };

  const sent = () => written.map((line) => JSON.parse(line));

  beforeEach(() => {
    if (existsSync(testDataDir)) rmSync(testDataDir, { recursive: true, force: true });
    written = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: any) => {
      written.push(String(chunk).trim());
      return true;
    }) as typeof process.stdout.write;
    restoreStdout = () => {
      process.stdout.write = original;
    };
  });

  afterEach(() => restoreStdout());

  it("answers initialize with protocol version and server info", () => {
    makeServer().handleLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }));

    const [response] = sent();
    expect(response.id).toBe(1);
    expect(response.result.serverInfo.name).toBe("master-of");
    expect(response.result.protocolVersion).toBe("2024-11-05");
  });

  it("lists every advertised tool", () => {
    makeServer().handleLine(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }));

    const names = sent()[0].result.tools.map((t: any) => t.name);
    expect(names).toEqual(["mo_list_gates", "mo_open_gate", "mo_search", "mo_get_skill", "mo_health_check"]);
  });

  it("routes tools/call through to the tool result", () => {
    makeServer().handleLine(
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "mo_search", arguments: { query: "UI" } } })
    );

    const matches = JSON.parse(sent()[0].result.content[0].text);
    expect(matches[0].name).toBe("test-ui-skill");
  });

  it("runs mo_health_check through the protocol", () => {
    makeServer().handleLine(
      JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "mo_health_check", arguments: {} } })
    );

    expect(() => JSON.parse(sent()[0].result.content[0].text)).not.toThrow();
  });

  it("returns method-not-found for an unknown method", () => {
    makeServer().handleLine(JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/destroy" }));

    expect(sent()[0].error.code).toBe(-32601);
  });

  it("stays silent on notifications, wrong protocol versions and malformed JSON", () => {
    const server = makeServer();
    server.handleLine(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    server.handleLine(JSON.stringify({ jsonrpc: "1.0", id: 9, method: "initialize" }));
    server.handleLine("{ not json at all");

    expect(written).toEqual([]);
  });

  it("reports an unknown tool name as a tool error, not a crash", () => {
    const result = makeServer().executeTool("mo_nonexistent", {});
    expect(result.isError).toBe(true);
  });
});

describe("MCP never leaves a request unanswered", () => {
  const testDataDir = join(SANDBOX, "masterof-home-rpc-errors");
  let written: string[] = [];
  let restoreStdout: () => void;

  beforeEach(() => {
    if (existsSync(testDataDir)) rmSync(testDataDir, { recursive: true, force: true });
    written = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: any) => {
      written.push(String(chunk).trim());
      return true;
    }) as typeof process.stdout.write;
    restoreStdout = () => {
      process.stdout.write = original;
    };
  });

  afterEach(() => restoreStdout());

  it("turns a tool that throws into an isError result, not a hang", () => {
    const config = new ConfigManager({ dataDir: testDataDir, sandboxRoot: SANDBOX });
    const registry = new RegistryManager(config);
    // rel_path points at a directory, so readFileSync throws EISDIR.
    registry.addComponent({
      name: "dir-skill",
      type: "skill",
      category: "dev",
      description: "points at a directory",
      path_anchor: "sandbox",
      rel_path: "mock-claude/skills",
    });
    const server = new UniversalMcpServer(config, registry);

    server.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: "mo_get_skill", arguments: { skill_name: "dir-skill" } } }));

    const [response] = written.map((l) => JSON.parse(l));
    expect(response.id).toBe(42);
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toContain("failed");
  });

  it("rejects a non-string argument as a tool error instead of crashing", () => {
    const config = new ConfigManager({ dataDir: testDataDir, sandboxRoot: SANDBOX });
    const server = new UniversalMcpServer(config, new RegistryManager(config));

    server.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 43, method: "tools/call", params: { name: "mo_open_gate", arguments: { gate: 123 } } }));

    const [response] = written.map((l) => JSON.parse(l));
    expect(response.id).toBe(43);
    expect(response.result.isError).toBe(true);
  });

  it("answers from a registry rewritten after the server started", () => {
    const config = new ConfigManager({ dataDir: testDataDir, sandboxRoot: SANDBOX });
    const server = new UniversalMcpServer(config, new RegistryManager(config));
    expect(JSON.parse(server.executeTool("mo_search", { query: "late" }).content[0].text)).toEqual([]);

    const other = new RegistryManager(config);
    other.addComponent({ name: "late-arrival", type: "skill", category: "dev", description: "late", path_anchor: "sandbox", rel_path: "x/SKILL.md" });
    const later = new Date(Date.now() + 2000);
    require("fs").utimesSync(config.getPaths().registryFile, later, later);

    const hits = JSON.parse(server.executeTool("mo_search", { query: "late" }).content[0].text);
    expect(hits.map((h: any) => h.name)).toEqual(["late-arrival"]);
  });
});
