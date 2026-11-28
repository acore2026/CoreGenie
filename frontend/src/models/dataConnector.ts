import { api, errorMessage } from "@/utils/api";
import showToast from "@/utils/toast";

interface ConnectorResponse<T = Record<string, unknown>> {
  success?: boolean;
  reason?: string;
  data?: T;
}

interface CollectedRepository {
  files: number;
  author: string;
  repo: string;
  branch: string;
  destination: string;
}
const DataConnector = {
  github: {
    branches: async ({
      repo,
      accessToken,
    }: {
      repo: string;
      accessToken?: string | null;
    }): Promise<{ branches: string[]; error: string | null }> => {
      try {
        const res = await api.post<ConnectorResponse<{ branches?: string[] }>>(
          "/ext/github/branches",
          { repo, accessToken },
          { cache: "force-cache" }
        );
        if (!res.success) throw new Error(res.reason || "Request failed.");
        return { branches: res.data?.branches || [], error: null };
      } catch (e) {
        console.error(e);
        const msg = errorMessage(e);
        showToast(msg, "error");
        return { branches: [], error: msg };
      }
    },

    collect: async ({
      repo,
      accessToken,
      branch,
      ignorePaths = [],
    }: {
      repo: string;
      accessToken?: string | null;
      branch?: string;
      ignorePaths?: string[];
    }): Promise<{
      data: CollectedRepository | null;
      error: string | null;
    }> => {
      try {
        const res = await api.post<ConnectorResponse<CollectedRepository>>(
          "/ext/github/repo",
          { repo, accessToken, branch, ignorePaths }
        );
        if (!res.success) throw new Error(res.reason || "Request failed.");
        return { data: res.data || null, error: null };
      } catch (e) {
        console.error(e);
        return { data: null, error: errorMessage(e) };
      }
    },
  },
};

export default DataConnector;
