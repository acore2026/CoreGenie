import { useEffect, useState } from "react";
import { Code, FileText, Trash, UploadSimple } from "@phosphor-icons/react";
import PredefinedAgent from "@/models/predefinedAgent";
import showToast from "@/utils/toast";
import FullscreenEditor from "@/components/FullscreenEditor";
import {
  ModalShell,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  miniButtonClass,
} from "./Controls";
import type { Skill, SaveResult } from "@/models/predefinedAgentTypes";
import type { Scope, EditorActions } from "./types";

export default function SkillEditor({
  skill,
  scope,
  workspaceSlug,
  onClose,
  onSaved,
}: EditorActions & {
  skill: Skill | null;
  scope: Scope;
  workspaceSlug: string;
}) {
  const newSkillMd = `---\nname: new-skill\ndescription: Describe what this skill does and when the Agent should use it.\n---\n\n# New skill\n\nWrite the skill instructions here.\n`;
  const [skillMd, setSkillMd] = useState(skill?.skillMd || newSkillMd);
  const [files, setFiles] = useState(skill?.files || []);
  const [deletedPaths, setDeletedPaths] = useState<string[]>([]);
  const [selectedPath, setSelectedPath] = useState("SKILL.md");
  const [loading, setLoading] = useState(Boolean(skill));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!skill) return;
    const loader =
      scope === "workspace"
        ? PredefinedAgent.getWorkspaceSkill(workspaceSlug, skill.name)
        : PredefinedAgent.getSkill(skill.id);
    loader.then((result) => {
      if (!result.skill) showToast(result.error || "无法加载 Skill", "error");
      else {
        setSkillMd(result.skill.skillMd || newSkillMd);
        setFiles(result.skill.files || []);
      }
      setLoading(false);
    });
  }, [skill?.id, skill?.name, scope, workspaceSlug]);

  const selectedFile = files.find((file) => file.path === selectedPath);
  const currentName =
    skillMd.match(/^---[\s\S]*?\nname:\s*["']?([^\n"']+)/)?.[1]?.trim() ||
    skill?.name ||
    "new-skill";

  function updateSelected(content: string) {
    if (selectedPath === "SKILL.md") return setSkillMd(content);
    setFiles((current) =>
      current.map((file) =>
        file.path === selectedPath
          ? { ...file, content, encoding: "utf8", text: true }
          : file
      )
    );
  }

  function addTextFile(folder: string, extension: string) {
    const proposed = `${folder}/new-${folder === "scripts" ? "script" : "resource"}.${extension}`;
    const value = window.prompt("Package-relative file path", proposed)?.trim();
    if (!value || value === "SKILL.md") return;
    if (files.some((file) => file.path === value))
      return showToast("文件已经存在", "error");
    setFiles((current) => [
      ...current,
      { path: value, content: "", encoding: "utf8", text: true, size: 0 },
    ]);
    setDeletedPaths((current) => current.filter((path) => path !== value));
    setSelectedPath(value);
  }

  function deleteSelected() {
    if (selectedPath === "SKILL.md") return;
    setFiles((current) => current.filter((file) => file.path !== selectedPath));
    setDeletedPaths((current) => [...new Set([...current, selectedPath])]);
    setSelectedPath("SKILL.md");
  }

  async function addAsset(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const target = window
      .prompt("Package-relative asset path", `assets/${file.name}`)
      ?.trim();
    if (!target) return;
    const text =
      file.type.startsWith("text/") ||
      /\.(md|txt|json|ya?ml|csv|xml|html|css|js|ts|py|sh)$/i.test(file.name);
    const content = text
      ? await file.text()
      : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
    setFiles((current) => [
      ...current.filter((item) => item.path !== target),
      {
        path: target,
        content,
        encoding: text ? "utf8" : "base64",
        text,
        size: file.size,
      },
    ]);
    setDeletedPaths((current) => current.filter((path) => path !== target));
    setSelectedPath(target);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const payload = {
      skillMd,
      files: files
        .filter((file) => file.content != null)
        .map(({ path, content, encoding }) => ({ path, content, encoding })),
      deletedPaths,
      ...(scope === "workspace" && skill ? { previousName: skill.name } : {}),
    };
    const result: SaveResult =
      scope === "workspace"
        ? await PredefinedAgent.saveWorkspaceSkill(workspaceSlug, payload)
        : skill
          ? await PredefinedAgent.updateSkill(skill.id, payload)
          : await PredefinedAgent.createSkill(payload);
    if (!result.success) {
      showToast(result.error || "保存失败", "error");
      setSaving(false);
      return;
    }
    showToast(skill ? "Skill 已更新" : "Skill 已创建", "success");
    await onSaved();
  }

  async function remove() {
    if (!skill || !window.confirm(`删除 Skill“${skill.name}”？`)) return;
    const result: SaveResult =
      scope === "workspace"
        ? await PredefinedAgent.deleteWorkspaceSkill(workspaceSlug, skill.name)
        : await PredefinedAgent.deleteSkill(skill.id);
    if (!result.success) return showToast(result.error || "删除失败", "error");
    showToast("Skill 已删除", "success");
    await onSaved();
  }

  return (
    <ModalShell
      title={skill ? `编辑 ${skill.name}` : "新建 Skill"}
      subtitle={`${scope === "workspace" ? "Workspace · live" : "Global · versioned"} · Agent Skills specification`}
      onClose={onClose}
      wide
    >
      <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
        <div className="grid min-h-0 flex-1 md:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-r border-white/10 p-3 light:border-slate-200">
            <div className="mb-3 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => addTextFile("scripts", "py")}
                className={miniButtonClass}
              >
                <Code size={12} /> Python
              </button>
              <button
                type="button"
                onClick={() => addTextFile("scripts", "sh")}
                className={miniButtonClass}
              >
                <Code size={12} /> Bash
              </button>
              <button
                type="button"
                onClick={() => addTextFile("references", "md")}
                className={miniButtonClass}
              >
                <FileText size={12} /> Reference
              </button>
              <label className={`${miniButtonClass} cursor-pointer`}>
                <UploadSimple size={12} /> Asset
                <input type="file" className="hidden" onChange={addAsset} />
              </label>
            </div>
            {[{ path: "SKILL.md", text: true }, ...files].map((file) => (
              <button
                key={file.path}
                type="button"
                onClick={() => setSelectedPath(file.path)}
                className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${
                  selectedPath === file.path
                    ? "bg-amber-300/15 text-amber-200 light:text-amber-800"
                    : "text-theme-text-secondary hover:bg-white/5 light:hover:bg-slate-100"
                }`}
              >
                {file.path.startsWith("scripts/") ? (
                  <Code size={13} />
                ) : (
                  <FileText size={13} />
                )}
                <span className="min-w-0 flex-1 truncate font-mono">
                  {file.path}
                </span>
                {file.text === false && <span className="text-[9px]">BIN</span>}
              </button>
            ))}
          </aside>
          <section className="flex min-h-[440px] min-w-0 flex-col p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="m-0 truncate font-mono text-xs font-semibold text-theme-text-primary">
                  {selectedPath}
                </p>
                <p className="m-0 mt-1 text-[10px] text-theme-text-secondary">
                  {currentName} · changes become available on the next Agent
                  step
                </p>
              </div>
              {selectedPath !== "SKILL.md" && (
                <button
                  type="button"
                  onClick={deleteSelected}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  删除文件
                </button>
              )}
            </div>
            {loading ? (
              <div className="flex-1 animate-pulse rounded-xl bg-white/5 light:bg-slate-100" />
            ) : selectedPath === "SKILL.md" || selectedFile?.text !== false ? (
              <FullscreenEditor title={selectedPath}>
                <textarea
                  required={selectedPath === "SKILL.md"}
                  spellCheck={false}
                  value={
                    selectedPath === "SKILL.md"
                      ? skillMd
                      : selectedFile?.content || ""
                  }
                  onChange={(event) => updateSelected(event.target.value)}
                  className={`${inputClass} min-h-[360px] w-full resize-y whitespace-pre font-mono text-sm leading-6`}
                />
              </FullscreenEditor>
            ) : (
              <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-theme-text-secondary light:border-slate-300">
                Binary asset · {selectedFile?.size || 0} bytes
              </div>
            )}
            {!!skill?.warnings?.length && (
              <p className="mt-2 text-[10px] text-amber-300">
                {skill.warnings.join(" · ")}
              </p>
            )}
          </section>
        </div>
        <footer className="flex items-center justify-between border-t border-white/10 px-5 py-4 light:border-slate-200">
          <div>
            {skill && (
              <button
                type="button"
                onClick={remove}
                className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300"
              >
                <Trash size={14} /> 删除 Skill
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className={secondaryButtonClass}
            >
              取消
            </button>
            <button
              disabled={
                saving || loading || (scope === "workspace" && !workspaceSlug)
              }
              type="submit"
              className={primaryButtonClass}
            >
              {saving ? "保存中…" : "保存 Skill"}
            </button>
          </div>
        </footer>
      </form>
    </ModalShell>
  );
}
