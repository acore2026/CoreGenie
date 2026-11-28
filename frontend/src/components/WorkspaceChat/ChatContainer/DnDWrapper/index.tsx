import { useState, useEffect, useRef, createContext, useContext } from "react";
import {
  WORKSPACE_UPLOAD_COMPLETE,
  WORKSPACE_FILES_CHANGED,
} from "@/utils/workspaceUpload";
import { v4 } from "uuid";
import System from "@/models/system";
import { useDropzone } from "react-dropzone";
import DndIcon from "./dnd-icon.png";
import Workspace from "@/models/workspace";
import showToast from "@/utils/toast";
import FileUploadWarningModal from "./FileUploadWarningModal";
import { useTranslation } from "react-i18next";
import { touchThreadDraft } from "@/utils/threadDraft";

import type {
  AttachmentDocument,
  ParsedWorkspaceFile,
} from "@coregenie/contracts";
import type { DropEvent, FileRejection } from "react-dropzone";

export interface Attachment {
  uid: string;
  file: File;
  contentString: string | null;
  status: "in_progress" | "success" | "failed" | "embedded" | "added_context";
  error: string | null;
  document?: AttachmentDocument;
  type: "attachment" | "upload" | "workspace_file";
}
interface PendingFile {
  attachment: Attachment;
  parsedFileId: number;
  tokenCount: number;
}
interface Uploader {
  files: Attachment[];
  ready: boolean;
  dragging: boolean;
  uploading?: number;
  canUpload?: boolean;
  setDragging: (dragging: boolean) => void;
  onDrop: (
    files: File[],
    rejected?: FileRejection[],
    event?: DropEvent
  ) => void;
  parseAttachments: () => {
    name: string;
    mime: string;
    contentString: string;
  }[];
  queueWorkspaceFiles: (files: File[]) => Promise<void> | void;
}
export const DndUploaderContext = createContext<Uploader | null>(null);
export function useDndUploader() {
  const uploader = useContext(DndUploaderContext);
  if (!uploader)
    throw new Error("Upload controls require an uploader provider");
  return uploader;
}
export const REMOVE_ATTACHMENT_EVENT = "ATTACHMENT_REMOVE";
export const CLEAR_ATTACHMENTS_EVENT = "ATTACHMENT_CLEAR";
export const PASTE_ATTACHMENT_EVENT = "ATTACHMENT_PASTED";
export const ATTACHMENTS_PROCESSING_EVENT = "ATTACHMENTS_PROCESSING";
export const ATTACHMENTS_PROCESSED_EVENT = "ATTACHMENTS_PROCESSED";
export const PARSED_FILE_ATTACHMENT_REMOVED_EVENT =
  "PARSED_FILE_ATTACHMENT_REMOVED";

