import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ListChecks, X } from "@phosphor-icons/react";
import {
  generatePrompt,
  missingFields,
  pruneAnswers,
  visibleFields,
} from "@/utils/agentWizard.mjs";

const control =
  "dsh-control min-h-[40px] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button disabled:opacity-50 disabled:cursor-not-allowed hover:bg-theme-sidebar-subitem-hover";
const input =
  "w-full rounded-lg border border-theme-chat-input-border bg-theme-bg-chat-input p-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-primary-button";

// Keyed by Agent in the caller: an Agent change cannot reuse another form's answers.
export default function AgentWizard({ agent, disabled, onUse }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState({});
  const [attempted, setAttempted] = useState(false);
  const [preview, setPreview] = useState(null);
  const dialog = useRef(null);
  const trigger = useRef(null);
  const titleId = useId();
  const wizard = agent?.wizard;

  useEffect(() => {
    if (open && !disabled) dialog.current?.showModal();
    else dialog.current?.close();
    if (disabled) setOpen(false);
  }, [open, disabled]);

  if (!wizard) return null;
  const fields = visibleFields(wizard, answers);
  const missing = attempted ? missingFields(wizard, answers) : [];
  const update = (field, value) => {
    setAnswers((current) =>
      pruneAnswers(wizard, { ...current, [field.id]: value })
    );
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const review = () => {
    setAttempted(true);
    const prompt = generatePrompt(wizard, answers);
    if (prompt === null) {
      requestAnimationFrame(() =>
        dialog.current?.querySelector('[aria-invalid="true"]')?.focus()
      );
      return;
    }
    setPreview(prompt);
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        className={`${control} inline-flex items-center gap-2 whitespace-nowrap`}
        onClick={() => setOpen(true)}
      >
        <ListChecks size={16} />
        {t("agent_wizard.open")}
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          aria-labelledby={titleId}
          onCancel={close}
          onClose={() => setOpen(false)}
          className="agent-task-wizard dsh-dialog m-auto max-h-[90dvh] w-[min(640px,calc(100vw-24px))] max-w-none p-0 text-theme-text-primary backdrop:bg-black/55"
        >
          <div className="flex items-start justify-between gap-4 border-b border-theme-chat-input-border p-5">
            <div className="min-w-0">
              <p className="text-xs text-theme-text-secondary">{agent.name}</p>
              <h2 id={titleId} className="mt-1 text-lg font-semibold">
                {wizard.title}
              </h2>
              <p className="mt-2 text-sm text-theme-text-secondary">
                {t("agent_wizard.hint")}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className={control}
              aria-label={t("agent_wizard.close")}
            >
              <X size={18} />
            </button>
          </div>
          <div className="space-y-6 p-5">
            {preview !== null ? (
              <label className="block text-sm font-medium">
                {t("agent_wizard.preview")}
                <textarea
                  className={`${input} mt-2 min-h-[280px] resize-y`}
                  value={preview}
                  maxLength={40000}
                  onChange={(event) => setPreview(event.target.value)}
                />
              </label>
            ) : (
              fields.map((field) => {
                const invalid = missing.some((item) => item.id === field.id);
                const fieldId = `${titleId}-${field.id}`;
                const label = (
                  <>
                    {field.label}
                    {field.required && (
                      <span className="ml-2 text-xs font-normal text-theme-text-secondary">
                        {t("agent_wizard.required")}
                      </span>
                    )}
                  </>
                );
                return (
                  <fieldset key={field.id} className="min-w-0">
                    <legend className="mb-2 text-sm font-semibold">
                      {label}
                    </legend>
                    {field.hint && (
                      <p
                        id={`${fieldId}-hint`}
                        className="mb-3 text-xs leading-5 text-theme-text-secondary"
                      >
                        {field.hint}
                      </p>
                    )}
                    {field.options ? (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {field.options.map((option) => {
                          const checked =
                            field.type === "multi"
                              ? (answers[field.id] || []).includes(option.value)
                              : answers[field.id] === option.value;
                          return (
                            <label
                              key={option.value}
                              className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-theme-chat-input-border px-3 py-2 text-sm hover:bg-theme-sidebar-subitem-hover focus-within:ring-2 focus-within:ring-primary-button"
                            >
                              <input
                                type={
                                  field.type === "multi" ? "checkbox" : "radio"
                                }
                                name={fieldId}
                                value={option.value}
                                checked={checked}
                                aria-invalid={invalid}
                                aria-describedby={
                                  invalid
                                    ? `${fieldId}-error`
                                    : field.hint
                                      ? `${fieldId}-hint`
                                      : undefined
                                }
                                onChange={() =>
                                  update(
                                    field,
                                    field.type === "single"
                                      ? option.value
                                      : checked
                                        ? answers[field.id].filter(
                                            (value) => value !== option.value
                                          )
                                        : [
                                            ...(answers[field.id] || []),
                                            option.value,
                                          ]
                                  )
                                }
                              />
                              <span>{option.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : field.type === "textarea" ? (
                      <textarea
                        aria-label={field.label}
                        className={`${input} min-h-[100px] resize-y`}
                        value={answers[field.id] || ""}
                        maxLength={4000}
                        placeholder={field.placeholder}
                        aria-invalid={invalid}
                        aria-describedby={
                          invalid ? `${fieldId}-error` : undefined
                        }
                        onChange={(event) => update(field, event.target.value)}
                      />
                    ) : (
                      <input
                        aria-label={field.label}
                        type="text"
                        className={input}
                        value={answers[field.id] || ""}
                        maxLength={4000}
                        placeholder={field.placeholder}
                        aria-invalid={invalid}
                        aria-describedby={
                          invalid ? `${fieldId}-error` : undefined
                        }
                        onChange={(event) => update(field, event.target.value)}
                      />
                    )}
                    {invalid && (
                      <p
                        id={`${fieldId}-error`}
                        className="mt-2 text-xs text-theme-text-secondary"
                        role="alert"
                      >
                        {t("agent_wizard.missing")}
                      </p>
                    )}
                  </fieldset>
                );
              })
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-theme-chat-input-border p-5">
            {preview !== null && (
              <button
                type="button"
                className={control}
                onClick={() => setPreview(null)}
              >
                {t("agent_wizard.back")}
              </button>
            )}
            <button type="button" className={control} onClick={close}>
              {t("agent_wizard.close")}
            </button>
            <button
              type="button"
              disabled={disabled || (preview !== null && !preview.trim())}
              className="min-h-[40px] rounded-md bg-primary-button px-4 text-sm font-semibold text-zinc-950 transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button focus-visible:ring-offset-2 focus-visible:ring-offset-theme-bg-primary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={
                preview === null
                  ? review
                  : () => {
                      close();
                      onUse(preview);
                    }
              }
            >
              {t(
                preview === null ? "agent_wizard.generate" : "agent_wizard.use"
              )}
            </button>
          </div>
        </dialog>,
        document.body
      )}
    </>
  );
}
