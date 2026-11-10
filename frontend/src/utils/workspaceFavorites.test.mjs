import test from "node:test";
import assert from "node:assert/strict";
import {
  favoritesKey,
  parseFavorites,
  threadFavoriteId,
  favoritesFirst,
} from "./workspaceFavorites.mjs";
test("favorites are account scoped and default threads are workspace scoped", () => {
  assert.notEqual(favoritesKey(1), favoritesKey(2));
  assert.notEqual(threadFavoriteId(1, null), threadFavoriteId(2, null));
});
test("starred rows come first without changing either group's existing order", () => {
  const rows = [1, 2, 3, 4, 5];
  assert.deepEqual(
    favoritesFirst(rows, (id) => [4, 2].includes(id)),
    [2, 4, 1, 3, 5]
  );
  assert.deepEqual(rows, [1, 2, 3, 4, 5]);
});
test("bad storage cannot break navigation", () => {
  assert.deepEqual(parseFavorites("{"), { workspaces: [], threads: [] });
  assert.deepEqual(
    parseFavorites(
      JSON.stringify({
        workspaces: [1, 1, "2", null],
        threads: ["1:default", 0],
      })
    ),
    { workspaces: [1], threads: ["1:default"] }
  );
});
