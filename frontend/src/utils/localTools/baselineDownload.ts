import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

export class BaselineDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaselineDownloadError";
  }
}

export interface OfficialBaselineDownload {
  file: File;
  spec: string;
  release: string;
  version: string;
  zipName: string;
  source: string;
  fetchedAt: string;
}

interface BaselineApiResponse {
  name?: string;
  spec?: string;
  release?: string;
  version?: string;
  zipName?: string;
  source?: string;
  fetchedAt?: string;
  content?: string;
  error?: string;
}

export async function downloadOfficialBaseline(
  spec: string,
  release: string,
  version?: string,
  signal?: AbortSignal
): Promise<OfficialBaselineDownload> {
  const headers = Object.fromEntries(
    Object.entries(baseHeaders()).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
  const params = new URLSearchParams({ spec, release });
  if (version) params.set("version", version);

  const response = await fetch(
    `${API_BASE}/3gpp/baseline-spec?${params.toString()}`,
    { headers, signal }
  );

  let data: BaselineApiResponse = {};
  try {
    data = (await response.json()) as BaselineApiResponse;
  } catch {
    data = {};
  }

  if (!response.ok || !data.content || !data.name) {
    throw new BaselineDownloadError(
      data.error ||
        "暂时无法从 3GPP 官方归档下载基线规范，请稍后重试或手动上传。"
    );
  }

  const binary = atob(data.content);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return {
    file: new File([bytes], data.name, {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    spec: data.spec || spec,
    release: data.release || release,
    version: data.version || "",
    zipName: data.zipName || "",
    source: data.source || "",
    fetchedAt: data.fetchedAt || new Date().toISOString(),
  };
}
