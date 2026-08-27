import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const PublicChatShare = {
  create: async function ({ workspaceSlug, threadSlug = null }) {
    try {
      const response = await fetch(
        `${API_BASE}/workspace/${encodeURIComponent(workspaceSlug)}/share-chat`,
        {
          method: "POST",
          headers: baseHeaders(),
          body: JSON.stringify({ threadSlug }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Share failed");
      return data;
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  get: async function (token) {
    try {
      const response = await fetch(
        `${API_BASE}/public-chat-share/${encodeURIComponent(token)}`,
        { headers: { Accept: "application/json" } }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Share unavailable");
      return data;
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
};

export default PublicChatShare;