declare global {
  interface WindowEventMap {
    [REMOVE_ATTACHMENT_EVENT]: CustomEvent<
      Pick<Attachment, "uid" | "document" | "type">
    >;
    [PARSED_FILE_ATTACHMENT_REMOVED_EVENT]: CustomEvent<{
      document: ParsedWorkspaceFile;
    }>;
    [PASTE_ATTACHMENT_EVENT]: CustomEvent<{
      files: File[];
      destination?: "rag" | "workspace" | "conversation";
    }>;
  }
}
export function DnDFileUploaderProvider({
  workspace,
  threadSlug = null,
  children,
}: React.PropsWithChildren<{
  workspace: { slug: string; viewerAccess?: unknown };
  threadSlug?: string | null;
}>) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<Attachment[]>([]);
  const [ready, setReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const scope = useRef<object | null>(null);
  useEffect(() => {
    const current = {};
    scope.current = current;
    setUploading(0);
    return () => {
      if (scope.current === current) scope.current = null;
    };
  }, [workspace?.slug, threadSlug]);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [embedProgress, setEmbedProgress] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [tokenCount, setTokenCount] = useState(0);
  const [maxTokens, setMaxTokens] = useState(Number.POSITIVE_INFINITY);
  useEffect(() => {
    System.checkDocumentProcessorOnline().then((status) => setReady(status));
  }, []);

  useEffect(() => {
    window.addEventListener(REMOVE_ATTACHMENT_EVENT, handleRemove);
    window.addEventListener(CLEAR_ATTACHMENTS_EVENT, resetAttachments);
    window.addEventListener(PASTE_ATTACHMENT_EVENT, handlePastedAttachment);
    window.addEventListener(
      PARSED_FILE_ATTACHMENT_REMOVED_EVENT,
      handleRemoveParsedFile
    );

    return () => {
      window.removeEventListener(REMOVE_ATTACHMENT_EVENT, handleRemove);
      window.removeEventListener(CLEAR_ATTACHMENTS_EVENT, resetAttachments);
      window.removeEventListener(
        PARSED_FILE_ATTACHMENT_REMOVED_EVENT,
        handleRemoveParsedFile
      );
      window.removeEventListener(
        PASTE_ATTACHMENT_EVENT,
        handlePastedAttachment
      );
    };
  }, [workspace?.slug, threadSlug]);

  /**
   * Handles the removal of a parsed file attachment from the uploader queue.
   * Only uses the document id to remove the file from the queue
   */
  async function handleRemoveParsedFile(
    event: WindowEventMap[typeof PARSED_FILE_ATTACHMENT_REMOVED_EVENT]
  ) {
    const { document } = event.detail;
    setFiles((prev) =>
      prev.filter((prevFile) => prevFile.document?.id !== document.id)
    );
  }

  /**
   * Remove file from uploader queue.
   */
  async function handleRemove(
    event: WindowEventMap[typeof REMOVE_ATTACHMENT_EVENT]
  ) {
    const { uid, document, type } = event.detail;
    setFiles((prev) => prev.filter((prevFile) => prevFile.uid !== uid));
    if (!document?.location) return;
    if (type === "workspace_file") {
      await Workspace.deleteWorkspaceFile(workspace.slug, document.location);
      return;
    }
    await Workspace.deleteAndUnembedFile(workspace.slug, document.location);
  }

  /**
   * Clear queue of attached files currently in prompt box
   */
  function resetAttachments() {
    setFiles([]);
  }

  /**
   * Turns files into attachments we can send as body request to backend
   * for a chat.
   */
  function parseAttachments() {
    return files.flatMap(({ file, status, type, document, contentString }) => {
      if (status === "failed") return [];
      if (type === "workspace_file" && document?.location)
        return [
          {
            name: file.name,
            mime: "application/anythingllm-workspace-file",
            contentString: `/workspace/${document.location}`,
          },
        ];
      return type === "attachment" && contentString
        ? [{ name: file.name, mime: file.type, contentString }]
        : [];
    });
  }

  /**
   * Handle pasted attachments.
   */
  async function handlePastedAttachment(
    event: WindowEventMap[typeof PASTE_ATTACHMENT_EVENT]
  ) {
    const { files = [] } = event.detail;
    if (!files.length) return;
    if (event.detail.destination === "conversation") return onDrop(files);
    await queueFiles(files, event.detail.destination ?? "rag");
  }

  async function queueFiles(
    inputFiles: File[],
    destination: "rag" | "workspace" = "rag"
  ) {
    if (inputFiles.length) touchThreadDraft(threadSlug);
    const newAccepted: Attachment[] = [];
    for (const file of inputFiles) {
      if (destination === "workspace") {
        newAccepted.push({
          uid: v4(),
          file,
          contentString: null,
          status: "in_progress",
          error: null,
          type: "workspace_file",
        });
      } else if (file.type.startsWith("image/")) {
        newAccepted.push({
          uid: v4(),
          file,
          contentString: await toBase64(file),
          status: "success",
          error: null,
          type: "attachment",
        });
      } else {
        newAccepted.push({
          uid: v4(),
          file,
          contentString: null,
          status: "in_progress",
          error: null,
          type: "upload",
        });
      }
    }
    setFiles((prev) => [...prev, ...newAccepted]);
    await embedEligibleAttachments(
      newAccepted.filter((attachment) => attachment.status === "in_progress")
    );
  }

  /**
   * Handle dropped files.

   */
  async function onDrop(
    acceptedFiles: File[],
    _rejected?: FileRejection[],
    event?: DropEvent
  ) {
    if (acceptedFiles.length) touchThreadDraft(threadSlug);
    setDragging(false);
    // The explicit RAG file picker keeps its existing parsing behavior.
    if (event && "type" in event && event.type === "change")
      return queueFiles(acceptedFiles, "rag");
    if (!workspace?.slug || workspace.viewerAccess === "public_readonly")
      return;
    const current = scope.current;
    const slug = workspace.slug;
    const conversation = threadSlug;
    setUploading((count) => count + acceptedFiles.length);
    const paths = [];
    for (const file of acceptedFiles) {
      try {
        const form = new FormData();
        form.append("file", file, file.name);
        form.append("destination", "conversation");
        const { response, data } = await Workspace.uploadWorkspaceFile(
          slug,
          form
        );
        if (!response.ok || !data.file?.path)
          throw new Error(
            data.error || t("chat_window.workspace_upload_failed")
          );
        paths.push(`/workspace/${data.file.path}`);
        window.dispatchEvent(
          new CustomEvent(WORKSPACE_FILES_CHANGED, { detail: { slug } })
        );
      } catch (error) {
        showToast(
          `${file.name}: ${error instanceof Error ? error.message : String(error)}`,
          "error"
        );
      } finally {
        if (scope.current === current)
          setUploading((count) => Math.max(0, count - 1));
      }
    }
    if (paths.length && scope.current === current) {
      window.dispatchEvent(
        new CustomEvent(WORKSPACE_UPLOAD_COMPLETE, {
          detail: { slug, threadSlug: conversation, paths },
        })
      );
    }
  }

  /**
   * Embeds attachments that are eligible for embedding - basically files that are not images.
   */
  async function embedEligibleAttachments(newAttachments: Attachment[] = []) {
    window.dispatchEvent(new CustomEvent(ATTACHMENTS_PROCESSING_EVENT));
    const updateFile = (uid: string, update: Partial<Attachment>) => {
      setFiles((previous) =>
        previous.map((file) =>
          file.uid === uid ? { ...file, ...update } : file
        )
      );
    };
    const failure = (error: unknown) =>
      error instanceof Error && error.message
        ? error.message
        : t("chat_window.workspace_upload_failed");

    try {
      const context = newAttachments.some((file) => file.type === "upload")
        ? await Workspace.getParsedFiles(workspace.slug, threadSlug)
        : null;
      const limit = context?.contextWindow
        ? Math.floor(context.contextWindow * Workspace.maxContextWindowLimit)
        : Number.POSITIVE_INFINITY;
      setMaxTokens(limit);

      let total = context?.currentContextTokenCount ?? 0;
      const batch: PendingFile[] = [];
      await Promise.all(
        newAttachments.map(async (attachment) => {
          const { uid, file } = attachment;
          const form = new FormData();
          form.append("file", file, file.name);
          try {
            if (attachment.type === "workspace_file") {
              form.append("destination", "attachment");
              const { response, data } = await Workspace.uploadWorkspaceFile(
                workspace.slug,
                form
              );
              if (!response.ok || !data.file?.path) throw new Error(data.error);
              updateFile(uid, {
                status: "success",
                error: null,
                document: { location: data.file.path, size: data.file.size },
              });
              return;
            }
            if (threadSlug) form.append("threadSlug", threadSlug);
            const { response, data } = await Workspace.parseFile(
              workspace.slug,
              form
            );
            const parsed = data.files?.[0];
            if (!response.ok || !parsed) throw new Error(data.error);
            total += parsed.tokenCountEstimate;
            batch.push({
              attachment,
              parsedFileId: parsed.id,
              tokenCount: parsed.tokenCountEstimate,
            });
            if (total > limit) {
              setTokenCount(total);
              setPendingFiles([...batch]);
              setShowWarningModal(true);
            } else {
              updateFile(uid, {
                status: "added_context",
                error: null,
                document: parsed,
              });
            }
          } catch (error) {
            updateFile(uid, { status: "failed", error: failure(error) });
          }
        })
      );
    } catch (error) {
      for (const file of newAttachments)
        updateFile(file.uid, { status: "failed", error: failure(error) });
    } finally {
      window.dispatchEvent(new CustomEvent(ATTACHMENTS_PROCESSED_EVENT));
    }
  }

  // Handle modal actions
  const handleCloseModal = async () => {
    if (!pendingFiles.length) return;

    // Delete all files from this batch
    await Workspace.deleteParsedFiles(
      workspace.slug,
      pendingFiles.map((file) => file.parsedFileId)
    );

    // Remove all files from this batch from the UI
    setFiles((prev) =>
      prev.filter(
        (prevFile) =>
          !pendingFiles.some((file) => file.attachment.uid === prevFile.uid)
      )
    );
    setShowWarningModal(false);
    setPendingFiles([]);
    setTokenCount(0);
    window.dispatchEvent(new CustomEvent(ATTACHMENTS_PROCESSED_EVENT));
  };

  const handleContinueAnyway = async () => {
    if (!pendingFiles.length) return;
    const fileUpdates = pendingFiles.map((file) => ({
      uid: file.attachment.uid,
      updates: {
        status: "success" as const,
        error: null,
        document: { id: file.parsedFileId },
      },
    }));
    setFiles((prev) =>
      prev.map((prevFile) => {
        const update = fileUpdates.find((f) => f.uid === prevFile.uid);
        return update ? { ...prevFile, ...update.updates } : prevFile;
      })
    );
    setShowWarningModal(false);
    setPendingFiles([]);
    setTokenCount(0);
  };

  const handleEmbed = async () => {
    if (!pendingFiles.length) return;
    setIsEmbedding(true);
    setEmbedProgress(0);

    // Embed all pending files
    let completed = 0;
    const results = await Promise.all(
      pendingFiles.map((file) =>
        Workspace.embedParsedFile(workspace.slug, file.parsedFileId).then(
          (result) => {
            completed++;
            setEmbedProgress(completed);
            return result;
          }
        )
      )
    );

    // Update status for all files
    const fileUpdates = pendingFiles.map(
      (file, i): { uid: string; updates: Partial<Attachment> } => ({
        uid: file.attachment.uid,
        updates: {
          status: results[i].response.ok ? "embedded" : "failed",
          error: results[i].data?.error ?? null,
          document: results[i].data?.document,
        },
      })
    );

    setFiles((prev) =>
      prev.map((prevFile) => {
        const update = fileUpdates.find((f) => f.uid === prevFile.uid);
        return update ? { ...prevFile, ...update.updates } : prevFile;
      })
    );
    setShowWarningModal(false);
    setPendingFiles([]);
    setTokenCount(0);
    setIsEmbedding(false);
    window.dispatchEvent(new CustomEvent(ATTACHMENTS_PROCESSED_EVENT));
    showToast(
      t("chat_window.upload_menu.embed_complete", {
        count: pendingFiles.length,
      }),
      "success"
    );
  };

  return (
    <DndUploaderContext.Provider
      value={{
        files,
        ready,
        dragging,
        uploading,
        canUpload:
          Boolean(workspace?.slug) &&
          workspace.viewerAccess !== "public_readonly",
        setDragging,
        onDrop,
        parseAttachments,
        queueWorkspaceFiles: (workspaceFiles) =>
          queueFiles(workspaceFiles, "workspace"),
      }}
    >
      <FileUploadWarningModal
        show={showWarningModal}
        onClose={handleCloseModal}
        onContinue={handleContinueAnyway}
        onEmbed={handleEmbed}
        tokenCount={tokenCount}
        maxTokens={maxTokens}
        fileCount={pendingFiles.length}
        isEmbedding={isEmbedding}
        embedProgress={embedProgress}
      />
      {children}
    </DndUploaderContext.Provider>
  );
}

