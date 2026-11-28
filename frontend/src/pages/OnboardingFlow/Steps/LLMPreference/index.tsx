import { MagnifyingGlass } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LLM_PROVIDERS as LLMS } from "@/components/LLMSelection/providers";
import LLMItem from "@/components/lib/ProviderItem";
import System, { type SystemKeys } from "@/models/system";
import paths from "@/utils/paths";
import showToast from "@/utils/toast";

import type { StepProps } from "../index";
export default function LLMPreference({
  setHeader,
  setForwardBtn,
  setBackBtn,
}: StepProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLLM, setSelectedLLM] = useState("openai");
  const [settings, setSettings] = useState<SystemKeys | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const hiddenSubmitButtonRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    System.keys().then((_settings) => {
      setSettings(_settings);
      setSelectedLLM(
        LLMS.find((provider) => provider.value === _settings?.LLMProvider)
          ?.value ?? "openai"
      );
    });
  }, []);

  useEffect(() => {
    setHeader({
      title: t("onboarding.llm.title"),
      description: t("onboarding.llm.description"),
    });
    setForwardBtn({
      showing: true,
      disabled: false,
      onClick: async () => {
        hiddenSubmitButtonRef.current?.click();
      },
    });
    setBackBtn({
      showing: true,
      disabled: false,
      onClick: () => navigate(paths.onboarding.home()),
    });
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = {
      LLMProvider: selectedLLM,
      EmbeddingEngine: "native",
      VectorDB: "lancedb",
      ...Object.fromEntries(new FormData(event.currentTarget)),
    };

    const { error } = await System.updateSystem(data);
    if (error)
      return showToast(`Failed to save LLM settings: ${error}`, "error");
    navigate(paths.onboarding.userSetup());
  };

  const selected = LLMS.find((provider) => provider.value === selectedLLM);
  const filtered = LLMS.filter((provider) =>
    provider.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="w-full">
      <div className="w-full relative border-theme-chat-input-border shadow border-2 rounded-lg text-white">
        <div className="w-full p-4 absolute top-0 rounded-t-lg backdrop-blur-sm">
          <div className="w-full flex items-center sticky top-0">
            <MagnifyingGlass
              size={16}
              weight="bold"
              className="absolute left-4 z-30 text-theme-text-primary"
            />
            <input
              type="text"
              placeholder="Search LLM providers"
              className="bg-theme-bg-secondary placeholder:text-theme-text-secondary z-20 pl-10 h-[38px] rounded-full w-full px-4 py-1 text-sm border border-theme-chat-input-border outline-none text-theme-text-primary"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) =>
                event.key === "Enter" && event.preventDefault()
              }
            />
          </div>
        </div>
        <div className="px-4 pt-[70px] flex flex-col gap-y-1 max-h-[390px] overflow-y-auto no-scroll pb-4">
          {filtered.map((provider) => (
            <LLMItem
              key={provider.value}
              name={provider.name}
              value={provider.value}
              image={provider.logo}
              description={provider.description}
              checked={selectedLLM === provider.value}
              onClick={() => setSelectedLLM(provider.value)}
            />
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-y-1">
        {selected?.options(settings)}
      </div>
      <button
        type="submit"
        ref={hiddenSubmitButtonRef}
        hidden
        aria-hidden="true"
      />
    </form>
  );
}
