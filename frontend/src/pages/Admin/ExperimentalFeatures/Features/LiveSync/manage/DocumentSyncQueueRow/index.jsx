import { useRef } from "react";
import { Trash } from "@phosphor-icons/react";
import { stripUuidAndJsonFromString } from "@/components/Modals/ManageWorkspace/Documents/Directory/utils";
import { formatDateTime, formatRelativeTime } from "@/utils/dateTime";
import System from "@/models/system";

export default function DocumentSyncQueueRow({ queue }) {
  const rowRef = useRef(null);
  const handleDelete = async () => {
    rowRef?.current?.remove();
    await System.experimentalFeatures.liveSync.setWatchStatusForDocument(
      queue.workspaceDoc.workspace.slug,
      queue.workspaceDoc.docpath,
      false
    );
  };

  return (
    <>
      <tr
        ref={rowRef}
        className="bg-transparent text-white text-opacity-80 text-sm font-medium"
      >
        <td scope="row" className="px-6 py-4 whitespace-nowrap">
          {stripUuidAndJsonFromString(queue.workspaceDoc.filename)}
        </td>
        <td className="px-6 py-4">{formatRelativeTime(queue.lastSyncedAt)}</td>
        <td className="px-6 py-4">
          {formatDateTime(queue.nextSyncAt, "lll")}
          <i className="text-xs px-2">
            ({formatRelativeTime(queue.nextSyncAt)})
          </i>
        </td>
        <td className="px-6 py-4">{formatDateTime(queue.createdAt, "lll")}</td>
        <td className="px-6 py-4 flex items-center gap-x-6">
          <button
            onClick={handleDelete}
            className="border-none font-medium px-2 py-1 rounded-lg text-theme-text-primary hover:text-red-500"
          >
            <Trash className="h-5 w-5" />
          </button>
        </td>
      </tr>
    </>
  );
}
