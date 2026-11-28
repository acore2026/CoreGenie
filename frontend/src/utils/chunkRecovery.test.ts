import { test } from "vitest";
import assert from "node:assert/strict";
import {
  CHUNK_RECOVERY_STORAGE_KEY,
  claimChunkRecovery,
  isDynamicImportError,
} from "./chunkRecovery.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

test("recognizes browser dynamic import failures", () => {
  assert.equal(
    isDynamicImportError(
      new TypeError(
        "Failed to fetch dynamically imported module: /assets/old.js"
      )
    ),
    true
  );
  assert.equal(
    isDynamicImportError({ reason: { message: "Loading chunk 42 failed" } }),
    true
  );
  assert.equal(isDynamicImportError(new Error("API request failed")), false);
});

test("allows one recovery for the same page during the cooldown", () => {
  const storage = memoryStorage();
  const input = {
    storage,
    href: "https://work.example/workspace/3gpp",
    now: 1_000,
    cooldownMs: 60_000,
  };

  assert.equal(claimChunkRecovery(input), true);
  assert.equal(claimChunkRecovery({ ...input, now: 2_000 }), false);
  assert.deepEqual(
    JSON.parse(storage.getItem(CHUNK_RECOVERY_STORAGE_KEY) ?? "null"),
    {
      href: input.href,
      attemptedAt: 1_000,
    }
  );
});

test("allows recovery on another page or after the cooldown", () => {
  const storage = memoryStorage();
  assert.equal(
    claimChunkRecovery({ storage, href: "https://work.example/a", now: 1 }),
    true
  );
  assert.equal(
    claimChunkRecovery({ storage, href: "https://work.example/b", now: 2 }),
    true
  );
  assert.equal(
    claimChunkRecovery({
      storage,
      href: "https://work.example/b",
      now: 60_003,
    }),
    true
  );
});

test("does not reload when session storage is unavailable", () => {
  assert.equal(
    claimChunkRecovery({
      storage: {
        setItem() {},
        getItem() {
          throw new Error("blocked");
        },
      },
      href: "https://work.example/a",
    }),
    false
  );
});
