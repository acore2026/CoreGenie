import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import System from "@/models/system";
import paths from "@/utils/paths";
import useLogo from "@/hooks/useLogo";
import { FullScreenLoader } from "@/components/Preloader";
import { useTranslation } from "react-i18next";
import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from "@/utils/username";

export default function Register() {
  const { t } = useTranslation();
  const { loginLogo, isCustomLogo } = useLogo();
  const [status, setStatus] = useState("loading");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    System.publicRegistrationStatus().then(({ enabled }) =>
      setStatus(enabled ? "ready" : "disabled")
    );
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await System.register({
      username: form.get("username"),
      password: form.get("password"),
      confirmPassword: form.get("confirmPassword"),
    });
    if (result.success) setStatus("complete");
    else setError(result.error || t("login.registration.failed"));
    setSubmitting(false);
  };

  if (status === "loading") return <FullScreenLoader />;
  if (status === "disabled") return <Navigate to={paths.login()} replace />;

  return (
    <div className="fixed inset-0 bg-zinc-950 light:bg-slate-50 flex flex-col items-center justify-center overflow-y-auto p-6">
      <img
        src={loginLogo}
        alt="Logo"
        className={`max-h-[80px] mb-7 ${isCustomLogo ? "rounded-lg" : ""}`}
        style={{ objectFit: "contain" }}
      />
      <div className="w-full max-w-[396px] rounded-2xl border border-zinc-800 light:border-slate-200 bg-zinc-900 light:bg-white p-8 shadow-2xl">
        {status === "complete" ? (
          <div className="flex flex-col items-center gap-y-5 text-center">
            <h1 className="text-2xl font-semibold text-white light:text-slate-950">
              {t("login.registration.complete-title")}
            </h1>
            <p className="text-sm text-zinc-400 light:text-zinc-600">
              {t("login.registration.complete-description")}
            </p>
            <Link
              to={paths.login(true)}
              className="w-full rounded-lg bg-white light:bg-sky-200 px-4 py-2 text-center text-sm font-semibold text-zinc-950 hover:bg-zinc-300 light:hover:bg-sky-300"
            >
              {t("login.registration.sign-in")}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-y-5">
            <div className="text-center">
              <h1 className="text-2xl font-semibold text-white light:text-slate-950">
                {t("login.registration.title")}
              </h1>
              <p className="mt-2 text-sm text-zinc-400 light:text-zinc-600">
                {t("login.registration.description")}
              </p>
            </div>
            <RegistrationInput
              label={t("login.multi-user.placeholder-username")}
              name="username"
              type="text"
              minLength={USERNAME_MIN_LENGTH}
              maxLength={USERNAME_MAX_LENGTH}
              pattern={USERNAME_PATTERN}
            />
            <RegistrationInput
              label={t("login.multi-user.placeholder-password")}
              name="password"
              type="password"
              minLength={8}
            />
            <RegistrationInput
              label={t("login.registration.confirm-password")}
              name="confirmPassword"
              type="password"
              minLength={8}
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="h-[38px] w-full rounded-lg bg-white light:bg-sky-200 text-sm font-semibold text-zinc-950 hover:bg-zinc-300 light:hover:bg-sky-300 disabled:cursor-wait disabled:opacity-60"
            >
              {submitting
                ? t("login.registration.creating")
                : t("login.registration.create-account")}
            </button>
            <Link
              to={paths.login(true)}
              className="text-center text-sm text-zinc-300 light:text-zinc-600 hover:text-sky-300 hover:underline"
            >
              {t("login.registration.already-have-account")}
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}

function RegistrationInput({ label, ...props }) {
  return (
    <label className="flex flex-col gap-y-2 text-sm text-zinc-300 light:text-slate-800">
      {label}
      <input
        {...props}
        required={true}
        autoComplete="off"
        className="h-[38px] rounded-lg border-none bg-zinc-800 light:bg-slate-100 px-3 text-sm text-zinc-200 light:text-slate-800 outline-none focus:ring-1 focus:ring-sky-300"
      />
    </label>
  );
}
