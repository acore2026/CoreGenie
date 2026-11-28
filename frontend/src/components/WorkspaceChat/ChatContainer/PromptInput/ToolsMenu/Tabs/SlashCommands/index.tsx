import { useState, useEffect, useMemo, useCallback } from "react";
import { Plus } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import System, {
  type SlashPreset,
  type SlashPresetInput,
} from "@/models/system";
import { useModal } from "@/hooks/useModal";
import AddPresetModal from "./SlashPresets/AddPresetModal";
import EditPresetModal from "./SlashPresets/EditPresetModal";
import showToast from "@/utils/toast";
import { PROMPT_INPUT_EVENT } from "@/components/WorkspaceChat/ChatContainer/PromptInput";
import useToolsMenuItems from "../../useToolsMenuItems";
import SlashCommandRow from "./SlashCommandRow";
import DisplayOrder from "@/components/DisplayOrder";

interface CommandItem {
  command: string;
  description: string;
  autoSubmit: boolean;
  preset?: SlashPreset;
}

export default function SlashCommandsTab({
  sendCommand,
  setShowing,
  promptRef,
  highlightedIndex = -1,
  registerItemCount,
}: {
  sendCommand: (command: { text: string; autoSubmit?: boolean }) => void;
  setShowing: (show: boolean) => void;
  promptRef: React.RefObject<HTMLTextAreaElement>;
  highlightedIndex?: number;
  registerItemCount?: (count: number) => void;
}) {
  const { t } = useTranslation();
  const {
    isOpen: isAddModalOpen,
    openModal: openAddModal,
    closeModal: closeAddModal,
  } = useModal();
  const {
    isOpen: isEditModalOpen,
    openModal: openEditModal,
    closeModal: closeEditModal,
  } = useModal();
  const [presets, setPresets] = useState<SlashPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<SlashPreset | null>(
    null
  );

  useEffect(() => {
    fetchPresets();
  }, []);

  const fetchPresets = async () => {
    const presets = await System.getSlashCommandPresets();
    setPresets(presets);
  };

  // Build the list of selectable items for keyboard navigation and rendering.
  // /reset is a static English string since the backend matches it exactly.
  // During an agent session it ends the session AND clears the chat.
  const items = useMemo<CommandItem[]>(
    () => [
      {
        command: "/reset",
        description: t("chat_window.preset_reset_description"),
        autoSubmit: true,
      },
      ...presets.map((preset) => ({
        command: preset.command,
        description: preset.description,
        autoSubmit: false,
        preset,
      })),
    ],
    [presets, t]
  );

  const handleUseCommand = useCallback(
    (command: string, autoSubmit = false) => {
      setShowing(false);

      // Auto-submit commands (/reset) fire immediately
      if (autoSubmit) {
        sendCommand({ text: command, autoSubmit: true });
        promptRef?.current?.focus();
        return;
      }

      // Insert the command at the cursor, replacing a trailing "/" if present
      const textarea = promptRef?.current;
      if (!textarea) return;
      const cursor = textarea.selectionStart;
      const value = textarea.value;
      const charBefore = cursor > 0 ? value[cursor - 1] : "";
      const insertStart = charBefore === "/" ? cursor - 1 : cursor;
      const newValue =
        value.slice(0, insertStart) + command + value.slice(cursor);

      window.dispatchEvent(
        new CustomEvent(PROMPT_INPUT_EVENT, {
          detail: { messageContent: newValue },
        })
      );
      textarea.focus();
      const newCursor = insertStart + command.length;
      setTimeout(() => textarea.setSelectionRange(newCursor, newCursor), 0);
    },
    [sendCommand, setShowing, promptRef]
  );

  useToolsMenuItems({
    items,
    highlightedIndex,
    onSelect: (item) => {
      const text = item.preset ? `${item.command} ` : item.command;
      handleUseCommand(text, item.autoSubmit);
    },
    registerItemCount,
  });

  const handleSavePreset = async (preset: SlashPresetInput) => {
    const { error } = await System.createSlashCommandPreset(preset);
    if (error) {
      showToast(error, "error");
      return false;
    }
    fetchPresets();
    closeAddModal();
    return true;
  };

  const handleEditPreset = (preset: SlashPreset) => {
    setSelectedPreset(preset);
    openEditModal();
  };

  const handleUpdatePreset = async (updatedPreset: SlashPreset) => {
    const { error } = await System.updateSlashCommandPreset(
      updatedPreset.id,
      updatedPreset
    );
    if (error) {
      showToast(error, "error");
      return;
    }
    fetchPresets();
    closeEditModal();
    setSelectedPreset(null);
  };

  const handleDeletePreset = async (presetId: number) => {
    await System.deleteSlashCommandPreset(presetId);
    fetchPresets();
    closeEditModal();
    setSelectedPreset(null);
  };

  return (
    <>
      {items.map((item, index) => (
        <SlashCommandRow
          key={item.preset?.id ?? item.command}
          command={item.command}
          description={item.description}
          onClick={() =>
            handleUseCommand(
              item.preset ? `${item.command} ` : item.command,
              item.autoSubmit
            )
          }
          onEdit={() => {
            if (item.preset) handleEditPreset(item.preset);
          }}
          showMenu={!!item.preset}
          highlighted={highlightedIndex === index}
        />
      ))}

      {/* Add new */}
      <div
        onClick={openAddModal}
        className="flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer hover:bg-zinc-700/50 light:hover:bg-slate-100"
      >
        <Plus
          size={12}
          weight="bold"
          className="text-white light:text-slate-900"
        />
        <span className="text-xs text-white light:text-slate-900">
          {t("chat_window.add_new")}
        </span>
      </div>

      {/* Modals */}
      <DisplayOrder items={presets} kind="commands" onSaved={fetchPresets} />
      <AddPresetModal
        isOpen={isAddModalOpen}
        onClose={closeAddModal}
        onSave={handleSavePreset}
      />
      {selectedPreset && (
        <EditPresetModal
          isOpen={isEditModalOpen}
          onClose={() => {
            closeEditModal();
            setSelectedPreset(null);
          }}
          onSave={handleUpdatePreset}
          onDelete={handleDeletePreset}
          preset={selectedPreset}
        />
      )}
    </>
  );
}
