import { useEffect, useRef, useState } from "react";
import {
  Globe,
  LockSimple,
  Plus,
  Sparkle,
  UserCircle,
} from "@phosphor-icons/react";
import { isMobile } from "react-device-detect";
import { useTranslation } from "react-i18next";
import Sidebar, { SidebarMobileHeader } from "@/components/Sidebar";
import Toggle from "@/components/lib/Toggle";
import PersonalSkills from "@/models/personalSkills";
import SkillEditor from "@/pages/Admin/Agents/PredefinedAgentManager/SkillEditor";
import showToast from "@/utils/toast";

const primary =
  "inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-50";
const secondary =
  "inline-flex min-h-[40px] items-center justify-center rounded-lg border border-theme-sidebar-border px-4 py-2 text-sm text-theme-text-primary hover:bg-theme-sidebar-item-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-50";

export function SkillLibrary() {
  const { t } = useTranslation();
  const [view, setView] = useState("mine");
  const [skills, setSkills] = useState([]);
  const [template, setTemplate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(null);
  const [editor, setEditor] = useState(null);
  const requestId = useRef(0);
  useEffect(() => {
    const current = ++requestId.current;
    setLoading(true);
    setError("");
    PersonalSkills.list(view).then((result) => {
      if (current !== requestId.current) return;
      if (!result.success) {
        setSkills([]);
        setError(result.error || t("personal_skills.load_error"));
      } else {
        setSkills(result.skills || []);
        setTemplate(result.template || "");
      }
      setLoading(false);
    });
    return () => {
      requestId.current++;
    };
  }, [view, refresh, t]);

  async function mutate(skill, action, value) {
    if (busy !== null) return false;
    setBusy(skill.id);
    const result = await PersonalSkills[action](skill.id, value);
    setBusy(null);
    if (!result.success) {
      showToast(result.error || t("personal_skills.action_error"), "error");
      return false;
    }
    showToast(
      t(
        `personal_skills.${
          action === "share"
            ? value
              ? "shared_toast"
              : "private_toast"
            : value
              ? "enabled_toast"
              : "disabled_toast"
        }`
      ),
      "success"
    );
    setRefresh((value) => value + 1);
    return true;
  }
  const query = search.trim().toLocaleLowerCase();
  const visible = skills.filter((skill) =>
    [skill.name, skill.description, skill.owner?.username].some((value) =>
      String(value || "")
        .toLocaleLowerCase()
        .includes(query)
    )
  );
  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <Sparkle
              size={28}
              weight="duotone"
              className="text-cyan-600 dark:text-cyan-300"
            />
            <h1 className="text-2xl font-semibold">
              {t("personal_skills.title")}
            </h1>
          </div>
          <p className="mt-3 text-sm leading-6 text-theme-text-secondary">
            {t("personal_skills.description")}
          </p>
        </div>
        <button
          type="button"
          className={primary}
          disabled={!template || loading || !!error}
          onClick={() => setEditor({ skill: null, readOnly: false })}
        >
          <Plus size={18} />
          {t("personal_skills.create")}
        </button>
      </header>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-theme-sidebar-border pb-4">
        <nav
          className="flex flex-wrap gap-2"
          aria-label={t("personal_skills.views")}
        >
          {["mine", "shared", "enabled"].map((tab) => (
            <button
              type="button"
              key={tab}
              aria-pressed={view === tab}
              onClick={() => {
                setView(tab);
                setSearch("");
              }}
              className={view === tab ? primary : secondary}
            >
              {t(`personal_skills.${tab}`)}
            </button>
          ))}
        </nav>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label={t("personal_skills.search")}
          placeholder={t("personal_skills.search")}
          className="h-10 w-full rounded-lg border border-theme-sidebar-border bg-theme-bg-chat px-3 text-sm outline-none focus:ring-2 focus:ring-cyan-500 sm:w-64"
        />
      </div>
      <p className="my-4 text-sm leading-6 text-theme-text-secondary">
        {t(`personal_skills.${view}_hint`)}
      </p>
      {loading ? (
        <p
          role="status"
          className="py-12 text-center text-theme-text-secondary"
        >
          {t("personal_skills.loading")}
        </p>
      ) : error ? (
        <div role="alert" className="rounded-xl border border-red-400/40 p-5">
          <p>{error}</p>
          <button
            type="button"
            className={secondary + " mt-3"}
            onClick={() => setRefresh((v) => v + 1)}
          >
            {t("personal_skills.retry")}
          </button>
        </div>
      ) : !visible.length ? (
        <div className="rounded-xl border border-dashed border-theme-sidebar-border px-5 py-12 text-center text-theme-text-secondary">
          <Sparkle size={32} className="mx-auto mb-3" />
          <p>
            {t(
              search
                ? "personal_skills.no_matches"
                : `personal_skills.empty_${view}`
            )}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map((skill) => (
            <article
              key={skill.id}
              aria-label={skill.name}
              className="flex min-w-0 flex-col rounded-xl border border-theme-sidebar-border bg-theme-bg-secondary p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs text-theme-text-secondary">
                  <UserCircle size={16} />
                  {skill.owner?.username}
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-theme-bg-chat px-2 py-1 text-xs text-theme-text-secondary">
                  {skill.isShared ? (
                    <Globe size={14} />
                  ) : (
                    <LockSimple size={14} />
                  )}
                  {t(
                    skill.isShared
                      ? "personal_skills.shared_badge"
                      : "personal_skills.private_badge"
                  )}
                </span>
              </div>
              <h2 className="mt-4 break-words text-lg font-semibold">
                {skill.name}
              </h2>
              <p className="mt-2 flex-1 break-words whitespace-pre-wrap text-sm leading-6 text-theme-text-secondary">
                {skill.description}
              </p>
              {skill.isOwner && (
                <div className="mt-4 border-t border-theme-sidebar-border pt-4">
                  <Toggle
                    variant="horizontal"
                    size="lg"
                    label={t("personal_skills.share")}
                    description={t("personal_skills.share_hint")}
                    enabled={skill.isShared}
                    disabled={busy !== null}
                    onChange={(value) => mutate(skill, "share", value)}
                    labelClassName="!text-sm"
                    descriptionClassName="!text-xs !leading-5"
                  />
                </div>
              )}
              <footer className="mt-5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={secondary}
                  onClick={() => setEditor({ skill, readOnly: !skill.isOwner })}
                >
                  {t(
                    skill.isOwner
                      ? "personal_skills.edit"
                      : "personal_skills.preview"
                  )}
                </button>
                {!skill.isOwner && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    className={skill.enabled ? secondary : primary}
                    onClick={() => mutate(skill, "enable", !skill.enabled)}
                  >
                    {t(
                      busy === skill.id
                        ? "personal_skills.saving"
                        : skill.enabled
                          ? "personal_skills.disable"
                          : "personal_skills.enable"
                    )}
                  </button>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
      {editor && (
        <SkillEditor
          skill={editor.skill}
          scope="personal"
          workspaceSlug=""
          initialSkillMd={template}
          readOnly={editor.readOnly}
          onEnable={async () => {
            if (await mutate(editor.skill, "enable", !editor.skill.enabled))
              setEditor(null);
          }}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            setRefresh((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}
export default function PersonalSkillsPage() {
  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-theme-bg-chat text-theme-text-primary">
      {isMobile ? <SidebarMobileHeader /> : <Sidebar />}
      <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-12 pt-24 md:px-8 md:pt-8">
        <SkillLibrary />
      </main>
    </div>
  );
}
