import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { FullScreenLoader } from "../Preloader";
import validateSessionTokenForUser from "@/utils/session";
import paths from "@/utils/paths";
import { AUTH_TIMESTAMP, AUTH_TOKEN, AUTH_USER } from "@/utils/constants";
import { userFromStorage } from "@/utils/request";
import System from "@/models/system";
import UserMenu from "../UserMenu";
import { KeyboardShortcutWrapper } from "@/utils/keyboardShortcuts";
import { AnnouncementSession } from "@/components/Announcements";

interface Authentication {
  isAuthd: boolean;
  shouldRedirectToOnboarding: boolean;
  multiUserMode: boolean;
}
let cachedAuth: { identity: string; value: Authentication } | null = null;
let pendingAuth: { identity: string; promise: Promise<Authentication> } | null =
  null;

function authIdentity() {
  return `${localStorage.getItem(AUTH_TOKEN) || ""}:${localStorage.getItem(AUTH_USER) || ""}`;
}

async function resolveAuthentication(): Promise<Authentication> {
  const identity = authIdentity();
  if (cachedAuth?.identity === identity) return cachedAuth.value;
  if (pendingAuth?.identity === identity) return pendingAuth.promise;

  const promise = (async (): Promise<Authentication> => {
    const onboardingComplete = await System.isOnboardingComplete();
    const { MultiUserMode = false, RequiresAuth = false } =
      (await System.keys()) || {};
    const value = {
      isAuthd: false,
      shouldRedirectToOnboarding: onboardingComplete === false,
      multiUserMode: MultiUserMode,
    };

    if (value.shouldRedirectToOnboarding) {
      value.isAuthd = true;
    } else if (!MultiUserMode && !RequiresAuth) {
      value.isAuthd = true;
    } else {
      const localUser = localStorage.getItem(AUTH_USER);
      const localAuthToken = localStorage.getItem(AUTH_TOKEN);
      const hasRequiredCredentials = MultiUserMode
        ? Boolean(localUser && localAuthToken)
        : Boolean(localAuthToken);
      value.isAuthd = hasRequiredCredentials
        ? await validateSessionTokenForUser()
        : false;

      if (!value.isAuthd && identity === authIdentity()) {
        localStorage.removeItem(AUTH_USER);
        localStorage.removeItem(AUTH_TOKEN);
        localStorage.removeItem(AUTH_TIMESTAMP);
      }
    }

    if (identity === authIdentity()) cachedAuth = { identity, value };
    return value;
  })();

  pendingAuth = { identity, promise };
  try {
    return await promise;
  } finally {
    if (pendingAuth?.promise === promise) pendingAuth = null;
  }
}

// Used only for Multi-user mode only as we permission specific pages based on auth role.
// When in single user mode we just bypass any authchecks.
function useIsAuthenticated() {
  const initial =
    cachedAuth?.identity === authIdentity() ? cachedAuth.value : null;
  const [auth, setAuth] = useState(
    initial || {
      isAuthd: null,
      shouldRedirectToOnboarding: false,
      multiUserMode: false,
    }
  );

  useEffect(() => {
    let active = true;
    resolveAuthentication().then((result) => active && setAuth(result));
    return () => {
      active = false;
    };
  }, []);

  return auth;
}

// Allows only admin to access the route and if in single user mode,
// allows all users to access the route
export function AdminRoute({
  Component,
  hideUserMenu = false,
}: {
  Component: React.ComponentType;
  hideUserMenu?: boolean;
}) {
  const { isAuthd, shouldRedirectToOnboarding, multiUserMode } =
    useIsAuthenticated();
  if (isAuthd === null) return <FullScreenLoader />;

  if (shouldRedirectToOnboarding) {
    return <Navigate to={paths.onboarding.home()} />;
  }

  const user = userFromStorage();
  return isAuthd && (user?.role === "admin" || !multiUserMode) ? (
    hideUserMenu ? (
      <KeyboardShortcutWrapper>
        <AnnouncementSession />
        <Component />
      </KeyboardShortcutWrapper>
    ) : (
      <KeyboardShortcutWrapper>
        <UserMenu>
          <Component />
        </UserMenu>
      </KeyboardShortcutWrapper>
    )
  ) : (
    <Navigate to={paths.home()} />
  );
}

// Allows manager and admin to access the route and if in single user mode,
// allows all users to access the route
export function ManagerRoute({
  Component,
}: {
  Component: React.ComponentType;
}) {
  const { isAuthd, shouldRedirectToOnboarding, multiUserMode } =
    useIsAuthenticated();
  if (isAuthd === null) return <FullScreenLoader />;

  if (shouldRedirectToOnboarding) {
    return <Navigate to={paths.onboarding.home()} />;
  }

  const user = userFromStorage();
  return isAuthd && (user?.role !== "default" || !multiUserMode) ? (
    <KeyboardShortcutWrapper>
      <UserMenu>
        <Component />
      </UserMenu>
    </KeyboardShortcutWrapper>
  ) : (
    <Navigate to={paths.home()} />
  );
}

// Allows access only in single user mode — redirects to home in multi-user mode
export function SingleUserRoute({
  Component,
}: {
  Component: React.ComponentType;
}) {
  const { isAuthd, shouldRedirectToOnboarding, multiUserMode } =
    useIsAuthenticated();
  if (isAuthd === null) return <FullScreenLoader />;

  if (shouldRedirectToOnboarding) {
    return <Navigate to={paths.onboarding.home()} />;
  }

  return isAuthd && !multiUserMode ? (
    <KeyboardShortcutWrapper>
      <AnnouncementSession />
      <Component />
    </KeyboardShortcutWrapper>
  ) : (
    <Navigate to={paths.home()} />
  );
}

export default function PrivateRoute({
  Component,
  GuestComponent = null,
}: {
  Component: React.ComponentType;
  GuestComponent?: React.ComponentType | null;
}) {
  const { isAuthd, shouldRedirectToOnboarding } = useIsAuthenticated();
  if (isAuthd === null) return <FullScreenLoader />;

  if (shouldRedirectToOnboarding) {
    return <Navigate to="/onboarding" />;
  }

  return isAuthd ? (
    <KeyboardShortcutWrapper>
      <UserMenu>
        <Component />
      </UserMenu>
    </KeyboardShortcutWrapper>
  ) : GuestComponent ? (
    <GuestComponent />
  ) : (
    <Navigate to={paths.login(true)} />
  );
}
