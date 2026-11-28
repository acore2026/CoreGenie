import { describe, expect, it } from "vitest";
import {
  ARCHITECTURE_DOCS,
  DIAGRAM_ASSETS,
  findArchitectureDoc,
} from "./docsRegistry";
import {
  REPOSITORY_BASE_URL,
  renderArchitectureMarkdown,
  resolveDiagramAsset,
  resolveDocLink,
  resolveRepoRelativePath,
} from "./markdownRenderer";

describe("architecture documentation renderer", () => {
  it("loads all 5 tiered docs with non-empty markdown and headings", () => {
    expect(ARCHITECTURE_DOCS).toHaveLength(5);
    expect(findArchitectureDoc(null).id).toBe("overview");
    expect(findArchitectureDoc("unknown").id).toBe("overview");
    expect(findArchitectureDoc("agent-runtime").layer).toBe("L2");

    for (const doc of ARCHITECTURE_DOCS) {
      const rendered = renderArchitectureMarkdown(doc);
      expect(doc.markdown.length).toBeGreaterThan(200);
      expect(rendered.headings.length).toBeGreaterThanOrEqual(3);
      expect(rendered.html).not.toContain("<h1");
    }
  });

  it("resolves internal doc links to in-app /help architecture routes", () => {
    const overviewToRuntime = resolveDocLink(
      "docs/help/architecture.md",
      "architecture/agent-runtime.md"
    );
    expect(overviewToRuntime).toEqual({
      kind: "internal-doc",
      docId: "agent-runtime",
      href: "/help?tab=architecture&doc=agent-runtime",
    });

    const backToOverview = resolveDocLink(
      "docs/help/architecture/agent-runtime.md",
      "../architecture.md"
    );
    expect(backToOverview).toEqual({
      kind: "internal-doc",
      docId: "overview",
      href: "/help?tab=architecture&doc=overview",
    });

    const siblingTopic = resolveDocLink(
      "docs/help/architecture/agent-runtime.md",
      "config-skills-sandbox.md"
    );
    expect(siblingTopic).toEqual({
      kind: "internal-doc",
      docId: "config-skills-sandbox",
      href: "/help?tab=architecture&doc=config-skills-sandbox",
    });
  });

  it("rewrites repo file and directory links to GitHub URLs with zero relative links left", () => {
    const fileLink = resolveDocLink(
      "docs/help/architecture.md",
      "../../server/endpoints/chat.js"
    );
    expect(fileLink).toEqual({
      kind: "external",
      href: `${REPOSITORY_BASE_URL}/blob/master/server/endpoints/chat.js`,
      repoPath: "server/endpoints/chat.js",
    });

    const dirLink = resolveDocLink(
      "docs/help/architecture/config-skills-sandbox.md",
      "../../../sandbox/sandbox_broker"
    );
    expect(dirLink).toEqual({
      kind: "external",
      href: `${REPOSITORY_BASE_URL}/tree/master/sandbox/sandbox_broker`,
      repoPath: "sandbox/sandbox_broker",
    });

    for (const doc of ARCHITECTURE_DOCS) {
      const { html } = renderArchitectureMarkdown(doc);
      expect(html).not.toMatch(/href="\.\.\//);
      expect(html).not.toMatch(/src="(\.\.\/)?diagrams\//);
    }
  });

  it("maps every diagram SVG asset cleanly", () => {
    expect(Object.keys(DIAGRAM_ASSETS)).toHaveLength(6);
    expect(
      resolveDiagramAsset("docs/help/architecture.md", "diagrams/workbench.svg")
    ).toBe(DIAGRAM_ASSETS["docs/help/diagrams/workbench.svg"]);
    expect(
      resolveDiagramAsset(
        "docs/help/architecture/agent-runtime.md",
        "../diagrams/agent-lifecycle.svg"
      )
    ).toBe(DIAGRAM_ASSETS["docs/help/diagrams/agent-lifecycle.svg"]);
    expect(
      resolveRepoRelativePath("docs/help/architecture.md", "../../../outside")
    ).toBeNull();
  });
});
