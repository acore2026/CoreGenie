export const meetingKey = (item) => item?.id || item?.value || item?.label;

function dateKey(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-(0[1-9]|1[0-2])(?:-\d{2})?$/.test(value)
  )
    return null;
  const full = value.length === 7 ? `${value}-01` : value;
  const date = new Date(`${full}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== full
    ? null
    : full;
}

// Month-only catalogue dates cannot distinguish meetings within the same month.
// Treat that month as current once it starts, and state this approximation in UI.
export function inferMeetings(entries, now = new Date()) {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const dated = entries
    .map((item) => ({ item, date: dateKey(item.date) }))
    .filter(({ date }) => date)
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

export function toggleMeeting(
  selected,
  item,
  { limit = Infinity, multiple = true, group } = {}
) {
  const key = meetingKey(item);
  if (selected.some((entry) => meetingKey(entry) === key))
    return selected.filter((entry) => meetingKey(entry) !== key);
  if (!multiple) return [{ ...item, group }];
  return selected.length < limit ? [...selected, { ...item, group }] : selected;
}
