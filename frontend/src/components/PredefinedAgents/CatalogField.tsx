import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorMessage } from "@/utils/api";
import type { MeetingChoice } from "@/utils/meetingSelection";
import MeetingSelect from "./MeetingSelect";
import {
  type Answers,
  type WizardField,
  maxSelections,
} from "@/utils/agentWizard.ts";

const input =
  "w-full min-h-[40px] rounded-lg border border-theme-chat-input-border bg-theme-bg-chat-input px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-primary-button disabled:opacity-50";
const button =
  "dsh-control min-h-[40px] px-3 text-sm hover:bg-theme-sidebar-subitem-hover focus-visible:ring-2 focus-visible:ring-primary-button disabled:cursor-not-allowed disabled:opacity-50";

interface CatalogData {
  meetings?: MeetingChoice[];
  items?: MeetingChoice[];
  warning?: string;
  pending?: boolean;
  source?: string;
  fetchedAt?: string;
}
function isChoice(value: unknown): value is MeetingChoice {
  return (
    typeof value === "object" &&
    value !== null &&
    "label" in value &&
    typeof value.label === "string"
  );
}
export default function CatalogField({
  field,
  answers,
  onChange,
  invalid,
}: {
  field: WizardField;
  answers: Answers;
  onChange: (value: MeetingChoice | MeetingChoice[] | null) => void;
  invalid: boolean;
}) {
  const { t } = useTranslation();
  const groupAnswer = field.groupField && answers[field.groupField];
  const group = typeof groupAnswer === "string" ? groupAnswer : "";
  const meetingAnswer = field.meetingField && answers[field.meetingField];
  const meeting = isChoice(meetingAnswer) ? meetingAnswer : null;
  const value = answers[field.id];
  const isMeeting = field.type === "meeting";
  const multiple = isMeeting && Boolean(field.multiple);
  const requestKey =
    group && (isMeeting || meeting?.id)
      ? `${group}:${isMeeting ? "" : meeting?.id}`
      : null;
  const [result, setResult] = useState<{
    key: string;
    loading?: boolean;
    data?: CatalogData;
    error?: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");

  useEffect(() => {
    setQuery("");
    setManual("");
    if (!requestKey) return;
    const controller = new AbortController();
    setResult({ key: requestKey, loading: true });
    const params = new URLSearchParams({ group });
    if (!isMeeting && meeting?.id) params.set("meeting", meeting.id);
    api
      .get<CatalogData>(`/3gpp/catalog?${params}`, {
        signal: controller.signal,
        defaultError: t("agent_wizard.catalog_error"),
      })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            key: requestKey,
            error: errorMessage(error, t("agent_wizard.catalog_error")),
          });
      });
    return () => controller.abort();
  }, [requestKey, retry, group, isMeeting, meeting?.id, t]);

  const state = result?.key === requestKey ? result : null;
  const entries = state?.data?.[isMeeting ? "meetings" : "items"] || [];
  const selectedItems = Array.isArray(value) ? value.filter(isChoice) : [];
  const limit = maxSelections(field, answers);
  const filtered = entries.filter((item) =>
    `${item.label} ${item.description || ""}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );

  const manualAdd = () => {
    const label = manual.trim();
    if (!label) return;
    if (!selectedItems.some((item) => item.label === label))
      onChange([
        ...selectedItems,
        { value: `manual:${label}`, label, manual: true },
      ]);
    setManual("");
  };

  return (
    <div className="space-y-3">
      {!requestKey && (
        <p className="text-xs text-theme-text-secondary">
          {t(
            !group ? "agent_wizard.select_group" : "agent_wizard.select_meeting"
          )}
        </p>
      )}
      {state?.loading && (
        <p className="text-sm text-theme-text-secondary" role="status">
          {t("agent_wizard.catalog_loading")}
        </p>
      )}
      {state?.error && (
        <div
          className="flex items-center gap-2 text-xs text-theme-text-secondary"
          role="status"
        >
          <span>{state.error}</span>
          <button
            type="button"
            className={button}
            onClick={() => setRetry((count) => count + 1)}
          >
            {t("agent_wizard.retry")}
          </button>
        </div>
      )}
      {state?.data?.warning && (
        <p className="text-xs text-theme-text-secondary" role="status">
          {state.data.warning}
        </p>
      )}
      {state?.data?.pending && (
        <button
          type="button"
          className={button}
          onClick={() => setRetry((count) => count + 1)}
        >
          {t("agent_wizard.reload_catalog")}
        </button>
      )}
      {isMeeting && (
        <MeetingSelect
          key={group || "no-group"}
          entries={entries}
          value={multiple ? selectedItems : isChoice(value) ? value : null}
          onChange={(next) => onChange(multiple ? next : next[0] || null)}
          multiple={multiple}
          group={group}
          limit={multiple ? limit : 1}
          invalid={invalid}
          label={field.label ?? field.id}
          loading={state?.loading}
          placeholder={field.placeholder}
          examples={field.examples}
        />
      )}
      {!!entries.length && !isMeeting && (
        <>
          <input
            type="search"
            className={input}
            aria-label={t(
              isMeeting
                ? "agent_wizard.search_meetings"
                : "agent_wizard.search_agenda"
            )}
            placeholder={t(
              isMeeting
                ? "agent_wizard.search_meetings"
                : "agent_wizard.search_agenda"
            )}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-theme-chat-input-border p-2">
            {filtered.length ? (
              filtered.map((item) => (
                <label
                  key={item.value}
                  className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md p-2 text-sm hover:bg-theme-sidebar-subitem-hover focus-within:ring-2 focus-within:ring-primary-button"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selectedItems.some(
                      (selected) => selected.value === item.value
                    )}
                    onChange={(event) =>
                      onChange(
                        event.target.checked
                          ? [...selectedItems, item]
                          : selectedItems.filter(
                              (selected) => selected.value !== item.value
                            )
                      )
                    }
                  />
                  <span className="min-w-0 break-words">
                    <span className="block">{item.label}</span>
                    {item.description && (
                      <span className="mt-1 block text-xs text-theme-text-secondary">
                        {item.description}
                      </span>
                    )}
                  </span>
                </label>
              ))
            ) : (
              <p className="p-2 text-xs text-theme-text-secondary">
                {t("agent_wizard.no_matches")}
              </p>
            )}
          </div>
        </>
      )}
      {state?.data && !isMeeting && !entries.length && !state.data.warning && (
        <p className="text-xs text-theme-text-secondary">
          {t("agent_wizard.no_agenda")}
        </p>
      )}
      {state?.data?.source && (
        <p className="text-xs text-theme-text-secondary">
          <a
            href={state.data.source}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {t("agent_wizard.official_source")}
          </a>{" "}
          {state.data.fetchedAt && (
            <>
              {" "}
              ·{" "}
              {t("agent_wizard.fetched_at", {
                date: new Date(state.data.fetchedAt).toLocaleString("zh-CN"),
              })}
            </>
          )}
        </p>
      )}
      {!isMeeting && selectedItems.length > 0 && (
        <div className="space-y-1" aria-label={t("agent_wizard.selected")}>
          {selectedItems.map((item) => (
            <div
              key={item.value || item.label}
              className="flex items-start justify-between gap-2 text-sm"
            >
              <span className="min-w-0 break-words">
                {item.label}
                {item.manual ? ` · ${t("agent_wizard.manual")}` : ""}
              </span>
              <button
                type="button"
                className={button}
                aria-label={t("agent_wizard.remove_item", { name: item.label })}
                onClick={() =>
                  onChange(
                    selectedItems.filter(
                      (selected) => selected.value !== item.value
                    )
                  )
                }
              >
                {t("agent_wizard.remove")}
              </button>
            </div>
          ))}
        </div>
      )}
      {!isMeeting && (
        <div className="flex items-start gap-2">
          <input
            type="text"
            maxLength={500}
            className={input}
            disabled={!group}
            aria-label={t(
              isMeeting
                ? "agent_wizard.manual_meeting"
                : "agent_wizard.manual_agenda"
            )}
            placeholder={
              field.placeholder ||
              t(
                isMeeting
                  ? "agent_wizard.manual_meeting"
                  : "agent_wizard.manual_agenda"
              )
            }
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                manualAdd();
              }
            }}
          />
          <button
            type="button"
            className={`${button} shrink-0`}
            disabled={!group || !manual.trim()}
            onClick={manualAdd}
          >
            {t("agent_wizard.add")}
          </button>
        </div>
      )}
      {!isMeeting && !!field.examples?.length && (
        <p className="text-xs text-theme-text-secondary">
          {t("agent_wizard.examples", { examples: field.examples.join("；") })}
        </p>
      )}
    </div>
  );
}
