/* eslint-env jest, node */
const {
  normalizeToolId,
  toolRegistry,
  visibleToolDescriptorsForAgent,
} = require("../../tools");
const { skillCatalogPrompt } = require("../../agent-skills/registry");

describe("Agent tool visibility", () => {
  it("registers only the canonical knowledge search name", () => {
    expect(toolRegistry.get("knowledge.search")).toBeTruthy();
    expect(toolRegistry.get("rag.search")).toBeNull();
    expect(normalizeToolId("rag.search")).toBe("knowledge.search");
  });

  it("normalizes registered names and legacy filesystem tool names", () => {
    expect(normalizeToolId("filesystem_search")).toBe("filesystem.search");
    expect(normalizeToolId("filesystem-search")).toBe("filesystem.search");
    expect(normalizeToolId("filesystem-search-files")).toBe(
      "filesystem.search"
    );
    expect(normalizeToolId("filesystem-read-text-file")).toBe(
      "filesystem.read"
    );
    expect(normalizeToolId("filesystem-edit-file")).toBe("filesystem.write");
  });

  it("registers the fixed 3GPP Markdown conversion tool", () => {
    expect(toolRegistry.get("3gpp.convert-markdown")).toMatchObject({
      id: "3gpp.convert-markdown",
      action: true,
      effect: "write",
    });
  });

  it("registers the structured workspace scheduling tool", () => {
    expect(toolRegistry.get("schedule.create")).toMatchObject({
      id: "schedule.create",
      action: true,
      effect: "write",
    });
  });

  it("offers workspace scheduling to regular chat Agents", () => {
    const visible = visibleToolDescriptorsForAgent({ tools: [] }).map(
      (descriptor) => descriptor.id
    );

    expect(visible).toContain("schedule.create");
    expect(
      visibleToolDescriptorsForAgent(
        { tools: [] },
        { strictSelection: true }
      ).map((descriptor) => descriptor.id)
    ).not.toContain("schedule.create");
  });

  it("never exposes tools that are not allowed for the Agent", () => {
    const visible = visibleToolDescriptorsForAgent(
      { tools: ["knowledge.search"] },
      { strictSelection: true }
    ).map((descriptor) => descriptor.id);

    expect(visible).toEqual(["knowledge.search"]);
    expect(visible).not.toContain("memory.store");
    expect(visible).not.toContain("knowledge.ingest");
    expect(visible).not.toContain("knowledge.publish");
  });

  it("maps a legacy rag.search permission to the canonical visible tool", () => {
    const visible = visibleToolDescriptorsForAgent(
      { tools: ["rag.search"] },
      { strictSelection: true }
    ).map((descriptor) => descriptor.id);

    expect(visible).toEqual(["knowledge.search"]);
  });

  it("describes every knowledge operation as part of Workspace RAG", () => {
    for (const toolId of [
      "knowledge.search",
      "knowledge.ingest",
      "knowledge.publish",
    ]) {
      expect(toolRegistry.get(toolId)?.description).toMatch(
        /Workspace RAG knowledge base/
      );
    }
  });

  it("removes disallowed tool names from the Skill catalog shown to the model", async () => {
    const catalog = await skillCatalogPrompt(
      { tools: ["knowledge.search"] },
      { id: 2 },
      [
        {
          name: "test-skill",
          scope: "global",
          revision: "revision-1",
          description: "Test skill may use memory.store when available",
          allowedTools:
            "rag.search knowledge.ingest memory.store filesystem.write",
        },
      ],
      {
        visibleToolIds: new Set(["knowledge.search"]),
        enforceAllowedTools: true,
      }
    );

    expect(catalog).toContain('allowed-tools="knowledge.search"');
    expect(catalog).not.toContain("rag.search");
    expect(catalog).not.toContain("knowledge.ingest");
    expect(catalog).not.toContain("memory.store");
    expect(catalog).not.toContain("filesystem.write");
  });

  it("omits Skill allowed-tools metadata by default", async () => {
    const catalog = await skillCatalogPrompt(
      { tools: ["knowledge.search"] },
      { id: 2 },
      [
        {
          name: "test-skill",
          scope: "global",
          revision: "revision-1",
          description: "Test skill",
          allowedTools: "knowledge.search",
        },
      ],
      { visibleToolIds: new Set(["knowledge.search"]) }
    );

    expect(catalog).not.toContain("allowed-tools=");
  });
});
