import { Buildings, Eye, LockKey } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const OPTIONS = [
  { value: "private", icon: LockKey },
  { value: "public_readonly", icon: Eye },
  { value: "public_collaborative", icon: Buildings },
];

export default function WorkspaceAccess({ workspace, setHasChanges }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(workspace.accessMode || "private");

  useEffect(() => {
    setCurrent(workspace.accessMode || "private");
  }, [workspace.accessMode]);

  return (
    <section className="w-full max-w-3xl">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-theme-text-primary">
          {t("general.access.title")}
        </h3>
        <p className="mt-1 text-xs leading-5 text-theme-text-secondary">
          {t("general.access.description")}
        </p>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {OPTIONS.map(({ value, icon: Icon }) => {
          const selected = current === value;
          return (
            <label
              key={value}
              className={`relative cursor-pointer rounded-xl border p-4 transition-[background-color,border-color,transform] duration-150 focus-within:ring-2 focus-within:ring-cyan-400/45 active:scale-[0.99] ${
                selected
                  ? "border-cyan-400/45 bg-cyan-400/[0.07]"
                  : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04] light:border-slate-300 light:bg-slate-50 light:hover:border-slate-400"
              }`}
            >
              <input
                type="radio"
                name="accessMode"
                value={value}
                checked={selected}
                onChange={(event) => {
                  workspace.accessMode = event.target.value;
                  setCurrent(event.target.value);
                  setHasChanges(true);
                }}
                className="sr-only"
              />
              <span className="flex items-start gap-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                    selected
                      ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-300 light:text-cyan-700"
                      : "border-white/10 text-theme-text-secondary light:border-slate-300"
                  }`}
                >
                  <Icon size={18} weight="duotone" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-theme-text-primary">
                    {t(`general.access.${value}.title`)}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-theme-text-secondary">
                    {t(`general.access.${value}.description`)}
                  </span>
                </span>
              </span>
              <span
                aria-hidden="true"
                className={`absolute right-3 top-3 h-2 w-2 rounded-full ${
                  selected ? "bg-cyan-400" : "bg-transparent"
                }`}
              />
            </label>
          );
        })}
      </div>
    </section>
  );
}
