export interface CollectorOptions {
  parseOnly?: boolean;
  absolutePath?: string | null;
  ocr?: { langList?: string };
  runtimeSettings?: Record<string, unknown>;
}
export interface DocumentMetadata {
  url?: string;
  title?: string;
  docAuthor?: string;
  description?: string;
  docSource?: string;
  chunkSource?: string;
  published?: string | number;
}
export interface FileInput {
  filename: string;
  fullFilePath: string;
  options?: CollectorOptions;
  metadata?: DocumentMetadata;
}
export interface DocumentData {
  id: string;
  url: string;
  title: string;
  docAuthor?: string | null;
  description: string;
  docSource: string;
  chunkSource: string;
  published: string;
  wordCount: number;
  pageContent: string;
  token_count_estimate: number;
}
export interface StoredDocument extends DocumentData {
  location: string;
  isDirectUpload: boolean;
}
export interface FileResult {
  success: boolean;
  reason: string | null;
  documents: StoredDocument[];
}
export type FileConverter = (input: FileInput) => Promise<FileResult>;
export interface LinkResult {
  success: boolean;
  reason?: string | null;
  documents?: StoredDocument[];
  content?: string | null;
}
export interface RepoArgs {
  repo?: string;
  branch?: string | null;
  accessToken?: string | null;
  ignorePaths?: string[];
}
export interface ExtensionContext {
  locals: {
    encryptionWorker: import("./utils/EncryptionWorker/index.js").EncryptionWorker;
  };
}
