import truncate from "truncate";
import { X, Trash } from "@phosphor-icons/react";
import System, { type ChatLogEntry } from "@/models/system";
import ModalWrapper from "@/components/ModalWrapper";
import { useModal } from "@/hooks/useModal";
import MarkdownRenderer from "../MarkdownRenderer";
import { safeJsonParse } from "@/utils/request";

export default function ChatRow({
  chat,
  onDelete,
}: {
  chat: ChatLogEntry;
  onDelete: (id: number) => void;
}) {
  const {
    isOpen: isPromptOpen,
    openModal: openPromptModal,
    closeModal: closePromptModal,
  } = useModal();
  const {
    isOpen: isResponseOpen,
    openModal: openResponseModal,
    closeModal: closeResponseModal,
  } = useModal();

  const parsed = safeJsonParse<{ text?: unknown } | null>(chat.response, null);
  const response = typeof parsed?.text === "string" ? parsed.text : "";
  const handleDelete = async () => {
    if (
      !window.confirm(
        `Are you sure you want to delete this chat?\n\nThis action is irreversible.`
      )
    )
      return false;
    const result = await System.deleteChat(chat.id);
    if (result.success) onDelete(chat.id);
  };

  return (
    <>
      <tr className="bg-transparent text-white text-opacity-80 text-xs font-medium border-b border-white/10 h-10">
        <td className="px-6 font-medium whitespace-nowrap text-white">
          {chat.id}
        </td>
        <td className="px-6 font-medium whitespace-nowrap text-white">
          {chat.user?.username}
        </td>
        <td className="px-6">{chat.workspace?.name}</td>
        <td
          onClick={openPromptModal}
          className="px-6 border-transparent cursor-pointer transform transition-transform duration-200 hover:scale-105 hover:shadow-lg"
        >
          {truncate(chat.prompt, 40)}
        </td>
        <td
          onClick={openResponseModal}
          className="px-6 cursor-pointer transform transition-transform duration-200 hover:scale-105 hover:shadow-lg"
        >
          {truncate(response, 40)}
        </td>
        <td className="px-6">{chat.createdAt}</td>
        <td className="px-6 flex items-center gap-x-6 h-full mt-1">
          <button
            onClick={handleDelete}
            className="text-xs font-medium text-white/80 light:text-black/80 hover:light:text-red-500 hover:text-red-300 rounded-lg px-2 py-1 hover:bg-white hover:light:bg-red-50 hover:bg-opacity-10"
          >
            <Trash className="h-5 w-5" />
          </button>
        </td>
      </tr>
      <ModalWrapper isOpen={isPromptOpen}>
        <TextPreview text={chat.prompt} closeModal={closePromptModal} />
      </ModalWrapper>
      <ModalWrapper isOpen={isResponseOpen}>
        <TextPreview
          text={<MarkdownRenderer content={response} />}
          closeModal={closeResponseModal}
        />
      </ModalWrapper>
    </>
  );
}
const TextPreview = ({
  text,
  closeModal,
}: {
  text: React.ReactNode;
  closeModal: () => void;
}) => {
  return (
    <div className="relative w-full md:max-w-2xl max-h-full">
      <div className="w-full max-w-2xl bg-theme-bg-secondary rounded-lg shadow border-2 border-theme-modal-border overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b rounded-t border-theme-modal-border">
          <h3 className="text-xl font-semibold text-white">Viewing Text</h3>
          <button
            onClick={closeModal}
            type="button"
            className="bg-transparent rounded-lg text-sm p-1.5 ml-auto inline-flex items-center bg-sidebar-button hover:bg-theme-modal-border hover:border-theme-modal-border hover:border-opacity-50 border-transparent border"
          >
            <X className="text-white text-lg" />
          </button>
        </div>
        <div className="w-full p-6">
          <pre className="w-full h-[200px] py-2 px-4 whitespace-pre-line overflow-auto rounded-lg bg-zinc-900 light:bg-theme-bg-secondary border border-gray-500 text-white text-sm">
            {text}
          </pre>
        </div>
      </div>
    </div>
  );
};
