import { useId, useState } from "react";
import { Popover } from "@headlessui/react";
import { CaretDown, CalendarBlank } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import {
  inferMeetings,
  meetingKey,
  toggleMeeting,
} from "@/utils/meetingSelection.mjs";

const control =
  "min-h-[40px] rounded-lg border border-theme-chat-input-border bg-theme-bg-chat-input px-3 py-2 text-sm text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button disabled:cursor-not-allowed disabled:opacity-50";
const button =
  "dsh-control min-h-[40px] rounded-lg px-3 text-sm hover:bg-theme-sidebar-subitem-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button disabled:cursor-not-allowed disabled:opacity-50";

export default function MeetingSelect({
  entries,
  value,
  onChange,
  group,
  limit,
  multiple,
  invalid,
  label,
  loading,
  placeholder,
  examples,
}) {
  const { t } = useTranslation();
  const hintId = useId();
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const selectedKeys = new Set(selected.map(meetingKey));
  const { current, next, today } = inferMeetings(entries);
  const badge = (item) =>
    meetingKey(item) === meetingKey(current)
      ? t("agent_wizard.current_meeting_tag")
      : meetingKey(item) === meetingKey(next)
        ? t("agent_wizard.next_meeting_tag")
        : null;
  const matches = (item) =>
    `${item.label} ${item.description || ""} ${item.date || ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  const nearMeetings = [current, next].filter(Boolean);
  const nearKeys = new Set(nearMeetings.map(meetingKey));
  const other = entries
    .filter((item) => !nearKeys.has(meetingKey(item)) && matches(item))
    .slice()
    .sort(
      (a, b) =>
        String(b.date || b.year || "").localeCompare(
          String(a.date || a.year || "")
        ) ||
        String(meetingKey(b)).localeCompare(String(meetingKey(a)), undefined, {
          numeric: true,
        })
    );
  const yearOf = (item) =>
    String(
      item.year || item.date?.slice(0, 4) || t("agent_wizard.unknown_year")
    );
  const years = [...new Set(other.map(yearOf))];
  const missingFromCatalog = selected.filter(
    (item) =>
      !entries.some((entry) => meetingKey(entry) === meetingKey(item)) &&
      matches(item)
  );
  const sections = [
    {
      title: t("agent_wizard.near_meetings"),
      items: nearMeetings.filter(matches),
    },
    {
      title: t("agent_wizard.selected_other_meetings"),
      items: missingFromCatalog,
    },
    ...years.map((year) => ({
      title: year,
      items: other.filter((item) => yearOf(item) === year),
    })),
  ].filter((section) => section.items.length);
  const atLimit = multiple && selected.length >= limit;
  const toggle = (item) =>
    onChange(toggleMeeting(selected, item, { limit, multiple, group }));
  const duplicate = selected.some((item) => item.label === manual.trim());
  const addManual = () => {
    const name = manual.trim();
    if (!name || atLimit || duplicate) return;
    toggle({ value: `manual:${name}`, label: name, manual: true });
    setManual("");
  };
  const countText =
    Number.isFinite(limit) && limit < 999
      ? t("agent_wizard.meeting_count_limit", { count: selected.length, limit })
      : t("agent_wizard.selected_count", { count: selected.length });

  return (
    <Popover className="relative">
      {({ open, close }) => (
        <>
          <Popover.Button
            type="button"
            disabled={!group}
            aria-label={label}
            aria-invalid={invalid}
            aria-describedby={hintId}
            className={`${control} flex w-full items-start gap-3 text-left hover:bg-theme-sidebar-subitem-hover`}
          >
            <CalendarBlank
              size={18}
              className="mt-0.5 shrink-0 text-theme-text-secondary"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              {selected.length ? (
                <>
                  <span className="mb-1 block text-xs text-theme-text-secondary tabular-nums">
                    {countText}
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {selected.map((item) => (
                      <span
                        key={meetingKey(item)}
                        className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-2 rounded-md bg-theme-sidebar-item-default-selected px-2 py-1"
                      >
                        <span className="break-words">{item.label}</span>
                        {badge(item) && (
                          <span className="text-xs font-medium text-theme-text-secondary">
                            {badge(item)}
                          </span>
                        )}
                      </span>
                    ))}
                  </span>
                </>
              ) : (
                <span className="text-theme-text-secondary">
                  {t(
                    loading
                      ? "agent_wizard.catalog_loading"
                      : multiple
                        ? "agent_wizard.choose_meeting_multi"
                        : "agent_wizard.choose_meeting"
                  )}
                </span>
              )}
            </span>
            <CaretDown
              size={16}
              className={`mt-0.5 shrink-0 ${open ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </Popover.Button>
          <p
            id={hintId}
            className="mt-2 text-xs leading-5 text-theme-text-secondary"
          >
            {t("agent_wizard.meeting_date_hint", { date: today })}
          </p>
          <Popover.Panel
            focus
            className="mt-2 rounded-lg border border-theme-chat-input-border bg-theme-bg-primary"
            aria-label={t("agent_wizard.meeting_menu")}
          >
            <div className="p-3">
              <input
                type="search"
                className={`w-full ${control}`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("agent_wizard.search_meetings")}
                aria-label={t("agent_wizard.search_meetings")}
              />
            </div>
            <div className="max-h-[280px] space-y-3 overflow-y-auto overscroll-contain px-3 pb-3">
              {sections.map((section) => (
                <section key={section.title} aria-label={section.title}>
                  <p className="mb-1 px-2 text-xs font-semibold text-theme-text-secondary">
                    {section.title}
                  </p>
                  {section.items.map((item) => (
                    <MeetingOption
                      key={meetingKey(item)}
                      item={item}
                      badge={badge(item)}
                      checked={selectedKeys.has(meetingKey(item))}
                      disabled={!selectedKeys.has(meetingKey(item)) && atLimit}
                      onChange={() => toggle(item)}
                    />
                  ))}
                </section>
              ))}
              {!sections.length && (
                <p
                  className="px-2 text-xs text-theme-text-secondary"
                  role="status"
                >
                  {t(
                    loading
                      ? "agent_wizard.catalog_loading"
                      : "agent_wizard.no_matches"
                  )}
                </p>
              )}
            </div>
            <details className="border-t border-theme-chat-input-border px-3">
              <summary className="min-h-[40px] cursor-pointer py-2 text-xs leading-6 text-theme-text-secondary hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button">
                {t("agent_wizard.manual_meeting")}
              </summary>
              <div className="flex items-start gap-2 pb-3">
                <input
                  type="text"
                  maxLength={500}
                  className={`min-w-0 flex-1 ${control}`}
                  value={manual}
                  onChange={(event) => setManual(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addManual();
                    }
                  }}
                  placeholder={placeholder || t("agent_wizard.manual_meeting")}
                  aria-label={t("agent_wizard.manual_meeting")}
                />
                <button
                  type="button"
                  className={button}
                  disabled={!manual.trim() || atLimit || duplicate}
                  onClick={addManual}
                >
                  {t("agent_wizard.add")}
                </button>
              </div>
              {!!examples?.length && (
                <p className="pb-3 text-xs text-theme-text-secondary">
                  {t("agent_wizard.examples", {
                    examples: examples.join("；"),
                  })}
                </p>
              )}
            </details>
            <div className="flex items-center justify-between gap-3 border-t border-theme-chat-input-border px-3 py-2">
              <span
                className="text-xs text-theme-text-secondary tabular-nums"
                role="status"
              >
                {countText}
              </span>
              <button type="button" className={button} onClick={() => close()}>
                {t("agent_wizard.done")}
              </button>
            </div>
          </Popover.Panel>
        </>
      )}
    </Popover>
  );
}

function MeetingOption({ item, badge, checked, disabled, onChange }) {
  return (
    <label
      className={`flex min-h-[44px] items-start gap-3 rounded-md px-2 py-2 text-sm focus-within:ring-2 focus-within:ring-inset focus-within:ring-primary-button ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-theme-sidebar-subitem-hover"} ${checked ? "bg-theme-sidebar-item-default-selected" : ""}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-1 shrink-0 accent-primary-button"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="break-words font-medium">{item.label}</span>
          {badge && (
            <span className="rounded border border-theme-chat-input-border px-1.5 py-0.5 text-xs text-theme-text-secondary">
              {badge}
            </span>
          )}
        </span>
        {item.description && (
          <span className="mt-1 block break-words text-xs leading-5 text-theme-text-secondary">
            {item.description}
          </span>
        )}
      </span>
    </label>
  );
}
