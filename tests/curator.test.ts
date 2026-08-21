import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CURATOR_ACTION_TYPES,
  applyCuratorPlan,
  curatorPrompt,
  parseCuratorPlan,
  resolveCuratorPlan,
  reviewSkills,
  skillSlugOf
} from "../src/curator.js";
import type { Capability } from "../src/domain.js";

function skill(name: string, slug = name.toLowerCase()): Capability {
  return {
    ref: `registry:${slug}/SKILL.md`,
    registryId: "registry",
    path: `${slug}/SKILL.md`,
    name,
    kind: "skill"
  };
}

const NOW = "2026-08-02T00:00:00.000Z";

describe("skill review", () => {
  it("calls a skill unused only when nothing selects it and nothing has reached for it", () => {
    const reviews = reviewSkills({
      capabilities: [skill("Brand voice"), skill("Invoices"), skill("Legacy"), {
        ref: "registry:tools/fetch.ts",
        registryId: "registry",
        path: "tools/fetch.ts",
        name: "fetch",
        kind: "tool"
      }],
      usage: [
        { capabilityRef: "registry:invoices/SKILL.md", useCount: 4, lastUsedAt: "2026-07-30T00:00:00.000Z" },
        { capabilityRef: "registry:legacy/SKILL.md", useCount: 9, lastUsedAt: "2026-01-01T00:00:00.000Z" }
      ],
      selectedRefs: ["registry:brand voice/SKILL.md"],
      now: NOW
    });

    // Tools are not curated, only skills.
    expect(reviews.map(({ capability }) => capability.name)).toEqual([
      "Brand voice",
      "Invoices",
      "Legacy"
    ]);
    // Selected but never run: still in use. Run recently: in use. Heavily used long ago: not.
    expect(reviews.map(({ state }) => state)).toEqual(["active", "active", "unused"]);
    expect(reviews[2]).toMatchObject({ useCount: 9, selected: false });
  });
});

describe("curator proposals", () => {
  it("takes JSON out of a fenced or chatty answer and drops actions missing a field", () => {
    const plan = parseCuratorPlan(
      'Sure!\n```json\n{"summary":"Folded two.","actions":[' +
        '{"type":"merge_skills","name":"Writing","description":"d","body":"b","absorbs":["Blogs","Writing"]},' +
        '{"type":"merge_skills","name":"Nothing","description":"d","body":"b","absorbs":[]},' +
        '{"type":"archive_skill","name":"Legacy","reason":"unused"},' +
        '{"type":"delete_everything","name":"Legacy"}]}\n```'
    );

    expect(plan.summary).toBe("Folded two.");
    // The umbrella cannot absorb itself, the empty merge is dropped, the unknown type is dropped.
    expect(plan.actions).toEqual([
      { type: "merge_skills", name: "Writing", description: "d", body: "b", absorbs: ["Blogs"] },
      { type: "archive_skill", name: "Legacy", reason: "unused" }
    ]);
  });

  it("treats an answer with no JSON as prose that proposes nothing", () => {
    expect(parseCuratorPlan("The skills look tidy to me.")).toEqual({
      summary: "The skills look tidy to me.",
      actions: []
    });
  });

  it("refuses to apply an action naming a skill that is not there", async () => {
    const capabilities = [skill("Blogs"), skill("Legacy")];
    const resolved = resolveCuratorPlan(
      [
        { type: "merge_skills", name: "Writing", description: "d", body: "b", absorbs: ["Blogs"] },
        { type: "merge_skills", name: "Other", description: "d", body: "b", absorbs: ["Ghost"] },
        { type: "archive_skill", name: "Legacy", reason: "unused" }
      ],
      capabilities
    );
    expect(resolved.map(({ error }) => error)).toEqual([
      undefined,
      'No skill called "Ghost"',
      undefined
    ]);

    const written: string[] = [];
    const archived: string[] = [];
    const result = await applyCuratorPlan(resolved, {
      saveSkill: async (name) => {
        written.push(name);
      },
      archiveSkill: async (slug) => {
        archived.push(slug);
      }
    });

    expect(result).toEqual({ applied: 2, errors: [] });
    // The unresolvable merge wrote nothing, and no absorbed skill was archived for it.
    expect(written).toEqual(["Writing"]);
    expect(archived).toEqual(["blogs", "legacy"]);
  });

  it("keeps the old skills when writing the merged one fails", async () => {
    const resolved = resolveCuratorPlan(
      [{ type: "merge_skills", name: "Writing", description: "d", body: "b", absorbs: ["Blogs"] }],
      [skill("Blogs")]
    );
    const archived: string[] = [];
    const result = await applyCuratorPlan(resolved, {
      saveSkill: async () => {
        throw new Error("disk full");
      },
      archiveSkill: async (slug) => {
        archived.push(slug);
      }
    });

    expect(archived).toEqual([]);
    expect(result.applied).toBe(0);
    expect(result.errors[0]).toContain("disk full");
  });

  it("reads the folder name out of a capability path", () => {
    expect(skillSlugOf(skill("Brand voice", "brand-voice"))).toBe("brand-voice");
  });
});

describe("the curator prompt and the bundled agent", () => {
  it("offers the model every action the parser accepts, and no others", () => {
    const agent = readFileSync(
      fileURLToPath(new URL("../dsh-runtime/plugin/lib/agent-runtime.js", import.meta.url)),
      "utf8"
    );
    const prompt = agent.slice(
      agent.indexOf("const CURATOR_PERSONA"),
      agent.indexOf("const RUN_DATA_KEYS")
    );
    for (const type of CURATOR_ACTION_TYPES) {
      expect(prompt).toContain(`"type":"${type}"`);
    }
    const offered = [...prompt.matchAll(/"type":"([a-z_]+)"/g)].map(([, type]) => type);
    expect([...new Set(offered)].sort()).toEqual([...CURATOR_ACTION_TYPES].sort());
  });

  it("shows the model use and selection but never a skill body", () => {
    const prompt = curatorPrompt(
      reviewSkills({
        capabilities: [skill("Brand voice")],
        usage: [{ capabilityRef: "registry:brand voice/SKILL.md", useCount: 2, lastUsedAt: NOW }],
        selectedRefs: [],
        now: NOW
      })
    );
    expect(prompt).toContain('"Brand voice" — used 2 time(s); selected by no agent; active');
    expect(prompt).not.toContain("SKILL.md");
  });
});
