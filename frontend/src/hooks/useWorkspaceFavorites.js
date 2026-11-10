import useSidebarPreferences from "@/hooks/useSidebarPreferences";

export default function useWorkspaceFavorites() {
  const { preferences, save } = useSidebarPreferences();
  const favorites = preferences.favorites;
  function toggle(kind, id) {
    const selected = !favorites[kind].includes(id);
    return save(
      { type: "favorite", kind, id, selected },
      {
        ...preferences,
        favorites: {
          ...favorites,
          [kind]: selected
            ? [...favorites[kind], id]
            : favorites[kind].filter((value) => value !== id),
        },
      }
    );
  }
  return { favorites, toggle };
}