export default function DnDFileUploaderWrapper({
  children,
  disabled = false,
}: React.PropsWithChildren<{ disabled?: boolean }>) {
  const { t } = useTranslation();
  const {
    onDrop,
    ready,
    canUpload = ready,
    uploading = 0,
    dragging,
    setDragging,
  } = useDndUploader();
  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    disabled: disabled || !canUpload,
    noClick: true,
    noKeyboard: true,
    onDragEnter: () => setDragging(true),
    onDragLeave: () => setDragging(false),
  });

  return (
    <div
      className={`relative flex flex-col h-full w-full md:mt-0 mt-[40px] p-[1px]`}
      {...getRootProps()}
    >
      <div
        hidden={!dragging}
        className="absolute top-0 w-full h-full bg-dark-text/90 light:bg-[#C2E7FE]/90 rounded-2xl border-[4px] border-white z-[9999]"
      >
        <div className="w-full h-full flex justify-center items-center rounded-xl">
          <div className="flex flex-col gap-y-[14px] justify-center items-center">
            <img
              src={DndIcon}
              width={69}
              height={69}
              alt="Drag and drop icon"
            />
            <p className="text-white text-[24px] font-semibold">
              {t("chat_window.drop_workspace_file")}
            </p>
            <p className="text-white text-[16px] text-center">
              {t("chat_window.drop_workspace_description")}
            </p>
          </div>
        </div>
      </div>
      <input id="dnd-chat-file-uploader" {...getInputProps()} />
      {uploading > 0 && (
        <div
          role="status"
          className="absolute left-3 top-3 z-50 rounded-lg bg-theme-bg-secondary px-4 py-2 text-sm text-theme-text-primary"
        >
          {t("chat_window.workspace_drop_uploading", { count: uploading })}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * Convert image types into Base64 strings for requests.


 */
async function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Invalid file data URL"));
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}
