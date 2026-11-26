import { z } from "zod";

const date = z.iso.date();
const source = z.url({ protocol: /^https?$/ });
export const officialMeeting = z.object({
  id: z.string().min(1),
  number: z.number().int().nonnegative(),
  suffix: z.string(),
  label: z.string().min(1),
  date: z.union([date, z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), z.null()]),
  year: z.number().int().nullable().optional(),
  source: source.optional(),
});

export const meetingCatalog = z.object({
  group: z.string().optional(),
  groups: z.array(z.string()).optional(),
  source: source.optional(),
  meetings: z.array(officialMeeting).min(1),
  fetchedAt: z.iso.datetime({ offset: true }),
  stale: z.boolean().default(false),
  warning: z.string().optional(),
});

export const meetingWorkbook = z.object({
  name: z.string().min(1),
  source,
  fetchedAt: z.iso.datetime({ offset: true }),
  content: z.base64().min(1),
});

export const meetingError = z.object({ error: z.string().min(1) });
export type OfficialMeeting = z.infer<typeof officialMeeting>;
export type MeetingCatalog = z.infer<typeof meetingCatalog>;
