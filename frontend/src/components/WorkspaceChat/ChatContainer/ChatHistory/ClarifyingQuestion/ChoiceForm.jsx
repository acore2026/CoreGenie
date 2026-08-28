import { useTranslation } from "react-i18next";

function OptionButton({ label, description, index, selected, onClick }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`border-none w-full flex items-center gap-[9px] p-2 rounded-lg text-left transition-colors ${
        selected
          ? "bg-zinc-800 light:bg-slate-200"
          : "bg-transparent hover:bg-zinc-800/60 light:hover:bg-slate-200/60"
      }`}
    >
      <span className="flex items-center justify-center shrink-0 w-7 h-7 rounded-lg bg-zinc-700 light:bg-slate-300 text-white light:text-slate-900 text-base font-medium leading-6">
        {index + 1}
      </span>
      <span className="flex flex-col min-w-0">
        <span className="text-white light:text-slate-900 text-sm leading-5">
          {label}
        </span>
        {description && (
          <span className="text-xs text-zinc-400 light:text-slate-500 leading-4">
            {description}
          </span>
        )}
      </span>
    </button>
  );
}

function CustomAnswerRow({ index, selected, onToggle, allowSkip, onSkip }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center w-full">
      <button
        type="button"
        aria-pressed={selected}
        onClick={onToggle}
        className={`border-none flex flex-1 min-w-0 items-center gap-[9px] p-2 rounded-lg text-left transition-colors ${
          selected
            ? "bg-zinc-800 light:bg-slate-200"
            : "bg-transparent hover:bg-zinc-800/60 light:hover:bg-slate-200/60"
        }`}
      >
        <span className="flex items-center justify-center shrink-0 w-7 h-7 rounded-lg bg-zinc-700 light:bg-slate-300 text-white light:text-slate-900 text-base font-medium leading-6">
          {index + 1}
        </span>
        <span className="flex flex-col min-w-0">
          <span
            className={`text-sm leading-5 ${
              selected
                ? "text-white light:text-slate-900"
                : "text-zinc-300 light:text-slate-700"
            }`}
          >
            {t("chat_window.agent_invocation.clarifying_custom_answer")}
          </span>
          <span className="text-xs text-zinc-400 light:text-slate-500 leading-4">
            {t("chat_window.agent_invocation.clarifying_custom_hint")}
          </span>
        </span>
      </button>
      {allowSkip && <SkipButton onClick={onSkip} />}
    </div>
  );
}

function SkipButton({ onClick }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className="border border-solid border-zinc-600 light:border-slate-300 bg-transparent rounded-lg h-10 px-3 flex items-center justify-center text-white light:text-slate-900 text-xs font-medium leading-4 shrink-0 hover:bg-zinc-700/40 light:hover:bg-slate-200/60"
    >
      {t("chat_window.agent_invocation.batch_skip_this")}
    </button>
  );
}

function NotesInput({ value, onChange }) {
  const { t } = useTranslation();
  return (
    <label className="mt-2 flex flex-col gap-2 text-xs font-medium text-zinc-300 light:text-slate-700">
      {t("chat_window.agent_invocation.clarifying_notes")}
      <textarea
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t(
          "chat_window.agent_invocation.clarifying_notes_placeholder"
        )}
        className="w-full min-h-20 resize-y border border-solid border-zinc-700 light:border-slate-400 bg-zinc-800 light:bg-white text-white light:text-slate-900 placeholder:text-zinc-500 light:placeholder:text-slate-500 text-sm font-normal leading-5 rounded-lg focus:outline-white light:focus:outline-slate-500 outline-none px-3 py-2"
      />
    </label>
  );
}

/**
 * Numbered-card choice list. Supports single-select (click auto-advances via
 * onAutoAdvance) and multi-select (clicks toggle selection, parent owns the
 * submit step). A fourth "Custom answer" row reveals a notes field;
 * its value is merged into the answer at submit time by `answerForDraft`.
 *
 * When the question allows skipping, the Skip button renders inline next to
 * the Other row instead of in the Footer.
 */
export default function ChoiceForm({
  question,
  draft,
  onChange,
  onAutoAdvance,
  allowSkip,
  onSkip,
}) {
  const showOther = question.allowOther !== false;

  function isChecked(opt) {
    if (question.multiSelect)
      return Array.isArray(draft.selected) && draft.selected.includes(opt);
    return draft.selected === opt;
  }

  function handleSelect(opt) {
    if (question.multiSelect) {
      const list = Array.isArray(draft.selected) ? draft.selected : [];
      const next = list.includes(opt)
        ? list.filter((o) => o !== opt)
        : [...list, opt];
      onChange({ selected: next, otherSelected: false });
      return;
    }
    const patch = { selected: opt, otherSelected: false };
    onChange(patch);
    onAutoAdvance?.(patch);
  }

  function handleOtherToggle() {
    if (question.multiSelect) {
      onChange({ otherSelected: !draft.otherSelected });
      return;
    }
    onChange({ selected: null, otherSelected: !draft.otherSelected });
  }

  return (
    <div className="flex flex-col w-full">
      {question.options.map((opt, idx) => (
        <OptionButton
          key={`${opt}-${idx}`}
          label={opt}
          description={question.optionDescriptions?.[idx]}
          index={idx}
          selected={isChecked(opt)}
          onClick={() => handleSelect(opt)}
        />
      ))}
      {showOther && (
        <CustomAnswerRow
          index={question.options.length}
          selected={!!draft.otherSelected}
          onToggle={handleOtherToggle}
          allowSkip={allowSkip}
          onSkip={onSkip}
        />
      )}
      {showOther && draft.otherSelected && (
        <NotesInput
          value={draft.otherText || ""}
          onChange={(text) => onChange({ otherText: text })}
        />
      )}
    </div>
  );
}
