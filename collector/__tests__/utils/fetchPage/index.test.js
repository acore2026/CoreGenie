const { fetchPageHtml } = require("../../../utils/fetchPage");

describe("fetchPageHtml", () => {
  afterEach(() => jest.restoreAllMocks());

  test("fetches HTML without starting a browser", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      text: async () => "<main>hello</main>",
    });

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
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    await expect(fetchPageHtml("https://example.com/private")).rejects.toThrow(
      "HTTP 403: Forbidden"
    );
  });
});
