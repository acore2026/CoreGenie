import { describe, test, expect, afterEach, vi } from "vitest";
import { fetchPageHtml } from "../../../utils/fetchPage/index.js";

describe("fetchPageHtml", () => {
  afterEach(() => vi.restoreAllMocks());

  test("fetches HTML without starting a browser", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("<main>hello</main>"));

    await expect(
      fetchPageHtml("https://example.com", {
        headers: { Authorization: "Bearer test" },
      })
    ).resolves.toBe("<main>hello</main>");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test",
          Accept: expect.stringContaining("text/html"),
        }),
      })
    );
  });

  test("reports non-success HTTP responses", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(null, { status: 403, statusText: "Forbidden" })
    );

    await expect(fetchPageHtml("https://example.com/private")).rejects.toThrow(
      "HTTP 403: Forbidden"
    );
  });
});
