import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";

const EDIT_EVENT = "toggle-message-edit";
const DELETE_EVENT = "delete-message";

type MessageKey = { chatId?: number | null; role?: string };
interface ActionsState {
  editingMessage: MessageKey | null;
  isEditing: (chatId?: number | null, role?: string) => boolean;
  isDeleted: (chatId?: number | null) => boolean;
  clearEditing: () => void;
}
declare global {
  interface WindowEventMap {
    [EDIT_EVENT]: CustomEvent<MessageKey>;
    [DELETE_EVENT]: CustomEvent<Pick<MessageKey, "chatId">>;
  }
}
const MessageActionsContext = createContext<ActionsState | null>(null);

/**
 * Provider that centralizes edit/delete event listeners for all messages.
 * Instead of each message registering its own window listener (O(n) listeners),
 * this provider registers just 2 listeners total and dispatches to messages via context.
 */
export function MessageActionsProvider({ children }: React.PropsWithChildren) {
  const [editingMessage, setEditingMessage] = useState<MessageKey | null>(null);
  const [deletedMessages, setDeletedMessages] = useState(new Set<number>());

  useEffect(() => {
    function handleEditEvent(e: WindowEventMap[typeof EDIT_EVENT]) {
      const { chatId, role } = e.detail;
      if (!chatId || !role) return;

      setEditingMessage((prev) => {
        if (prev?.chatId === chatId && prev?.role === role) {
          return null;
        }
        return { chatId, role };
      });
    }

    function handleDeleteEvent(e: WindowEventMap[typeof DELETE_EVENT]) {
      const { chatId } = e.detail;
      if (!chatId) return;

      setDeletedMessages((prev) => {
        const next = new Set(prev);
        next.add(chatId);
        return next;
      });
    }

    window.addEventListener(EDIT_EVENT, handleEditEvent);
    window.addEventListener(DELETE_EVENT, handleDeleteEvent);

    return () => {
      window.removeEventListener(EDIT_EVENT, handleEditEvent);
      window.removeEventListener(DELETE_EVENT, handleDeleteEvent);
    };
  }, []);

  const isEditing = useCallback(
    (chatId?: number | null, role?: string) => {
      return editingMessage?.chatId === chatId && editingMessage?.role === role;
    },
    [editingMessage]
  );

  const isDeleted = useCallback(
    (chatId?: number | null) => {
      return chatId != null && deletedMessages.has(chatId);
    },
    [deletedMessages]
  );

  const clearEditing = useCallback(() => {
    setEditingMessage(null);
  }, []);

  return (
    <MessageActionsContext.Provider
      value={{ editingMessage, isEditing, isDeleted, clearEditing }}
    >
      {children}
    </MessageActionsContext.Provider>
  );
}

export function useMessageActionsContext() {
  return useContext(MessageActionsContext);
}

export { EDIT_EVENT, DELETE_EVENT };
