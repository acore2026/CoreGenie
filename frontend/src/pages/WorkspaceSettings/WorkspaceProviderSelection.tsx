import { useRef, useState } from "react";
import AnythingLLMIcon from "@/media/logo/coregenie-mark.svg";
import WorkspaceProviderItem from "./WorkspaceProviderItem";
import type { WorkspaceRecord } from "@/models/workspace";
import type { SystemKeys } from "@/models/system";
import {
  LLM_PROVIDERS,
  type LLMProvider,
} from "@/components/LLMSelection/providers";
import { CaretUpDown, MagnifyingGlass, X } from "@phosphor-icons/react";
import WorkspaceModelSelection from "./WorkspaceModelSelection";
import { useTranslation } from "react-i18next";

interface Props {
  workspace: WorkspaceRecord;
  settings: SystemKeys;
  setHasChanges: (value: boolean) => void;
  agent?: boolean;
}
export default function WorkspaceProviderSelection({
  workspace,
  settings,
  setHasChanges,
  agent = false,
}: Props) {
  const { t } = useTranslation();
  const fallback = agent ? "none" : "default";
  const inherited: LLMProvider = {
    name: t("workspace_model.inherit"),
    value: fallback,
    logo: AnythingLLMIcon,
    options: () => null,
    requiredConfig: [],
    description: t(
      agent ? "workspace_model.inherit_agent" : "workspace_model.inherit_chat"
    ),
  };
  const choices = [inherited, ...LLM_PROVIDERS];
  const [selectedLLM, setSelectedLLM] = useState(
    (agent ? workspace.agentProvider : workspace.chatProvider) ?? fallback
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMenuOpen, setSearchMenuOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  function updateLLMChoice(selection: string) {
    setSearchQuery("");
    setSelectedLLM(selection);
    setSearchMenuOpen(false);
    setHasChanges(true);
  }

  function handleXButton() {
    if (searchQuery.length > 0) {
      setSearchQuery("");
      if (searchInputRef.current) searchInputRef.current.value = "";
    } else {
      setSearchMenuOpen(!searchMenuOpen);
    }
  }

  const filteredLLMs = choices.filter((llm) =>
    llm.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const selectedLLMObject = choices.find((llm) => llm.value === selectedLLM);

  return (
    <div className="flex flex-col gap-y-[8px]">
      <div className="flex flex-col gap-y-[8px]">
        <label htmlFor="name" className="block input-label">
          {t(agent ? "agent.provider.title" : "chat.llm.title")}
        </label>
        <p className="text-white text-opacity-60 text-xs font-medium">
          {t(agent ? "agent.provider.description" : "chat.llm.description")}
        </p>
      </div>

      <div className="relative">
        <input
          type="hidden"
          name={agent ? "agentProvider" : "chatProvider"}
          value={selectedLLM}
        />
        {searchMenuOpen && (
          <div
            className="fixed top-0 left-0 w-full h-full bg-black bg-opacity-70 backdrop-blur-sm z-10"
            onClick={() => setSearchMenuOpen(false)}
          />
        )}
        {searchMenuOpen ? (
          <div className="absolute top-0 left-0 w-full max-w-[640px] max-h-[310px] min-h-[64px] bg-theme-settings-input-bg rounded-lg flex flex-col justify-between cursor-pointer border-2 border-primary-button z-20">
            <div className="w-full flex flex-col gap-y-1">
              <div className="flex items-center sticky top-0 z-10 border-b border-[#9CA3AF] mx-4 bg-theme-settings-input-bg">
                <MagnifyingGlass
                  size={20}
                  weight="bold"
                  className="absolute left-4 z-30 text-theme-text-primary -ml-4 my-2"
                />
                <input
                  type="text"
                  name="llm-search"
                  autoComplete="off"
                  placeholder={t("chat.llm.search")}
                  className="border-none -ml-4 my-2 bg-transparent z-20 pl-12 h-[38px] w-full px-4 py-1 text-sm outline-none focus:outline-primary-button active:outline-primary-button outline-none text-theme-text-primary placeholder:text-theme-text-primary placeholder:font-medium"
                  onChange={(e) => setSearchQuery(e.target.value)}
                  ref={searchInputRef}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                />
                <X
                  size={20}
                  weight="bold"
                  className="cursor-pointer text-theme-text-primary hover:text-x-button"
                  onClick={handleXButton}
                />
              </div>
              <div className="flex-1 pl-4 pr-2 flex flex-col gap-y-1 overflow-y-auto white-scrollbar pb-4 max-h-[245px]">
                {filteredLLMs.map((llm) => {
                  return (
                    <WorkspaceProviderItem
                      llm={llm}
                      key={llm.name}
                      portalId={
                        agent
                          ? "workspace-agent-settings-container"
                          : "workspace-chat-settings-container"
                      }
                      settings={settings}
                      checked={selectedLLM === llm.value}
                      onClick={() => updateLLMChoice(llm.value)}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <button
            className="w-full max-w-[640px] h-[64px] bg-theme-settings-input-bg rounded-lg flex items-center p-[14px] justify-between cursor-pointer border-2 border-transparent hover:border-primary-button transition-all duration-300"
            type="button"
            onClick={() => setSearchMenuOpen(true)}
          >
            <div className="flex gap-x-4 items-center">
              <img
                src={selectedLLMObject?.logo ?? AnythingLLMIcon}
                alt={`${selectedLLMObject?.name ?? selectedLLM} logo`}
                className="w-10 h-10 rounded-md"
              />
              <div className="flex flex-col text-left">
                <div className="text-sm font-semibold text-white">
                  {selectedLLMObject?.name ?? selectedLLM}
                </div>
                <div className="text-xs text-description">
                  {selectedLLMObject?.description}
                </div>
              </div>
            </div>
            <CaretUpDown size={24} weight="bold" className="text-white" />
          </button>
        )}
      </div>
      {selectedLLM !== fallback && (
        <WorkspaceModelSelection
          key={selectedLLM}
          provider={selectedLLM}
          workspace={workspace}
          agent={agent}
          setHasChanges={setHasChanges}
        />
      )}
    </div>
  );
}
