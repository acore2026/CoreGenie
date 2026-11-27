import { API_BASE } from "@/utils/constants";
import { cleanHeaders } from "@/utils/api";
import { baseHeaders } from "@/utils/request";

const StorageFiles = {
  download: async (storageFilename: string): Promise<Blob | null> => {
    try {
      const res = await fetch(
        `${API_BASE}/agent-skills/generated-files/${encodeURIComponent(storageFilename)}`,
        { headers: cleanHeaders({ ...baseHeaders() }) }
      );
      if (!res.ok) throw new Error("Failed to download file");
      return await res.blob();
    } catch (e) {
      console.error("Download failed:", e);
      return null;
    }
  },
};

export default StorageFiles;
