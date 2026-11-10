import { useEffect, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import System from "@/models/system";
import { AUTH_TOKEN } from "@/utils/constants";
import paths from "@/utils/paths";
import { useModal } from "@/hooks/useModal";
import RecoveryCodeModal from "@/components/Modals/DisplayRecoveryCodeModal";
import { useTranslation } from "react-i18next";
import { AuthHeading, AuthInput } from "@/components/PublicLayout";

export default function SingleUserAuth({ redirectTo = paths.home() }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [downloadComplete, setDownloadComplete] = useState(false);
  const [token, setToken] = useState(null);
  const { isOpen, openModal, closeModal } = useModal();
  const handleLogin = async (event) => {
    event.preventDefault();
    if (loading) return;
    const form = new FormData(event.currentTarget);
    setError(null);
    setLoading(true);
    try {
      const result = await System.requestToken({
        password: form.get("password"),
      });
      if (!result.valid || !result.token) {
        setError(result.message || t("auth_page.failed"));
        return;
      }
      setToken(result.token);
      if (result.recoveryCodes?.length) {
        setRecoveryCodes(result.recoveryCodes);
        openModal();
      } else {
        localStorage.setItem(AUTH_TOKEN, result.token);
        window.location = redirectTo;
      }
    } catch {
      setError(t("auth_page.failed"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (downloadComplete && token) {
      localStorage.setItem(AUTH_TOKEN, token);
      window.location = redirectTo;
    }
  }, [downloadComplete, token, redirectTo]);
  return (
    <>
      <AuthHeading
        title={t("auth_page.login_title")}
        description={t("auth_page.login_description")}
      />
      <form onSubmit={handleLogin} className="auth-form">
        <AuthInput
          label={t("auth_page.password")}
          name="password"
          type="password"
          required
          autoComplete="current-password"
          disabled={loading}
        />
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
            loading ? "login.multi-user.validating" : "login.multi-user.login"
          )}
          <ArrowRight size={18} />
        </button>
      </form>
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
