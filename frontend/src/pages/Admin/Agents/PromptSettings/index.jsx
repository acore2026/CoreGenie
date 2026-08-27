import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isMobile } from "react-device-detect";
import { GlobeHemisphereWest, Robot, UserCircle } from "@phosphor-icons/react";
import Sidebar from "@/components/SettingsSidebar";
import Admin from "@/models/admin";
import showToast from "@/utils/toast";

const MAX_PROMPT_LENGTH = 40_000;

export default function AgentPromptSettings() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState("");
  const [savedPrompt, setSavedPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    Admin.systemPreferencesByFields(["global_system_prompt"]).then((result) => {
      if (!active) return;
      const value = result?.settings?.global_system_prompt || "";
      setPrompt(value);
      setSavedPrompt(value);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  async function savePrompt(event) {
    event.preventDefault();
    setSaving(true);
    const result = await Admin.updateSystemPreferences({
      global_system_prompt: prompt,
    });
    setSaving(false);
    if (!result?.success)
      return showToast(result?.error || t("agent_prompts.save_error"), "error");
    setSavedPrompt(prompt.trim());
    setPrompt(prompt.trim());
    showToast(t("agent_prompts.saved"), "success", { clear: true });
  }

  const changed = prompt !== savedPrompt;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-theme-bg-container md:mt-0 mt-6">
      <Sidebar />
      <main
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="relative flex w-full flex-col overflow-hidden md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px]"
      >
        <form
          onSubmit={savePrompt}
          className="flex h-full flex-col overflow-y-auto bg-theme-bg-secondary px-5 pb-8 pt-14 text-theme-text-primary md:px-8"
        >
          <header className="mx-auto w-full max-w-5xl border-b border-white/[0.08] pb-6 light:border-slate-200">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-300/10 text-cyan-300 light:bg-cyan-50 light:text-cyan-700">
                <GlobeHemisphereWest size={22} weight="duotone" />
              </span>
              <div>
                <h1 className="text-xl font-semibold">
                  {t("agent_prompts.title")}
                </h1>
                <p className="mt-1 text-xs text-theme-text-secondary">
                  {t("agent_prompts.description")}
                </p>
              </div>
            </div>
          </header>

          <div className="mx-auto mt-6 grid w-full max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 light:border-slate-200 light:bg-white">
              <div className="flex items-center justify-between gap-4">
                <label
                  htmlFor="global-system-prompt"
                  className="text-sm font-semibold"
                >
                  {t("agent_prompts.global_label")}
                </label>
                <span className="text-[11px] tabular-nums text-theme-text-secondary">
                  {prompt.length.toLocaleString()} /{" "}
                  {MAX_PROMPT_LENGTH.toLocaleString()}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-5 text-theme-text-secondary">
                {t("agent_prompts.global_help")}
              </p>
              <textarea
                id="global-system-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                maxLength={MAX_PROMPT_LENGTH}
                disabled={loading || saving}
                placeholder={t("agent_prompts.placeholder")}
                className="mt-4 min-h-[360px] w-full resize-y rounded-xl border border-white/10 bg-theme-settings-input-bg p-4 text-sm leading-6 text-theme-text-primary outline-none transition placeholder:text-theme-settings-input-placeholder focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/10 light:border-slate-300"
              />
              <div className="mt-4 flex justify-end">
                <button
                  type="submit"
                  disabled={loading || saving || !changed}
                  className="h-10 rounded-xl bg-cyan-300 px-5 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </section>

            <aside className="h-fit rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 light:border-slate-200 light:bg-white">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-theme-text-secondary">
                {t("agent_prompts.stack_title")}
              </p>
              <div className="mt-4 space-y-2">
                <PromptLayer
                  icon={GlobeHemisphereWest}
                  index="1"
                  title={t("agent_prompts.layer_global")}
                  detail={t("agent_prompts.layer_global_detail")}
                  accent="cyan"
                />
                <PromptLayer
                  icon={Robot}
                  index="2"
                  title={t("agent_prompts.layer_agent")}
                  detail={t("agent_prompts.layer_agent_detail")}
                  accent="violet"
                />
                <PromptLayer
                  icon={UserCircle}
                  index="3"
                  title={t("agent_prompts.layer_user")}
                  detail={t("agent_prompts.layer_user_detail")}
                  accent="amber"
                />
              </div>
            </aside>
          </div>
        </form>
      </main>
    </div>
  );
}

function PromptLayer({ icon: Icon, index, title, detail, accent }) {
  const colors = {
    cyan: "bg-cyan-300/10 text-cyan-300 light:bg-cyan-50 light:text-cyan-700",
    violet:
      "bg-violet-300/10 text-violet-300 light:bg-violet-50 light:text-violet-700",
    amber:
      "bg-amber-300/10 text-amber-300 light:bg-amber-50 light:text-amber-700",
  };
  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/[0.06] p-3 light:border-slate-200">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${colors[accent]}`}
      >
        <Icon size={16} weight="duotone" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold">
          <span className="mr-1.5 text-theme-text-secondary">{index}.</span>
          {title}
        </p>
        <p className="mt-1 text-[11px] leading-4 text-theme-text-secondary">
          {detail}
        </p>
      </div>
    </div>
  );
}
