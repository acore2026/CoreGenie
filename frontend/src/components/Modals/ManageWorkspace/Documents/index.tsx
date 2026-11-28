import i18n from "@/i18n";
import type {
  DocumentLibrary,
  MovedFile,
  SelectedFiles,
  WorkspaceRecord,
  FetchDocuments,
} from "./types";
import { ArrowsDownUp } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import Workspace from "../../../../models/workspace";
import System from "../../../../models/system";
import showToast from "../../../../utils/toast";
import Directory from "./Directory";
import WorkspaceDirectory from "./WorkspaceDirectory";
import { useWorkspaceEmbeddingProgress } from "@/EmbeddingProgressContext";

export default function DocumentSettings({
  workspace,
}: {
  workspace: WorkspaceRecord;
}) {
  const [highlightWorkspace, setHighlightWorkspace] = useState(false);
  const [availableDocs, setAvailableDocs] = useState<DocumentLibrary>({
    items: [],
  });
  const [loading, setLoading] = useState(true);
  const [workspaceDocs, setWorkspaceDocs] = useState<DocumentLibrary>({
    items: [],
  });
  const [selectedItems, setSelectedItems] = useState<SelectedFiles>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [movedItems, setMovedItems] = useState<MovedFile[]>([]);
  const [loadingMessage, setLoadingMessage] = useState("");
  const availableDocsRef = useRef<DocumentLibrary>(availableDocs);

  useEffect(() => {
    availableDocsRef.current = availableDocs;
  }, [availableDocs]);

  const fetchKeysRef = useRef<FetchDocuments | null>(null);
  const { embeddingProgress, startEmbedding } = useWorkspaceEmbeddingProgress(
    workspace.slug,
    {
      onProgressCleared: () => fetchKeysRef.current?.(true),
    }
  );

  async function fetchKeys(
    refetchWorkspace = false,
    options: { autoSelectNew?: boolean } = {}
  ) {
    const { autoSelectNew = false } = options;
    const previousIds = new Set();
    if (autoSelectNew && availableDocsRef.current?.items) {
      for (const folder of availableDocsRef.current.items) {
        for (const file of folder.items ?? []) {
          if (file?.id) previousIds.add(file.id);
        }
      }
    }
    setLoading(true);
    const localFiles = await System.localFiles();
    const currentWorkspace = refetchWorkspace
      ? await Workspace.bySlug(workspace.slug)
      : workspace;

    if (!localFiles || !currentWorkspace) {
      setLoading(false);
      showToast(i18n.t("chat_window.document_list_failed"), "error");
      return;
    }
    const documentsInWorkspace =
      currentWorkspace.documents?.map((doc) => doc.docpath) || [];

    // Documents that are not in the workspace
    const filteredAvailableDocs = {
      ...localFiles,
      items: localFiles.items.map((folder) => {
        if (folder.items && folder.type === "folder") {
          return {
            ...folder,
            items: folder.items.filter(
              (file) =>
                file.type === "file" &&
                !documentsInWorkspace.includes(`${folder.name}/${file.name}`)
            ),
          };
        } else {
          return folder;
        }
      }),
    };

    // Documents that are already in the workspace
    const filteredWorkspaceDocs = {
      ...localFiles,
      items: localFiles.items.map((folder) => {
        if (folder.items && folder.type === "folder") {
          return {
            ...folder,
            items: folder.items.filter(
              (file) =>
                file.type === "file" &&
                documentsInWorkspace.includes(`${folder.name}/${file.name}`)
            ),
          };
        } else {
          return folder;
        }
      }),
    };

    setAvailableDocs(filteredAvailableDocs);
    setWorkspaceDocs(filteredWorkspaceDocs);

    if (autoSelectNew) {
      const newSelected: SelectedFiles = {};
      for (const folder of filteredAvailableDocs.items ?? []) {
        for (const file of folder.items ?? []) {
          if (file?.id && !previousIds.has(file.id)) {
            newSelected[file.id] = true;
          }
        }
      }
      if (Object.keys(newSelected).length > 0) {
        setSelectedItems((prev) => ({ ...prev, ...newSelected }));
      }
    }

    setLoading(false);
  }

  useEffect(() => {
    fetchKeysRef.current = fetchKeys;
  });

  useEffect(() => {
    fetchKeys(true);
  }, []);

  const updateWorkspace = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setLoading(true);
    setLoadingMessage("This may take a while for large documents");

    const filenames = movedItems.map(
      (item) => `${item.folderName}/${item.name}`
    );
    const changesToSend = { adds: filenames };

    setSelectedItems({});
    setHasChanges(false);
    setHighlightWorkspace(false);

    // Fire the embed POST first so the server is already processing the job
    // by the time the SSE connection opens. This avoids the server sending
    // idle (no active job) before embedding has started.
    const embedPromise = Workspace.modifyEmbeddings(
      workspace.slug,
      changesToSend
    );
    startEmbedding(workspace.slug, filenames);

    embedPromise.catch((error) => {
      showToast(`Workspace update failed: ${error}`, "error", {
        clear: true,
      });
    });

    setLoading(false);
    setLoadingMessage("");
    setMovedItems([]);
  };

  const moveSelectedItemsToWorkspace = () => {
    setHighlightWorkspace(false);
    setHasChanges(true);

    const movedByFolder = new Map(
      availableDocs.items.map((folder) => [
        folder.name,
        folder.items.filter((file) => selectedItems[file.id]),
      ])
    );
    const moved = [...movedByFolder].flatMap(([folderName, files]) =>
      files.map((file) => ({ ...file, folderName }))
    );
    setMovedItems((previous) => [...previous, ...moved]);
    setAvailableDocs({
      ...availableDocs,
      items: availableDocs.items.map((folder) => ({
        ...folder,
        items: folder.items.filter((file) => !selectedItems[file.id]),
      })),
    });
    setWorkspaceDocs({
      ...workspaceDocs,
      items: workspaceDocs.items.map((folder) => ({
        ...folder,
        items: [...folder.items, ...(movedByFolder.get(folder.name) ?? [])],
      })),
    });
    setSelectedItems({});
  };

  const visibleAvailableDocs = useMemo(() => {
    const embeddingFilenames = new Set(Object.keys(embeddingProgress ?? {}));
    if (embeddingFilenames.size === 0) return availableDocs;
    return {
      ...availableDocs,
      items: (availableDocs.items ?? []).map((folder) => {
        if (folder.items && folder.type === "folder") {
          return {
            ...folder,
            items: folder.items.filter(
              (file) => !embeddingFilenames.has(`${folder.name}/${file.name}`)
            ),
          };
        }
        return folder;
      }),
    };
  }, [availableDocs, embeddingProgress]);

  return (
    <div className="flex upload-modal -mt-6 z-10 relative">
      <Directory
        files={visibleAvailableDocs}
        setFiles={setAvailableDocs}
        loading={loading}
        loadingMessage={loadingMessage}
        setLoading={setLoading}
        workspace={workspace}
        fetchKeys={fetchKeys}
        selectedItems={selectedItems}
        setSelectedItems={setSelectedItems}
        setHighlightWorkspace={setHighlightWorkspace}
        moveToWorkspace={moveSelectedItemsToWorkspace}
        setLoadingMessage={setLoadingMessage}
      />
      <div className="upload-modal-arrow">
        <ArrowsDownUp className="text-white text-base font-bold rotate-90 w-11 h-11" />
      </div>
      <WorkspaceDirectory
        workspace={workspace}
        files={workspaceDocs}
        highlightWorkspace={highlightWorkspace}
        loading={loading}
        loadingMessage={loadingMessage}
        setLoadingMessage={setLoadingMessage}
        setLoading={setLoading}
        fetchKeys={fetchKeys}
        hasChanges={hasChanges}
        saveChanges={updateWorkspace}
        movedItems={movedItems}
      />
    </div>
  );
}
