import type { OfficialMeeting } from "../meetingSelection";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

export const GROUPS = [
  "CT",
  "CT1",
  "CT3",
  "CT4",
  "CT6",
  "SA",
  "SA1",
  "SA2",
  "SA3",
  "SA4",
  "SA5",
  "SA6",
  "RAN",
  "RAN1",
  "RAN2",
  "RAN3",
  "RAN4",
  "RAN5",
];
export interface MeetingCatalog {
  meetings: OfficialMeeting[];
  stale?: boolean;
  fetchedAt: string;
}
export interface DownloadedList {
  file: File;
  source: string;
  fetchedAt: string;
}
async function request(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal
) {
  const headers = Object.fromEntries(
    Object.entries(baseHeaders()).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
  const response = await fetch(
    `${API_BASE}/3gpp/${path}?${new URLSearchParams(params)}`,
    { headers, signal }
  );
  if (!response.ok) throw new Error("download_failed");
  return response.json();
}
export async function loadMeetings(
  group: string,
  signal?: AbortSignal
): Promise<MeetingCatalog> {
  const data = await request("meeting-lists", { group }, signal);
  if (!Array.isArray(data.meetings) || !data.meetings.length)
    throw new Error("download_failed");
  return data;
}
export async function downloadList(
  group: string,
  meeting: string,
  signal?: AbortSignal
): Promise<DownloadedList> {
  const data = await request("meeting-list", { group, meeting }, signal);
  const bytes = Uint8Array.from(atob(data.content), (c) => c.charCodeAt(0));
  return {
    file: new File([bytes], data.name),
    source: data.source,
    fetchedAt: data.fetchedAt,
  };
}
