import type { StoredUser } from "@/utils/request";
import { useEffect, useState } from "react";
import System from "@/models/system";
import { AUTH_TOKEN, AUTH_USER } from "@/utils/constants";
import paths from "@/utils/paths";
import showToast from "@/utils/toast";
import { useModal } from "@/hooks/useModal";
import RecoveryCodeModal from "@/components/Modals/DisplayRecoveryCodeModal";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowLeft } from "@phosphor-icons/react";
import { AuthHeading, AuthInput } from "@/components/PublicLayout";

export default function MultiUserAuth({ redirectTo = paths.home() }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [downloadComplete, setDownloadComplete] = useState(false);
  const [user, setUser] = useState<StoredUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [step, setStep] = useState("login");
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const { isOpen, openModal, closeModal } = useModal();

  useEffect(() => {
    let active = true;
    System.publicRegistrationStatus().then((result) => {
      if (active) setRegistrationEnabled(result.enabled);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (downloadComplete && user && token) {
      localStorage.setItem(AUTH_USER, JSON.stringify(user));
      localStorage.setItem(AUTH_TOKEN, token);
      window.location.assign(redirectTo);
    }
  }, [downloadComplete, user, token, redirectTo]);

  const changeStep = (next: "login" | "recover" | "reset") => {
    setError(null);
    setStep(next);
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    const form = new FormData(event.currentTarget);
    setError(null);
    setLoading(true);
    try {
      if (step === "login") {
        const result = await System.requestToken({
          username: String(form.get("username") ?? ""),
          password: String(form.get("password") ?? ""),
        });
        if (!result.valid || !result.token || !result.user) {
          setError(result.message || t("auth_page.failed"));
          return;
        }
        setUser(result.user);
        setToken(result.token);
        if (result.recoveryCodes?.length) {
          setRecoveryCodes(result.recoveryCodes);
          openModal();
        } else {
          localStorage.setItem(AUTH_USER, JSON.stringify(result.user));
          localStorage.setItem(AUTH_TOKEN, result.token);
          window.location.assign(redirectTo);
        }
      } else if (step === "recover") {
        const result = await System.recoverAccount(
          String(form.get("username") ?? ""),
          [
            String(form.get("recovery1") ?? ""),
            String(form.get("recovery2") ?? ""),
          ]
        );
        if (!result.success || !result.resetToken) {
          setError(result.error || t("auth_page.failed"));
          return;
        }
        localStorage.setItem("resetToken", result.resetToken);
        changeStep("reset");
      } else {
        if (
          String(form.get("password") ?? "") !==
          String(form.get("confirmPassword") ?? "")
        ) {
          setError(t("auth_page.password_mismatch"));
          return;
        }
        const resetToken = localStorage.getItem("resetToken");
        if (!resetToken) {
          setError(t("auth_page.reset_invalid"));
          return;
        }
        const result = await System.resetPassword(
          resetToken,
          String(form.get("password") ?? ""),
          String(form.get("confirmPassword") ?? "")
        );
        if (!result.success) {
          setError(result.error || t("auth_page.failed"));
          return;
        }
        localStorage.removeItem("resetToken");
        changeStep("login");
        showToast(t("auth_page.reset_success"), "success", { clear: true });
      }
    } catch {
      setError(t("auth_page.failed"));
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      <AuthHeading
        title={t(
          step === "login"
            ? "auth_page.login_title"
            : "login.password-reset.title"
        )}
        description={t(
          step === "login"
            ? "auth_page.login_description"
            : step === "recover"
              ? "auth_page.reset_description"
              : "auth_page.reset_new_description"
        )}
      />
      <form key={step} onSubmit={submit} className="auth-form">
        {step !== "reset" && (
          <AuthInput
            label={t("auth_page.username")}
            name="username"
            type="text"
            autoComplete="username"
            required
            disabled={loading}
          />
        )}
        {step === "login" && (
          <>
            <AuthInput
              label={t("auth_page.password")}
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={loading}
            />
            <button
              type="button"
              disabled={loading}
              className="public-text-link self-end -mt-3 disabled:opacity-50"
              onClick={() => changeStep("recover")}
            >
              {t("auth_page.forgot_password")}
            </button>
          </>
        )}
        {step === "recover" &&
          [1, 2].map((number) => (
            <AuthInput
              key={number}
              label={t("auth_page.recovery_code", { number })}
              name={`recovery${number}`}
              type="text"
              autoComplete="off"
              required
              disabled={loading}
            />
          ))}
        {step === "reset" && (
          <>
            <AuthInput
              label={t("auth_page.new_password")}
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              disabled={loading}
            />
            <AuthInput
              label={t("login.registration.confirm-password")}
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              disabled={loading}
            />
          </>
        )}
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading || isOpen}
          className="public-button"
        >
          {t(
            loading
              ? "auth_page.submitting"
              : step === "login"
                ? "login.multi-user.login"
                : "login.password-reset.title"
          )}
          <ArrowRight size={18} />
        </button>
      </form>
      {step === "login" ? (
        registrationEnabled && (
          <div className="auth-switch">
            <span>{t("auth_page.no_account")}</span>
            <Link to={paths.register()} className="public-text-link">
              {t("login.registration.create-account")}
            </Link>
          </div>
        )
      ) : (
        <div className="auth-switch">
          <button
            type="button"
            disabled={loading}
            className="public-text-link disabled:opacity-50"
            onClick={() => changeStep("login")}
          >
            <ArrowLeft size={16} />
            {t("login.password-reset.back-to-login")}
          </button>
        </div>
      )}
      {isOpen && (
        <RecoveryCodeModal
          recoveryCodes={recoveryCodes}
          onDownloadComplete={() => setDownloadComplete(true)}
          onClose={closeModal}
        />
      )}
    </>
  );
}
