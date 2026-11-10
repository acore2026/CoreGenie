import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowRight, CheckCircle } from "@phosphor-icons/react";
import System from "@/models/system";
import paths from "@/utils/paths";
import { FullScreenLoader } from "@/components/Preloader";
import { useTranslation } from "react-i18next";
import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from "@/utils/username";
import PublicLayout, {
  AuthHeading,
  AuthInput,
} from "@/components/PublicLayout";

export default function Register() {
  const { t } = useTranslation();
  const [status, setStatus] = useState("loading");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    let active = true;
    System.publicRegistrationStatus().then(({ enabled }) => {
      if (active) setStatus(enabled ? "ready" : "disabled");
    });
    return () => {
      active = false;
    };
  }, []);
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    const form = new FormData(event.currentTarget);
    setError(null);
    if (form.get("password") !== form.get("confirmPassword")) {
      setError(t("auth_page.password_mismatch"));
      return;
    }
    setSubmitting(true);
    try {
      const result = await System.register({
        username: form.get("username"),
        password: form.get("password"),
        confirmPassword: form.get("confirmPassword"),
      });
      if (result.success) setStatus("complete");
      else setError(result.error || t("login.registration.failed"));
    } catch {
      setError(t("login.registration.failed"));
    } finally {
      setSubmitting(false);
    }
  };
  if (status === "loading") return <FullScreenLoader />;
  if (status === "disabled") return <Navigate to={paths.login()} replace />;
  return (
    <PublicLayout>
      {status === "complete" ? (
        <div role="status">
          <CheckCircle size={36} className="mb-6 text-[var(--public-accent)]" />
          <AuthHeading
            title={t("login.registration.complete-title")}
            description={t("login.registration.complete-description")}
          />
          <Link to={paths.login(true)} className="public-button w-full">
            {t("login.registration.sign-in")}
            <ArrowRight size={18} />
          </Link>
        </div>
      ) : (
        <>
          <AuthHeading
            title={t("login.registration.title")}
            description={t("auth_page.register_description")}
          />
          <form onSubmit={handleSubmit} className="auth-form">
            <AuthInput
              label={t("auth_page.username")}
              hint={t("auth_page.username_hint")}
              name="username"
              type="text"
              minLength={USERNAME_MIN_LENGTH}
              maxLength={USERNAME_MAX_LENGTH}
              pattern={USERNAME_PATTERN}
              autoComplete="username"
              required
              disabled={submitting}
            />
            <AuthInput
              label={t("auth_page.password")}
              hint={t("auth_page.password_hint")}
              name="password"
              type="password"
              minLength={8}
              autoComplete="new-password"
              required
              disabled={submitting}
            />
            <AuthInput
              label={t("login.registration.confirm-password")}
              name="confirmPassword"
              type="password"
              minLength={8}
              autoComplete="new-password"
              required
              disabled={submitting}
            />
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="public-button"
            >
              {t(
                submitting
                  ? "login.registration.creating"
                  : "login.registration.create-account"
              )}
              <ArrowRight size={18} />
            </button>
          </form>
          <div className="auth-switch">
            <span>{t("auth_page.have_account")}</span>
            <Link to={paths.login()} className="public-text-link">
              {t("login.multi-user.login")}
            </Link>
          </div>
        </>
      )}
    </PublicLayout>
  );
}
