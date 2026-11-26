import {
  meetingCatalog,
  meetingWorkbook,
  meetingError,
} from "../../../../server/contracts/meetingLists.mts";
import type { MeetingCatalog } from "../../../../server/contracts/meetingLists.mts";
export type { MeetingCatalog } from "../../../../server/contracts/meetingLists.mts";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

export class MeetingResponseError extends Error {}

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
  const data: unknown = await response.json();
  if (!response.ok) {
    const reason = meetingError.safeParse(data);
    throw new MeetingResponseError(reason.success ? reason.data.error : "");
  }
  return data;
}
export async function loadMeetings(
  group: string,
  signal?: AbortSignal
): Promise<MeetingCatalog> {
  const data = await request("meeting-lists", { group }, signal);
  return meetingCatalog.parse(data);
}
export async function downloadList(
  group: string,
  meeting: string,
  signal?: AbortSignal
): Promise<DownloadedList> {
  const data = meetingWorkbook.parse(
    await request("meeting-list", { group, meeting }, signal)
  );
  const bytes = Uint8Array.from(atob(data.content), (c) => c.charCodeAt(0));
  return {
    file: new File([bytes], data.name),
    source: data.source,
    fetchedAt: data.fetchedAt,
  };
}
