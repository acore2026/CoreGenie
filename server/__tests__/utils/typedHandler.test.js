/* eslint-env jest, node */
const { z } = require("zod");
const { typedHandler } = require("../../utils/http/typedHandler.ts");

function createMockResponse() {
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.payload = data;
      return this;
    },
  };
  return res;
}

describe("typedHandler Zod validation middleware", () => {
  it("passes parsed body, query, and params to handler when valid", async () => {
    const handler = jest.fn(({ body, query, params }, res) =>
      res.status(200).json({ body, query, params })
    );
    const wrapped = typedHandler(
      {
        body: z.object({ name: z.string().trim().min(1) }),
        query: z.object({ page: z.coerce.number().int().min(1).default(1) }),
        params: z.object({ id: z.string().min(1) }),
      },
      handler
    );

    const res = createMockResponse();
    await wrapped(
      {
        body: JSON.stringify({ name: "  CoreGenie  " }),
        query: { page: "2" },
        params: { id: "abc" },
      },
      res
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({
      body: { name: "CoreGenie" },
      query: { page: 2 },
      params: { id: "abc" },
    });
  });

  it("returns 400 with validation error when body is invalid", async () => {
    const handler = jest.fn();
    const wrapped = typedHandler(
      {
        body: z.object({
          key: z.string().min(1, "Key is required"),
        }),
      },
      handler
    );

    const res = createMockResponse();
    await wrapped({ body: JSON.stringify({ key: "" }) }, res);

    expect(handler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.payload).toEqual({ success: false, error: "Key is required" });
  });
});
