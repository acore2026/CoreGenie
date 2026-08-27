import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isMobile } from "react-device-detect";
import { CaretUpDown, MagnifyingGlass, X } from "@phosphor-icons/react";
import Sidebar from "@/components/SettingsSidebar";
import PreLoader from "@/components/Preloader";
import LLMItem from "@/components/LLMSelection/LLMItem";
import CTAButton from "@/components/lib/CTAButton";
import OpenAiOptions from "@/components/LLMSelection/OpenAiOptions";
import GenericOpenAiOptions from "@/components/LLMSelection/GenericOpenAiOptions";
import OpenAiLogo from "@/media/llmprovider/openai.png";
import GenericOpenAiLogo from "@/media/llmprovider/generic-openai.png";
import AnythingLLMIcon from "@/media/logo/anything-llm-icon.png";
import System from "@/models/system";
import showToast from "@/utils/toast";

export const AVAILABLE_LLM_PROVIDERS = [
  {
    name: "OpenAI",
    value: "openai",
    logo: OpenAiLogo,
    options: (settings) => <OpenAiOptions settings={settings} />,
    description: "Connect directly to the OpenAI API.",
    requiredConfig: ["OpenAiKey"],
  },
  {
    name: "Generic OpenAI",
    value: "generic-openai",
    logo: GenericOpenAiLogo,
    options: (settings) => <GenericOpenAiOptions settings={settings} />,
    description: "Connect to an OpenAI-compatible chat completion API.",
    requiredConfig: ["GenericOpenAiBasePath", "GenericOpenAiModelPref"],
    connectionConfig: ["GenericOpenAiBasePath"],
  },
];

export const ALL_LLM_PROVIDERS = AVAILABLE_LLM_PROVIDERS;
export const LLM_PREFERENCE_CHANGED_EVENT = "llm-preference-changed";

export default function GeneralLLMPreference() {
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLLM, setSelectedLLM] = useState(null);
  const [searchMenuOpen, setSearchMenuOpen] = useState(false);
  const searchInputRef = useRef(null);
  const { t } = useTranslation();

  useEffect(() => {
    System.keys().then((_settings) => {
      setSettings(_settings);
      setSelectedLLM(
        AVAILABLE_LLM_PROVIDERS.some(
          (provider) => provider.value === _settings?.LLMProvider
        )
          ? _settings.LLMProvider
          : "openai"
      );
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const update = () => setHasChanges(true);
    window.addEventListener(LLM_PREFERENCE_CHANGED_EVENT, update);
    return () =>
      window.removeEventListener(LLM_PREFERENCE_CHANGED_EVENT, update);
  }, []);

  const handleSubmit = async (event) => {
    event?.preventDefault?.();
    const form = event?.currentTarget || document.querySelector("#llm-form");
    const data = { LLMProvider: selectedLLM };
    if (form)
      for (const [key, value] of new FormData(form).entries())
        data[key] = value;
    setSaving(true);
    const { error } = await System.updateSystem(data);
    showToast(
      error
        ? `Failed to save LLM settings: ${error}`
        : "LLM preferences saved successfully.",
      error ? "error" : "success"
    );
    setSaving(false);
    setHasChanges(Boolean(error));
  };

  const filtered = AVAILABLE_LLM_PROVIDERS.filter((provider) =>
    provider.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const selected = AVAILABLE_LLM_PROVIDERS.find(
    (provider) => provider.value === selectedLLM
  );

  return (
    <div className="w-screen h-screen overflow-hidden bg-theme-bg-container flex">
      <Sidebar />
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] bg-theme-bg-secondary w-full h-full overflow-y-scroll p-4 md:p-0"
      >
        {loading ? (
          <div className="w-full h-full flex justify-center items-center">
            <PreLoader />
          </div>
        ) : (
          <form id="llm-form" onSubmit={handleSubmit} className="flex w-full">
            <div className="flex flex-col w-full px-1 md:pl-6 md:pr-[50px] md:py-6 py-16">
              <div className="pb-6 border-white/10 border-b-2">
                <p className="text-lg leading-6 font-bold text-white">
                  {t("llm.title")}
                </p>
                <p className="text-xs leading-[18px] text-white/60">
                  {t("llm.description")}
                </p>
              </div>
              <div className="w-full justify-end flex">
                {hasChanges && (
                  <CTAButton type="submit" className="mt-3 mr-0 -mb-14 z-10">
                    {saving ? "Saving..." : "Save changes"}
                  </CTAButton>
                )}
              </div>
              <div className="text-base font-bold text-white mt-6 mb-4">
                {t("llm.provider")}
              </div>
              <div className="relative">
                {searchMenuOpen && (
                  <div
                    className="fixed inset-0 bg-black/70 backdrop-blur-sm z-10"
                    onClick={() => setSearchMenuOpen(false)}
                  />
                )}
                {searchMenuOpen ? (
                  <div className="absolute top-0 left-0 w-full max-w-[640px] bg-theme-settings-input-bg rounded-lg border-2 border-primary-button z-20 p-4">
                    <div className="relative flex items-center border-b border-[#9CA3AF] mb-3">
                      <MagnifyingGlass
                        size={20}
                        weight="bold"
                        className="absolute left-0 text-theme-text-primary"
                      />
                      <input
                        ref={searchInputRef}
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        onKeyDown={(event) =>
                          event.key === "Enter" && event.preventDefault()
                        }
                        placeholder="Search LLM providers"
                        className="border-none bg-transparent pl-8 h-[38px] w-full text-sm outline-none text-theme-text-primary"
                      />
                      <X
                        size={20}
                        weight="bold"
                        className="cursor-pointer text-white"
                        onClick={() => {
                          setSearchQuery("");
                          setSearchMenuOpen(false);
                        }}
                      />
                    </div>
                    <div className="flex flex-col gap-y-1">
                      {filtered.map((provider) => (
                        <LLMItem
                          key={provider.value}
                          name={provider.name}
                          value={provider.value}
                          image={provider.logo}
                          description={provider.description}
                          checked={selectedLLM === provider.value}
                          onClick={() => {
                            setSelectedLLM(provider.value);
                            setSearchMenuOpen(false);
                            setHasChanges(true);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <button
                    className="w-full max-w-[640px] min-h-[64px] bg-theme-settings-input-bg rounded-lg flex items-center p-[14px] justify-between border-2 border-transparent hover:border-primary-button"
                    type="button"
                    onClick={() => setSearchMenuOpen(true)}
                  >
                    <div className="flex gap-x-4 items-center">
                      <img
                        src={selected?.logo || AnythingLLMIcon}
                        alt="Provider logo"
                        className="w-10 h-10 rounded-md"
                      />
                      <div className="text-left">
                        <div className="text-sm font-semibold text-white">
                          {selected?.name || "None selected"}
                        </div>
                        <div className="mt-1 text-xs text-description">
                          {selected?.description}
                        </div>
                      </div>
                    </div>
                    <CaretUpDown
                      size={24}
                      weight="bold"
                      className="text-white"
                    />
                  </button>
                )}
              </div>
              <div
                onChange={() => setHasChanges(true)}
                className="mt-4 flex flex-col gap-y-1"
              >
                {selected?.options?.(settings)}
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
