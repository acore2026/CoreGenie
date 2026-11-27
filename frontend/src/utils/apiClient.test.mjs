import { test } from "vitest";
import assert from "node:assert/strict";
import { ApiError, cleanHeaders, createApiClient } from "./apiClient.ts";

test("cleanHeaders strips null, undefined and empty values", () => {
  assert.deepEqual(
    cleanHeaders({
      Authorization: null,
      "X-Empty": "",
      "X-Missing": undefined,
      "X-Keep": "ok",
    }),
    { "X-Keep": "ok" }
  );
});

test("POST/PUT/PATCH JSON requests automatically set Content-Type and serialize objects", async () => {
  const calls = [];
  const client = createApiClient({
    apiBase: "/api",
    getHeaders: () => ({ Authorization: "Bearer tok", "X-Timezone": "UTC" }),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const result = await client.post("/items", { name: "alpha" });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/items");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.equal(calls[0].init.body, JSON.stringify({ name: "alpha" }));
});

test("FormData requests omit Content-Type so browser sets multipart boundary", async () => {
  const calls = [];
  const client = createApiClient({
    apiBase: "/api",
    getHeaders: () => ({ Authorization: null, "X-Timezone": "UTC" }),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ uploaded: true }), { status: 200 });
    },
  });

  const form = new FormData();
  form.append("file", new Blob(["hi"]), "hello.txt");
  await client.post("/upload", form);

  assert.equal(calls[0].init.headers["Content-Type"], undefined);
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.body, form);
});

test("non-2xx responses throw ApiError with status and server error message", async () => {
  const client = createApiClient({
    apiBase: "/api",
    getHeaders: () => ({}),
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: "Permission denied" }), {
        status: 403,
      }),
  });

  await assert.rejects(
    () => client.get("/admin/secret"),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 403);
      assert.equal(error.message, "Permission denied");
      return true;
    }
  );
});

test("auth: false skips base auth headers", async () => {
  const calls = [];
  const client = createApiClient({
    apiBase: "/api",
    getHeaders: () => ({ Authorization: "Bearer secret" }),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ public: true }), { status: 200 });
    },
  });

  await client.get("/public", { auth: false });
  assert.equal(calls[0].init.headers.Authorization, undefined);
});
