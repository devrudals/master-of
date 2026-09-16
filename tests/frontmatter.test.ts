import { describe, it, expect } from "bun:test";
import { parseSkillFrontmatter } from "../src/core/scanner.ts";

describe("Frontmatter description parsing", () => {
  it("keeps every line of a folded block scalar", () => {
    const content = `---
name: task-observer
description: >-
  Monitors task execution for skill improvement opportunities. Use this skill
  during ANY multi-step task, agentic workflow, or substantive work session.
  It captures patterns, user corrections and workflow insights.
---

# Body
`;
    const { name, description } = parseSkillFrontmatter(content, "fallback");
    expect(name).toBe("task-observer");
    expect(description).toContain("Monitors task execution");
    expect(description).toContain("during ANY multi-step task");
    expect(description).toContain("captures patterns, user corrections");
  });

  it("keeps a continuation line that itself contains a colon", () => {
    const content = `---
name: colon-skill
description: >
  Does a thing across sessions.
  IMPORTANT: this skill should be invoked at the start of every session.
allowed-tools: Read
---
`;
    const { description } = parseSkillFrontmatter(content, "fallback");
    expect(description).toContain("IMPORTANT: this skill should be invoked");
    expect(description).not.toContain("allowed-tools");
  });

  it("reads a quoted single-line description and stops at the next key", () => {
    const content = `---
name: quoted-skill
description: "Gate for design work, motion and UI polish."
allowed-tools: Read
---
`;
    const { description } = parseSkillFrontmatter(content, "fallback");
    expect(description).toBe("Gate for design work, motion and UI polish.");
  });

  it("joins a plain scalar wrapped across indented lines", () => {
    const content = `---
name: wrapped-skill
description: Starts here
  and continues here
  and ends here
---
`;
    const { description } = parseSkillFrontmatter(content, "fallback");
    expect(description).toBe("Starts here and continues here and ends here");
  });

  it("falls back to the first content line when frontmatter has no description", () => {
    const { name, description } = parseSkillFrontmatter("# Just A Heading\n\nbody\n", "dir-name");
    expect(name).toBe("dir-name");
    expect(description).toBe("Just A Heading");
  });
});

describe("Frontmatter edge cases from real plugins", () => {
  it("flattens a literal block scalar so the gate line stays single-line", () => {
    const content = `---
name: lit
description: |
  first line
  second line
---
`;
    const { description } = parseSkillFrontmatter(content, "fallback");
    expect(description).toBe("first line second line");
    expect(description).not.toContain("\n");
  });

  it("never falls back to a frontmatter line as the description", () => {
    const content = `---
name: nodesc
allowed-tools: Read
---

# Real Heading
`;
    const { description } = parseSkillFrontmatter(content, "fallback");
    expect(description).toBe("Real Heading");
  });
});
