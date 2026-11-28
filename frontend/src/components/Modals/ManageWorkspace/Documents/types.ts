import type { LibraryFile, WorkspaceRecord } from "@coregenie/contracts";
export type {
  LibraryFile,
  LibraryFolder,
  DocumentLibrary,
  WorkspaceRecord,
} from "@coregenie/contracts";
export type SelectedFiles = Record<string, boolean>;
export type MovedFile = LibraryFile & { folderName: string };
export type StateSetter<T> = React.Dispatch<React.SetStateAction<T>>;
export type FetchDocuments = (
  reload?: boolean,
  options?: { autoSelectNew?: boolean }
) => Promise<void>;
export interface DocumentPanelProps {
  workspace: WorkspaceRecord;
  fetchKeys: FetchDocuments;
  setLoading: (loading: boolean) => void;
  setLoadingMessage: (message: string) => void;
}
export interface Upload {
  uid: string;
  file: File;
  rejected?: boolean;
  reason?: string;
}
