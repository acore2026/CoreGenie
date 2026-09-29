import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const input =
  "w-full min-h-[40px] rounded-lg border border-theme-chat-input-border bg-theme-bg-chat-input px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-primary-button disabled:opacity-50";
const button =
  "dsh-control min-h-[40px] px-3 text-sm hover:bg-theme-sidebar-subitem-hover focus-visible:ring-2 focus-visible:ring-primary-button disabled:cursor-not-allowed disabled:opacity-50";

export default function CatalogField({ field, answers, onChange, invalid }) {
  const { t } = useTranslation();
  const group = answers[field.groupField];
  const meeting = answers[field.meetingField];
  const value = answers[field.id];
  const isMeeting = field.type === "meeting";
  const multiple = isMeeting && field.multiple;
  const requestKey =
    group && (isMeeting || meeting?.id)
      ? `${group}:${isMeeting ? "" : meeting.id}`
      : null;
  const [result, setResult] = useState(null);
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
    if (!isMeeting) params.set("meeting", meeting.id);
    fetch(`${API_BASE}/3gpp/catalog?${params}`, {
      headers: baseHeaders(),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || t("agent_wizard.catalog_error"));
        if (!controller.signal.aborted) setResult({ key: requestKey, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({ key: requestKey, error: error.message });
      });
    return () => controller.abort();
  }, [requestKey, retry, group, isMeeting, meeting?.id, t]);

  const state = result?.key === requestKey ? result : null;
  const entries = state?.data?.[isMeeting ? "meetings" : "items"] || [];
  const selected =
    isMeeting && !multiple
      ? entries.findIndex((entry) => entry.id === value?.id)
      : -1;
  const selectedMeetings = multiple ? (Array.isArray(value) ? value : []) : [];
  // 按当前日期识别最近一次已召开的会议和最近一次未召开的会议。
  // 目录按场次序号升序，date 形如 "2026-08"；无日期的场次不参与判断。
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const datedMeetings = entries.filter(
    (item) => typeof item.date === "string" && /^\d{4}-\d{2}/.test(item.date)
  );
  const lastMeeting = [...datedMeetings]
    .filter((item) => item.date.slice(0, 7) <= currentMonth)
    .pop();
  const nextMeeting = datedMeetings.find(
    (item) => item.date.slice(0, 7) > currentMonth
  );
  const limit = field.maxSelectionsBy
    ? Object.entries(field.maxSelectionsBy).reduce(
        (result, [fieldId, values]) => {
          const answer = answers[fieldId];
          const next = values?.[Array.isArray(answer) ? answer[0] : answer];
          return typeof next === "number" ? Math.min(result, next) : result;
        },
        Infinity
      )
    : Infinity;
  const chooseMeeting = (entry) =>
    multiple
      ? onChange([...selectedMeetings, { ...entry, group }])
      : onChange({ ...entry, group });
  // 多选时“上一次／下一次”只作用于唯一选中的会议，替换为相邻场次。
  const shiftSelectedMeeting = (offset) => {
    const current = selectedMeetings[0];
    const index = entries.findIndex((item) => item.id === current?.id);
    const adjacent = entries[index + offset];
    if (adjacent) onChange([{ ...adjacent, group }]);
  };
  const filtered = entries.filter((item) =>
    `${item.label} ${item.description || ""}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );
  const years = [...new Set(filtered.map((item) => item.year))].sort(
    (a, b) => (b || 0) - (a || 0)
  );
  const selectedItems = Array.isArray(value) ? value : [];
  const manualAdd = () => {
    const label = manual.trim();
    if (!label) return;
    if (isMeeting && multiple) {
      if (
        selectedMeetings.length < limit &&
        !selectedMeetings.some((item) => item.label === label)
      )
        onChange([
          ...selectedMeetings,
          { value: `manual:${label}`, label, manual: true, group },
        ]);
    } else if (isMeeting) onChange({ label, manual: true, group });
    else if (!selectedItems.some((item) => item.label === label))
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
      {!!entries.length && (
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
          {isMeeting ? (
            <>
              <select
                className={input}
                aria-label={field.label}
                aria-invalid={invalid}
                value={
                  multiple
                    ? selectedMeetings[selectedMeetings.length - 1]?.id || ""
                    : value?.id || ""
                }
                onChange={(event) => {
                  const entry = entries.find(
                    (item) => item.id === event.target.value
                  );
                  if (multiple) {
                    // 多选：保留下拉的单选外观，点选即加入或移除已选会议。
                    if (!entry) return;
                    onChange(
                      selectedMeetings.some((item) => item.id === entry.id)
                        ? selectedMeetings.filter(
                            (item) => item.id !== entry.id
                          )
                        : selectedMeetings.length < limit
                          ? [...selectedMeetings, { ...entry, group }]
                          : selectedMeetings
                    );
                  } else {
                    onChange(entry ? { ...entry, group } : null);
                  }
                }}
              >
                <option value="">
                  {t(
                    multiple
                      ? "agent_wizard.choose_meeting_multi"
                      : "agent_wizard.choose_meeting"
                  )}
                </option>
                {years.map((year) => (
                  <optgroup
                    key={year || "unknown"}
                    label={year ? `${year}` : t("agent_wizard.unknown_year")}
                  >
                    {filtered
                      .filter((item) => item.year === year)
                      .slice()
                      .reverse()
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                          {item.id === lastMeeting?.id
                            ? ` · ${t("agent_wizard.last_meeting_tag")}`
                            : item.id === nextMeeting?.id
                              ? ` · ${t("agent_wizard.next_meeting_tag")}`
                              : ""}
                        </option>
                      ))}
                  </optgroup>
                ))}
                {(multiple ? selectedMeetings : [value])
                  .filter(
                    (item) =>
                      item?.id && !filtered.some((e) => e.id === item.id)
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
              </select>
              {(lastMeeting || nextMeeting) && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {lastMeeting && (
                    <span
                      className="rounded-full border border-theme-chat-input-border bg-theme-sidebar-item-default-selected px-2 py-0.5 text-theme-text-primary"
                      title={t("agent_wizard.last_meeting_hint")}
                    >
                      {t("agent_wizard.last_meeting_tag")}：{lastMeeting.label}
                    </span>
                  )}
                  {nextMeeting && (
                    <span
                      className="rounded-full border border-theme-chat-input-border bg-theme-sidebar-item-hover px-2 py-0.5 text-theme-text-primary"
                      title={t("agent_wizard.next_meeting_hint")}
                    >
                      {t("agent_wizard.next_meeting_tag")}：{nextMeeting.label}
                    </span>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={button}
                  disabled={
                    multiple ? selectedMeetings.length !== 1 : selected <= 0
                  }
                  onClick={() =>
                    multiple
                      ? shiftSelectedMeeting(-1)
                      : chooseMeeting(entries[selected - 1])
                  }
                >
                  {t("agent_wizard.previous_meeting")}
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={
                    multiple
                      ? selectedMeetings.length !== 1
                      : selected < 0 || selected >= entries.length - 1
                  }
                  onClick={() =>
                    multiple
                      ? shiftSelectedMeeting(1)
                      : chooseMeeting(entries[selected + 1])
                  }
                >
                  {t("agent_wizard.next_meeting")}
                </button>
                <span className="text-xs text-theme-text-secondary">
                  {t("agent_wizard.adjacent_hint")}
                </span>
              </div>
            </>
          ) : (
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
                      checked={
                        isMeeting
                          ? selectedMeetings.some(
                              (selected) => selected.id === item.id
                            )
                          : selectedItems.some(
                              (selected) => selected.value === item.value
                            )
                      }
                      disabled={
                        isMeeting &&
                        !selectedMeetings.some(
                          (selected) => selected.id === item.id
                        ) &&
                        selectedMeetings.length >= limit
                      }
                      onChange={(event) =>
                        onChange(
                          event.target.checked
                            ? isMeeting
                              ? [...selectedMeetings, { ...item, group }]
                              : [...selectedItems, item]
                            : isMeeting
                              ? selectedMeetings.filter(
                                  (selected) => selected.id !== item.id
                                )
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
          )}
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
          ·{" "}
          {t("agent_wizard.fetched_at", {
            date: new Date(state.data.fetchedAt).toLocaleString("zh-CN"),
          })}
        </p>
      )}
      {(isMeeting
        ? multiple
          ? selectedMeetings.length > 0
          : value?.manual
        : selectedItems.length > 0) && (
        <div className="space-y-1" aria-label={t("agent_wizard.selected")}>
          {(isMeeting
            ? multiple
              ? selectedMeetings
              : [value]
            : selectedItems
          ).map((item) => (
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
                    isMeeting
                      ? multiple
                        ? selectedMeetings.filter(
                            (selected) =>
                              selected.id !== item.id &&
                              selected.value !== item.value
                          )
                        : null
                      : selectedItems.filter(
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
      {!!field.examples?.length && (
        <p className="text-xs text-theme-text-secondary">
          {t("agent_wizard.examples", { examples: field.examples.join("；") })}
        </p>
      )}
    </div>
  );
}
