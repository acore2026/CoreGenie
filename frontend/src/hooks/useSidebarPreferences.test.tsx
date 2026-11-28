// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import useSidebarPreferences from "./useSidebarPreferences";
import useUser from "./useUser";
import showToast from "@/utils/toast";
import { favoritesKey } from "@/utils/workspaceFavorites";

vi.mock("./useUser");
vi.mock("@/utils/toast", () => ({ default: vi.fn() }));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

const emptyGroups = { groups: [], collapsed: {}, assignments: {} };
const response = (ids: number[]) =>
  Response.json({
    preferences: {
      groups: emptyGroups,
      favorites: { workspaces: ids, threads: [] },
    },
    globalGroups: emptyGroups,
  });

function renderConsumers() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(document.createElement("div"));
  const consumers: ReturnType<typeof useSidebarPreferences>[] = [];
  function Consumer({ index }: { index: number }) {
    consumers[index] = useSidebarPreferences();
    return null;
  }
  const render = () =>
    flushSync(() =>
      root.render(
        <QueryClientProvider client={client}>
          <Consumer index={0} />
          <Consumer index={1} />
        </QueryClientProvider>
      )
    );
  render();
  return {
    render,
    consumers,
    close() {
      root.unmount();
      client.clear();
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

it("shares the initial read and imports legacy favorites once across consumers", async () => {
  vi.mocked(useUser).mockReturnValue({ user: { id: 4 }, authToken: "one" });
  localStorage.setItem(favoritesKey(4), JSON.stringify({ workspaces: [12] }));
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ preferences: null }))
    .mockResolvedValueOnce(response([]))
    .mockResolvedValueOnce(response([12]));
  vi.stubGlobal("fetch", fetcher);
  const ui = renderConsumers();
  try {
    await vi.waitFor(() =>
      expect(ui.consumers.every((c) => c.ready)).toBe(true)
    );
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual([
      "GET",
      "POST",
      "PUT",
    ]);
    const migration = JSON.parse(String(fetcher.mock.calls[2][1]?.body));
    expect(migration.migrationId).toBe(
      localStorage.getItem("sidebar-migration:v1:4")
    );
    expect(ui.consumers[1].preferences.favorites.workspaces).toEqual([12]);
  } finally {
    ui.close();
  }
});

it("rolls back a failed write without changing another account's preferences", async () => {
  vi.mocked(useUser).mockReturnValue({ user: { id: 4 }, authToken: "one" });
  let rejectWrite: (error: Error) => void = () => {
    throw new Error("write has not started");
  };
  const pending = new Promise<Response>((_resolve, reject) => {
    rejectWrite = reject;
  });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response([12]))
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(response([28]));
  vi.stubGlobal("fetch", fetcher);
  const ui = renderConsumers();
  try {
    await vi.waitFor(() => expect(ui.consumers[0].ready).toBe(true));
    const { preferences, save } = ui.consumers[0];
    expect(
      save(
        { type: "favorite", kind: "workspaces", id: 42, selected: true },
        { ...preferences, favorites: { workspaces: [12, 42], threads: [] } }
      )
    ).toBe(true);
    await vi.waitFor(() =>
      expect(ui.consumers[1].preferences.favorites.workspaces).toEqual([12, 42])
    );
    vi.mocked(useUser).mockReturnValue({ user: { id: 8 }, authToken: "two" });
    ui.render();
    await vi.waitFor(() =>
      expect(ui.consumers[0].preferences.favorites.workspaces).toEqual([28])
    );
    rejectWrite(new Error("offline"));
    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("sidebar_sync.failed", "error")
    );
    expect(ui.consumers[0].preferences.favorites.workspaces).toEqual([28]);
    vi.mocked(useUser).mockReturnValue({ user: { id: 4 }, authToken: "one" });
    ui.render();
    expect(ui.consumers[0].preferences.favorites.workspaces).toEqual([12]);
  } finally {
    ui.close();
  }
});
