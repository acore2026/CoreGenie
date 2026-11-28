import { useEffect, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import PublicLayout, { AuthHeading } from "@/components/PublicLayout";
import { oauthRequest, oauthStart } from "@/models/oauth";
import { AUTH_TOKEN, AUTH_USER, AUTH_TIMESTAMP } from "@/utils/constants";

export default function OAuthLogin({
  returnTo = "/",
  error = null,
  unavailable = false,
}: {
  returnTo?: string;
  error?: string | null;
  unavailable?: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const errorKey = ["expired", "suspended", "failed"].includes(error ?? "")
    ? error
    : "unavailable";
  return (
    <PublicLayout>
      <AuthHeading
        title={t("oauth.title")}
        description={t("oauth.description")}
      />
      {(error || unavailable) && (
        <p role="alert" className="mb-6 text-sm text-red-700">
          {t(`oauth.errors.${errorKey}`)}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        className="public-button w-full disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
        onClick={() => {
          setBusy(true);
          if (unavailable) window.location.reload();
          else window.location.assign(oauthStart(returnTo));
        }}
      >
        {t(
          busy
            ? "oauth.connecting"
            : unavailable
              ? "oauth.retry"
              : "oauth.continue"
        )}
        <ArrowRight size={18} />
      </button>
      <p className="mt-5 text-sm leading-6 text-[var(--public-muted)]">
        {t("oauth.account_hint")}
      </p>
    </PublicLayout>
  );
}

// Share the exchange across StrictMode effect replays; the backend consumes it once.
const exchangeSession = () => oauthRequest("session");
let completion: ReturnType<typeof exchangeSession> | undefined;
export function OAuthComplete() {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    completion ||= exchangeSession();
    completion
      .then((result) => {
        if (!active) return;
        if (!result.valid || !result.token || !result.user)
          throw Error("Invalid session");
        localStorage.setItem(AUTH_TOKEN, result.token);
        localStorage.setItem(AUTH_USER, JSON.stringify(result.user));
        localStorage.removeItem(AUTH_TIMESTAMP);
        window.location.replace(result.returnTo || "/");
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);
  if (failed) return <OAuthLogin error="expired" />;
  return (
    <PublicLayout>
      <p role="status">{t("oauth.finishing")}</p>
    </PublicLayout>
  );
}
