export interface WorkspaceFileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
}

export interface FileLevelState {
  loading: boolean;
  error: string | null;
  entries?: WorkspaceFileEntry[] | null;
}

export interface FilePreviewData {
  name: string;
  path: string;
  size?: number;
  kind?: "image" | "text" | "too_large" | "binary" | string;
  mime?: string;
  content?: string;
  truncated?: boolean;
  error?: string | null;
}

export interface ContextMenuState {
  entry: WorkspaceFileEntry;
  point: { x: number; y: number };
}

export type TranslateFn = (
  key: string,
  options?: Record<string, unknown>
) => string;

export function formatSize(bytes = 0): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

export function parentDirectory(entryPath = ""): string {
  const segments = String(entryPath).split("/").filter(Boolean);
  segments.pop();
  return segments.join("/");
}

export function includesPath(
  parent?: string | null,
  child?: string | null
): boolean {
  if (!parent || !child) return false;
  return child === parent || child.startsWith(`${parent}/`);
}
