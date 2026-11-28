import useSidebarPreferences from "@/hooks/useSidebarPreferences";

export default function useWorkspaceFavorites() {
  const { preferences, save } = useSidebarPreferences();
  const favorites = preferences.favorites;
  function toggle(...[kind, id]: ["workspaces", number] | ["threads", string]) {
    function update<T>(values: T[], value: T) {
      const selected = !values.includes(value);
      const updated = selected
        ? [...values, value]
        : values.filter((item) => item !== value);
      return save(
        { type: "favorite", kind, id, selected },
        { ...preferences, favorites: { ...favorites, [kind]: updated } }
      );
    }
    return kind === "workspaces"
      ? update(favorites.workspaces, id)
      : update(favorites.threads, id);
  }
  return { favorites, toggle };
}
