import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("parses an existing text file into the configured direct upload directory", async () => {
  const storage = await mkdtemp(path.join(tmpdir(), "coregenie-parser-"));
  try {
    vi.stubEnv("STORAGE_DIR", storage);
    const original = path.join(storage, "proposal.txt");
    await writeFile(original, "Meeting notes");
    const { parseDocument } = await import("../service.js");
    const result = await parseDocument({
      filename: "proposal.txt",
      options: { absolutePath: original },
    });
    expect(result.success).toBe(true);
    expect(result.documents).toHaveLength(1);
    const [document] = result.documents;
    expect(document.isDirectUpload).toBe(true);
    expect(
      JSON.parse(await readFile(path.join(storage, document.location), "utf8"))
        .pageContent
    ).toBe("Meeting notes");
    expect(await readFile(original, "utf8")).toBe("Meeting notes");
  } finally {
    await rm(storage, { recursive: true, force: true });
  }
});
