/* eslint-env jest, node */
const {
  normalizeWebSearchResults,
  threeGppDirectoryFailureFamily,
  webFetch,
  webSearch,
} = require("../../tools/web");

describe("web fetch HTTP policy", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns ordinary 403 responses as non-retryable structured failures", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    const result = await webFetch.execute(
      {
        url: "https://www.3gpp.org/ftp/tsg_sa/WG2_SA2/",
        max_characters: 30_000,
      },
      { signal: new AbortController().signal }
    );

    expect(result).toMatchObject({
      ok: false,
      code: "HTTP_403",
      retryable: false,
      countsTowardFailureFamily: true,
    });
  });

  it("normalizes configured-provider results for the governed runtime", () => {
    expect(
      normalizeWebSearchResults(
        JSON.stringify([
          {
            title: "ACN overview",
            link: "https://example.com/acn",
            snippet: "Agent Connecting Network overview",
          },
        ]),
        { query: "Agent Connecting Network", maxResults: 10 }
      )
    ).toEqual({
      ok: true,
      code: "OK",
      summary:
        'Found 1 online search results for "Agent Connecting Network".',
      data: [
        {
          title: "ACN overview",
          url: "https://example.com/acn",
          snippet: "Agent Connecting Network overview",
        },
      ],
      retryable: false,
    });
    expect(webSearch).toMatchObject({
      id: "web.search",
      name: "web_search",
      action: false,
    });
  });

  it("returns a structured failure when online search is unavailable", () => {
    expect(
      normalizeWebSearchResults("No information was found online.", {
        query: "missing",
      })
    ).toMatchObject({
      ok: false,
      code: "NO_RESULTS",
      data: { query: "missing", results: [] },
    });
  });

  it("uses the official 3GPP parent directory as family recovery", () => {
    const failedChild = threeGppDirectoryFailureFamily({
      url: "https://www.3gpp.org/ftp/tsg_sa/WG2_SA2/",
    });
    const parent = threeGppDirectoryFailureFamily({
      url: "https://www.3gpp.org/ftp/tsg_sa/",
    });

    expect(failedChild).toMatchObject({
      key: "3gpp-directory:https://www.3gpp.org/ftp/tsg_sa/",
      recovery: false,
    });
    expect(parent).toMatchObject({
      key: failedChild.key,
      recovery: true,
    });
  });
});
