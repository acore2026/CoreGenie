import { api } from "@/utils/api";

export interface LiveSyncQueue {
  id: number;
  status: string;
  [key: string]: unknown;
}

const LiveDocumentSync = {
  featureFlag: "experimental_live_file_sync",

  toggleFeature: async function (updatedStatus = false): Promise<boolean> {
    try {
      await api.post(
        "/experimental/toggle-live-sync",
        { updatedStatus },
        { defaultError: "Could not update status." }
      );
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  },

  queues: async function (): Promise<LiveSyncQueue[]> {
    try {
      const res = await api.get<{ queues?: LiveSyncQueue[] }>(
        "/experimental/live-sync/queues",
        { defaultError: "Could not update status." }
      );
      return res?.queues || [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  setWatchStatusForDocument: async function (
    slug: string,
    docPath: string,
    watchStatus: boolean
  ): Promise<boolean> {
    try {
      await api.post(
        `/workspace/${slug}/update-watch-status`,
        { docPath, watchStatus },
        { defaultError: "Error setting watch status for document." }
      );
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  },
};

export default LiveDocumentSync;
