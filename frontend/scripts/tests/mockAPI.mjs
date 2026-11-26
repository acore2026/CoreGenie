export async function mockAPI(context) {
  await context.addInitScript(() => localStorage.setItem("theme", "light"));
  await context.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    let body = {};
    if (pathname.endsWith("/onboarding")) body = { onboardingComplete: true };
    else if (pathname.endsWith("/setup-complete"))
      body = { results: { MultiUserMode: false, RequiresAuth: false } };
    else if (pathname.endsWith("/system/refresh-user"))
      body = { success: true, user: null };
    else if (pathname.endsWith("/ping")) body = { online: true };
    else if (pathname.endsWith("/workspaces")) body = { workspaces: [] };
    else if (pathname.endsWith("/announcements"))
      body = { announcements: [] };
    else if (pathname.endsWith("/user/sidebar-preferences"))
      body = {
        preferences: {
          groups: { groups: [], assignments: {}, collapsed: {} },
          favorites: { workspaces: [], threads: [] },
        },
      };
    else if (pathname.includes("logo") || pathname.includes("/pfp"))
      return route.fulfill({ status: 204 });
    else if (pathname.includes("footer")) body = { footerData: [] };
    await route.fulfill({ status: 200, json: body });
  });
}
