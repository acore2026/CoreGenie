import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CaretRight, ListChecks, X } from "@phosphor-icons/react";
import {
  generatePrompt,
  maxSelections,
  missingFields,
  selectionLimitExceeded,
  updateAnswer,
  wizardTasks,
  visibleFields,
} from "@/utils/agentWizard.mjs";
import CatalogField from "./CatalogField";

const control =
  "dsh-control min-h-[40px] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button disabled:opacity-50 disabled:cursor-not-allowed hover:bg-theme-sidebar-subitem-hover";
const input =
  "w-full rounded-lg border border-theme-chat-input-border bg-theme-bg-chat-input p-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-primary-button";

function OptionList({ field, fieldId, answers, invalid, update, options }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {options.map((option) => {
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
              type={field.type === "multi" ? "checkbox" : "radio"}
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
                      : [...(answers[field.id] || []), option.value]
                )
              }
            />
            <span className="min-w-0">
              <span className="font-medium text-theme-text-primary">
                {option.label}
              </span>
              {option.description && (
                <span className="mt-1 block text-xs leading-5 text-theme-text-secondary">
                  {option.description}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function GroupedOptions(props) {
  const { field } = props;
  const [openGroups, setOpenGroups] = useState({});
  if (!field.optionGroups?.length)
    return <OptionList {...props} options={field.options} />;

  const rendered = new Set();
  const groups = field.optionGroups.map((group) => {
    const options = field.options.filter((option) => option.group === group.id);
    options.forEach((option) => rendered.add(option.value));
    return { ...group, options };
  });
  const ungrouped = field.options.filter(
    (option) => !rendered.has(option.value)
  );

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        if (!group.options.length) return null;
        if (group.collapsed)
          return (
            <details
              key={group.id}
              open={openGroups[group.id] ?? group.collapsed !== true}
              onToggle={(event) =>
                setOpenGroups((current) => ({
                  ...current,
                  [group.id]: event.currentTarget.open,
                }))
              }
              className="group rounded-lg border border-theme-chat-input-border bg-theme-bg-primary"
            >
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-button [&::-webkit-details-marker]:hidden">
                <CaretRight
                  size={16}
                  aria-hidden="true"
                  className="shrink-0 text-theme-text-secondary transition-transform duration-150 group-open:rotate-90"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-theme-text-primary">
                    {group.label}
                  </span>
                  {group.description && (
                    <span className="mt-0.5 block text-xs leading-5 text-theme-text-secondary">
                      {group.description}
                    </span>
                  )}
                </span>
              </summary>
              <div className="border-t border-theme-chat-input-border p-3">
                <OptionList {...props} options={group.options} />
              </div>
            </details>
          );
        return (
          <section key={group.id} aria-label={group.label}>
            <p className="mb-1 text-sm font-semibold text-theme-text-primary">
              {group.label}
            </p>
            {group.description && (
              <p className="mb-3 text-xs leading-5 text-theme-text-secondary">
                {group.description}
              </p>
            )}
            <OptionList {...props} options={group.options} />
          </section>
        );
      })}
      {!!ungrouped.length && <OptionList {...props} options={ungrouped} />}
    </div>
  );
}

// Keyed by Agent in the caller: an Agent change cannot reuse another form's answers.
export default function AgentWizard({ agent, disabled, onUse }) {
  const { t } = useTranslation();
  const tasks = wizardTasks(agent?.wizard);
  if (!tasks.length) return null;
  return (
    <section className="mb-3" aria-label={t("agent_wizard.open")}>
      <h2 className="mb-2 text-xs font-semibold text-theme-text-secondary">
        {t("agent_wizard.open")}
      </h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {tasks.map((wizard) => (
          <WizardTask
            key={wizard.id}
            agent={agent}
            wizard={wizard}
            disabled={disabled}
            onUse={onUse}
          />
        ))}
      </div>
    </section>
  );
}

function WizardTask({ agent, wizard, disabled, onUse }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState({});
  const [attempted, setAttempted] = useState(false);
  const [preview, setPreview] = useState(null);
  const dialog = useRef(null);
  const trigger = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (open && !disabled) dialog.current?.showModal();
    else dialog.current?.close();
    if (disabled) setOpen(false);
  }, [open, disabled]);

  const fields = visibleFields(wizard, answers);
  const missing = attempted ? missingFields(wizard, answers) : [];
  const update = (field, value) => {
    setAnswers((current) => updateAnswer(wizard, current, field.id, value));
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
        className="group flex min-h-[56px] min-w-0 items-center gap-2.5 rounded-lg border border-theme-chat-input-border bg-theme-bg-primary p-2.5 text-left hover:bg-theme-sidebar-subitem-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={wizard.title}
        onClick={() => setOpen(true)}
      >
        <ListChecks size={18} className="shrink-0 text-theme-text-secondary" />
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-theme-text-primary">
            {wizard.title}
          </span>
          {wizard.description && (
            <span className="mt-0.5 block text-xs leading-4 text-theme-text-secondary">
              {wizard.description}
            </span>
          )}
        </span>
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          aria-labelledby={titleId}
          onCancel={close}
          onClose={() => setOpen(false)}
          className="agent-task-wizard dsh-dialog m-auto max-h-[92dvh] w-[min(860px,calc(100vw-24px))] max-w-none p-0 text-theme-text-primary backdrop:bg-black/55"
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
            {open &&
              (preview !== null ? (
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
                      {["meeting", "agenda"].includes(field.type) ? (
                        <CatalogField
                          field={field}
                          answers={answers}
                          invalid={invalid}
                          onChange={(value) => update(field, value)}
                        />
                      ) : field.options ? (
                        <GroupedOptions
                          field={field}
                          fieldId={fieldId}
                          answers={answers}
                          invalid={invalid}
                          update={update}
                        />
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
                          onChange={(event) =>
                            update(field, event.target.value)
                          }
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
                          onChange={(event) =>
                            update(field, event.target.value)
                          }
                        />
                      )}
                      {!!field.examples?.length &&
                        !["meeting", "agenda"].includes(field.type) && (
                          <p className="mt-2 text-xs leading-5 text-theme-text-secondary">
                            {t("agent_wizard.examples", {
                              examples: field.examples.join("；"),
                            })}
                          </p>
                        )}
                      {invalid && (
                        <p
                          id={`${fieldId}-error`}
                          className="mt-2 text-xs text-theme-text-secondary"
                          role="alert"
                        >
                          {selectionLimitExceeded(field, answers)
                            ? t("agent_wizard.too_many_meetings", {
                                count: maxSelections(field, answers),
                              })
                            : t("agent_wizard.missing")}
                        </p>
                      )}
                    </fieldset>
                  );
                })
              ))}
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
