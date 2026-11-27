export interface Announcement {
  id: number;
  title: string;
  content: string;
  startsAt: string;
  expiresAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  read?: boolean;
}

export interface AnnouncementPayload {
  title: string;
  content: string;
  startsAt?: string;
  expiresAt?: string | null;
}
