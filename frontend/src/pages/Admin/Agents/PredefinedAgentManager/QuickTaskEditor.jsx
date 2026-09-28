import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import PredefinedAgent from "@/models/predefinedAgent";
import AgentWizard from "@/components/PredefinedAgents/AgentWizard";

const control =
  "dsh-control min-h-[40px] px-3 text-sm hover:bg-theme-sidebar-subitem-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button disabled:cursor-not-allowed disabled:opacity-50";
const input =
  "mt-2 w-full rounded-lg border border-theme-chat-input-border bg-theme-bg-chat-input p-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-primary-button disabled:opacity-50";

export default function QuickTaskEditor({ task, onClose, onSaved }) {
  const { t } = useTranslation();
  const dialog = useRef(null);
  const [key, setKey] = useState(task?.key || "");
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [instructions, setInstructions] = useState(
    task?.definition?.instructions || ""
  );
  const [fields, setFields] = useState(
    JSON.stringify(
      task?.definition?.fields || [
        {
          id: "request",
          type: "textarea",
          label: t("quick_tasks.example_question"),
          required: true,
        },
      ],
      null,
      2
    )
  );
  const [archived, setArchived] = useState(task?.archived || false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [prompt, setPrompt] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    setPreview(null);
    setPrompt("");
  }, [key, title, description, instructions, fields]);

  async function submit(save) {
    setError("");
    let payload;
    try {
      payload = {
        key,
        title,
        description,
        archived,
        definition: {
          ...task?.definition,
          version: 1,
          instructions,
          fields: JSON.parse(fields),
        },
      };
    } catch {
      setError(t("quick_tasks.invalid_json"));
      return;
    }
    setBusy(true);
    try {
      const result = save
        ? task
          ? await PredefinedAgent.updateQuickTask(task.id, payload)
          : await PredefinedAgent.createQuickTask(payload)
        : await PredefinedAgent.validateQuickTask(payload);
      if (!result.success) {
        setError(result.error || t("quick_tasks.save_error"));
        return;
      }
      if (save) {
        await onSaved();
        onClose();
      } else setPreview(result.definition);
    } catch {
      setError(t("quick_tasks.save_error"));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby="quick-task-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="dsh-dialog m-auto max-h-[92dvh] w-[min(1040px,calc(100vw-24px))] max-w-none overflow-y-auto p-0 text-theme-text-primary backdrop:bg-black/55"
    >
      <header className="flex items-start justify-between gap-4 border-b border-theme-chat-input-border p-5">
        <div>
          <h2 id="quick-task-editor-title" className="text-lg font-semibold">
            {t(task ? "quick_tasks.edit" : "quick_tasks.create")}
          </h2>
          <p className="mt-2 text-sm text-theme-text-secondary">
            {t("quick_tasks.edit_hint")}
          </p>
        </div>
        <button
          type="button"
          className={control}
          disabled={busy}
          onClick={onClose}
        >
          {t("quick_tasks.close")}
        </button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(true);
        }}
        className="space-y-5 p-5"
      >
        <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="text-sm">
            {t("quick_tasks.name")}
            <input
              className={input}
              required
              maxLength={100}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="text-sm">
            {t("quick_tasks.key")}
            <input
              className={input}
              required
              disabled={!!task}
              maxLength={40}
              pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*"
              placeholder="proposal-review"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            {t("quick_tasks.summary")}
            <input
              className={input}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            {t("quick_tasks.instructions")}
            <textarea
              className={input}
              required
              rows={4}
              maxLength={4000}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </label>
          <label className="flex min-h-[40px] items-center gap-3 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={!archived}
              onChange={(e) => setArchived(!e.target.checked)}
            />
            {t("quick_tasks.enabled")}
          </label>
        </fieldset>
        <section className="space-y-3">
          <h3 className="font-medium">{t("quick_tasks.fields")}</h3>
          <p className="text-sm leading-6 text-theme-text-secondary">
            {t("quick_tasks.fields_hint")}
          </p>
          <label className="block text-sm">
            {t("quick_tasks.fields_json")}
            <textarea
              className={`${input} font-mono text-xs`}
              disabled={busy}
              rows={14}
              spellCheck={false}
              value={fields}
              onChange={(e) => setFields(e.target.value)}
            />
          </label>
          <button
            className={control}
            disabled={busy}
            type="button"
            onClick={() => submit(false)}
          >
            {t("quick_tasks.preview")}
          </button>
          {preview && (
            <AgentWizard
              key={JSON.stringify(preview)}
              agent={{
                name: t("quick_tasks.preview_label"),
                wizard: [preview],
              }}
              onUse={setPrompt}
            />
          )}
          {prompt && (
            <label className="block text-sm">
              {t("quick_tasks.prompt")}
              <textarea readOnly rows={8} className={input} value={prompt} />
            </label>
          )}
        </section>
        {error && (
          <p role="alert" className="text-sm text-theme-text-primary">
            {error}
          </p>
        )}
        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-theme-chat-input-border pt-4">
          <button
            type="button"
            className={control}
            disabled={busy}
            onClick={onClose}
          >
            {t("quick_tasks.cancel")}
          </button>
          <button className={`${control} font-semibold`} disabled={busy}>
            {t(busy ? "quick_tasks.saving" : "quick_tasks.save")}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body
  );
}
