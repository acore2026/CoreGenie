import { useEffect, useRef, useState } from "react";
import { titleCase } from "text-case";
import Admin from "@/models/admin";
import { Trash } from "@phosphor-icons/react";
import { copyTextToClipboard } from "@/utils/clipboard";
import showToast from "@/utils/toast";

export default function InviteRow({ invite }) {
  const rowRef = useRef(null);
  const [status, setStatus] = useState(invite.status);
  const [copied, setCopied] = useState(false);
  const handleDelete = async () => {
    if (
      !window.confirm(
        `Are you sure you want to deactivate this invite?\nAfter you do this it will not longer be useable.\n\nThis action is irreversible.`
      )
    )
      return false;
    if (rowRef?.current) {
      rowRef.current.children[0].innerText = "Disabled";
    }
    setStatus("disabled");
    await Admin.disableInvite(invite.id);
  };
  const copyInviteLink = async () => {
    if (!invite) return false;
    try {
      await copyTextToClipboard(
        `${window.location.origin}/accept-invite/${invite.code}`
      );
      setCopied(true);
      showToast("Invite link copied to clipboard", "success", {
        clear: true,
      });
    } catch (error) {
      console.error("Failed to copy invite link:", error);
      showToast("Unable to copy the invite link.", "error", { clear: true });
    }
  };

  useEffect(() => {
    function resetStatus() {
      if (!copied) return false;
      setTimeout(() => {
        setCopied(false);
      }, 3000);
    }
    resetStatus();
  }, [copied]);

  return (
    <>
      <tr
        ref={rowRef}
        className="bg-transparent text-white text-opacity-80 text-xs font-medium border-b border-white/10 h-10"
      >
        <td scope="row" className="px-6 whitespace-nowrap">
          {titleCase(status)}
        </td>
        <td className="px-6">{invite.createdBy?.username || "deleted user"}</td>
        <td className="px-6">{invite.createdAt}</td>
        <td className="px-6 flex items-center gap-x-6 h-full mt-1">
          {status === "pending" && (
            <>
              <button
                onClick={copyInviteLink}
                disabled={copied}
                className="text-xs font-medium text-blue-300 rounded-lg hover:text-blue-400 hover:underline"
              >
                {copied ? "Copied" : "Copy Invite Link"}
              </button>
              <button
                onClick={handleDelete}
                className="text-xs font-medium text-white/80 light:text-black/80 hover:light:text-red-500 hover:text-red-300 rounded-lg px-2 py-1 hover:bg-white hover:light:bg-red-50 hover:bg-opacity-10"
              >
                <Trash className="h-5 w-5" />
              </button>
            </>
          )}
        </td>
      </tr>
    </>
  );
}
