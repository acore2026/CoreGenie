import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  ListChecks,
  Paperclip,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import useLogo from "@/hooks/useLogo";
import paths from "@/utils/paths";
import "./public.css";

export function PublicBrand() {
  const { t } = useTranslation();
  const { loginLogo } = useLogo();
  return (
    <Link
      to={paths.landing()}
      className="public-brand"
      aria-label={t("public_page.home")}
    >
      <img src={loginLogo} alt="CoreGenie" />
    </Link>
  );
}

export function WorkPreview({ compact = false }) {
  const { t } = useTranslation();
  return (
    <div
      className={`work-preview ${compact ? "work-preview-compact" : ""}`}
      aria-label={t("public_page.preview_label")}
    >
      <div className="work-preview-bar">
        <span className="work-preview-dot" />
        <span>{t("public_page.preview_workspace")}</span>
        <span className="ml-auto text-xs">{t("public_page.example")}</span>
      </div>
      <div className="work-preview-body">
        <div className="work-preview-request">
          <span className="public-eyebrow">{t("public_page.your_task")}</span>
          <p>{t("public_page.sample_prompt")}</p>
          <span className="work-preview-file">
            <Paperclip size={14} />
            {t("public_page.sample_source")}
          </span>
        </div>
        <div className="work-preview-plan">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <ListChecks size={16} />
            {t("task_plan.title")}
            <span className="ml-auto font-mono text-theme-text-secondary">
              3 / 3
            </span>
          </div>
          <ol>
            {["read", "compare", "write"].map((step, i) => (
              <li key={step}>
                <span className="work-preview-check">
                  <Check size={12} />
                </span>
                <span>{t(`public_page.steps.${step}`)}</span>
                <span className="ml-auto font-mono text-[10px] text-theme-text-secondary">
                  0{i + 1}
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="work-preview-result">
          <FileText size={25} weight="duotone" />
          <div>
            <strong>{t("public_page.sample_result")}</strong>
            <span>{t("public_page.sample_result_hint")}</span>
          </div>
          <ArrowRight className="ml-auto shrink-0" size={18} />
        </div>
      </div>
      <div className="work-preview-caption">
        {t("public_page.preview_caption")}
      </div>
    </div>
  );
}

export default function PublicLayout({ children }: React.PropsWithChildren) {
  const { t } = useTranslation();
  return (
    <div className="public-page auth-page">
      <header className="public-header">
        <PublicBrand />
        <Link to={paths.landing()} className="public-text-link">
          <ArrowLeft size={16} />
          {t("public_page.back_home")}
        </Link>
      </header>
      <main className="auth-layout">
        <section className="auth-story">
          <span className="public-eyebrow">{t("public_page.eyebrow")}</span>
          <h1>
            {t("public_page.auth_title")}
            <br />
            <span>{t("public_page.auth_title_end")}</span>
          </h1>
          <p>{t("public_page.auth_description")}</p>
          <WorkPreview compact />
        </section>
        <section className="auth-form-surface">
          <div className="auth-form-inner">{children}</div>
        </section>
      </main>
      <footer className="public-footer">
        <span>CoreGenie</span>
        <span>{t("public_page.footer")}</span>
      </footer>
    </div>
  );
}

export function AuthHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="auth-heading">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

export function AuthInput({
  label,
  hint,
  id,
  name,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
}) {
  const inputId = id || `auth-${name}`;
  return (
    <div className="auth-field">
      <label htmlFor={inputId}>{label}</label>
      <input
        {...props}
        id={inputId}
        name={name}
        aria-describedby={hint ? `${inputId}-hint` : undefined}
      />
      {hint && <p id={`${inputId}-hint`}>{hint}</p>}
    </div>
  );
}
