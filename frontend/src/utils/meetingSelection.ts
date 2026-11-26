import type { OfficialMeeting } from "../../../server/contracts/meetingLists.mts";

export type { OfficialMeeting } from "../../../server/contracts/meetingLists.mts";

/** A meeting in the Agent picker can come from the catalogue or be entered manually. */
export interface MeetingChoice {
  id?: string;
  value?: string;
  label: string;
  date?: string | null;
  year?: number | string;
  description?: string;
  group?: string;
  manual?: boolean;
}

export const meetingKey = (item?: MeetingChoice) =>
  item?.id || item?.value || item?.label;

function parseMeetingDate(value?: string | null) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-(0[1-9]|1[0-2])(?:-\d{2})?$/.test(value)
  )
    return null;
  const monthOnly = value.length === 7;
  const firstDay = monthOnly ? value + "-01" : value;
  const date = new Date(firstDay + "T00:00:00Z");
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== firstDay
  )
    return null;
  return { value, firstDay, monthOnly };
}

// The Agent picker uses the user's local day. A month-only meeting becomes
// eligible on the first of that month, as explained in the picker.
export function inferAgentMeetings(
  entries: readonly MeetingChoice[],
  now = new Date()
) {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const dated = entries
    .flatMap((item) => {
      const date = parseMeetingDate(item.date);
      return date ? [{ item, date: date.firstDay }] : [];
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        String(meetingKey(a.item)).localeCompare(
          String(meetingKey(b.item)),
          undefined,
          { numeric: true }
        )
    );
  return {
    current: dated.filter(({ date }) => date <= today).at(-1)?.item,
    next: dated.find(({ date }) => date > today)?.item,
    today,
  };
}

// For official downloads, use the UTC day. A month-only meeting in the
// current month still needs an explicit choice because it may be in the future.
export function defaultDownloadMeetingId(
  meetings: readonly OfficialMeeting[],
  today = new Date().toISOString().slice(0, 10)
): string {
  const eligible = meetings.flatMap((meeting) => {
    const date = parseMeetingDate(meeting.date);
    if (!date) return [];
    const started = date.monthOnly
      ? date.value < today.slice(0, 7)
      : date.firstDay <= today;
    return started ? [{ meeting, date: date.value }] : [];
  });
  eligible.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      b.meeting.number - a.meeting.number ||
      b.meeting.suffix.localeCompare(a.meeting.suffix)
  );
  return eligible[0]?.meeting.id ?? "";
}

export function toggleMeeting(
  selected: MeetingChoice[],
  item: MeetingChoice,
  {
    limit = Infinity,
    multiple = true,
    group,
  }: { limit?: number; multiple?: boolean; group?: string } = {}
) {
  const key = meetingKey(item);
  if (selected.some((entry) => meetingKey(entry) === key))
    return selected.filter((entry) => meetingKey(entry) !== key);
  if (!multiple) return [{ ...item, group }];
  return selected.length < limit ? [...selected, { ...item, group }] : selected;
}
