import React, { useEffect, useState } from "react";
import { authConfig } from "@/models/oauth";
import OAuthLogin from "./OAuth";
import PasswordModal, { usePasswordModal } from "@/components/Modals/Password";
import { FullScreenLoader } from "@/components/Preloader";
import { Navigate } from "react-router-dom";
import paths from "@/utils/paths";
import useQuery from "@/hooks/useQuery";
import useSimpleSSO from "@/hooks/useSimpleSSO";

/**
 * Login page that handles both single and multi-user login.
 *
 * If Simple SSO is enabled and no login is allowed, the user will be redirected to the SSO login page
 * which may not have a token so the login will fail.
 *
 * @returns {JSX.Element}
 */
export default function Login() {
  const [provider, setProvider] = useState(null);
  const query = useQuery();
  useEffect(() => {
    let active = true;
    authConfig()
      .then((result) => {
        if (active) setProvider(result.provider);
      })
      .catch(() => {
        if (active) setProvider("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);
  if (!provider) return <FullScreenLoader />;
  if (provider === "idaas" || provider === "unavailable")
    return (
      <OAuthLogin
        returnTo={query.get("redirectTo") || "/"}
        error={query.get("oauthError")}
        unavailable={provider === "unavailable"}
      />
    );
  return <LocalLogin />;
}

function LocalLogin() {
  const query = useQuery();
  const requestedRedirect = query.get("redirectTo");
  const redirectTo =
    requestedRedirect?.startsWith("/") && !requestedRedirect.startsWith("//")
      ? requestedRedirect
      : paths.home();
  const { loading: ssoLoading, ssoConfig } = useSimpleSSO();
  const { loading, requiresAuth, mode } = usePasswordModal(!!query.get("nt"));

  if (loading || ssoLoading) return <FullScreenLoader />;

  // If simple SSO is enabled and no login is allowed, redirect to the SSO login page.
  if (ssoConfig.enabled && ssoConfig.noLogin) {
    // If a noLoginRedirect is provided and no token is provided, redirect to that webpage.
    if (!!ssoConfig.noLoginRedirect && !query.has("token"))
      return window.location.replace(ssoConfig.noLoginRedirect);
    // Otherwise, redirect to the SSO login page.
    else
      return (
        <Navigate
          to={`${paths.sso.login()}?redirectTo=${encodeURIComponent(
            redirectTo
          )}`}
        />
      );
  }

  if (requiresAuth === false) return <Navigate to={redirectTo} replace />;

  return <PasswordModal mode={mode} redirectTo={redirectTo} />;
}
