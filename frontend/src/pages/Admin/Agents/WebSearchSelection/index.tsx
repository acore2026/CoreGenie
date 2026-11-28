import type { SystemKeys } from "@/models/system";
import type { SkillPanelProps } from "../skills";
import { useEffect, useRef, useState } from "react";
import Admin from "@/models/admin";
import BaiduSearchIcon from "./icons/baidu.png";
import SearXNGSearchIcon from "./icons/searxng.png";
import TavilySearchIcon from "./icons/tavily.svg";
import DuckDuckGoIcon from "./icons/duckduckgo.png";
import ExaIcon from "./icons/exa.png";
import {
  CaretUpDown,
  MagnifyingGlass,
  X,
  ListMagnifyingGlass,
} from "@phosphor-icons/react";
import Toggle from "@/components/lib/Toggle";
import SearchProviderItem from "./SearchProviderItem";
import WebSearchImage from "@/media/agents/scrape-websites.png";
import {
  BaiduSearchOptions,
  SearXNGOptions,
  TavilySearchOptions,
  DuckDuckGoOptions,
  ExaSearchOptions,
} from "./SearchProviderOptions";

export interface SearchProvider {
  name: string;
  value: string;
  logo: string;
  description: string;
  options: (settings: SystemKeys) => React.ReactNode;
}
const SEARCH_PROVIDERS: SearchProvider[] = [
  {
    name: "Tavily Search",
    value: "tavily-search",
    logo: TavilySearchIcon,
    options: (settings) => <TavilySearchOptions settings={settings} />,
    description:
      "面向 AI Agent 的主流搜索 API，直接返回清洗后的网页正文与来源（含免费额度）。",
  },
  {
    name: "Exa Search",
    value: "exa-search",
    logo: ExaIcon,
    options: (settings) => <ExaSearchOptions settings={settings} />,
    description: "支持语义检索和整页内容提取，适合深度资料调研。",
  },
  {
    name: "百度千帆 AI 搜索",
    value: "baidu-search",
    logo: BaiduSearchIcon,
    options: (settings) => <BaiduSearchOptions settings={settings} />,
    description: "基于百度千帆 AI 搜索接口，中文检索效果更好。",
  },
  {
    name: "SearXNG",
    value: "searxng-engine",
    logo: SearXNGSearchIcon,
    options: (settings) => <SearXNGOptions settings={settings} />,
    description: "开源可自部署的聚合搜索引擎，适合内网和注重隐私的场景。",
  },
  {
    name: "DuckDuckGo",
    value: "duckduckgo-engine",
    logo: DuckDuckGoIcon,
    options: () => <DuckDuckGoOptions />,
    description: "免费、免配置的默认网页搜索选项。",
  },
];

export default function AgentWebSearchSelection({
  skill,
  title,
  description,
  settings,
  toggleSkill,
  enabled = false,
  setHasChanges,
}: SkillPanelProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [filteredResults, setFilteredResults] = useState<SearchProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("duckduckgo-engine");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMenuOpen, setSearchMenuOpen] = useState(false);

  function updateChoice(selection: string) {
    setSearchQuery("");
    setSelectedProvider(selection);
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

  useEffect(() => {
    const filtered = SEARCH_PROVIDERS.filter((provider) =>
      provider.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setFilteredResults(filtered);
  }, [searchQuery, selectedProvider]);

  useEffect(() => {
    Admin.systemPreferencesByFields(["agent_search_provider"])
      .then((res) =>
        setSelectedProvider(
          res?.settings?.agent_search_provider ?? "duckduckgo-engine"
        )
      )
      .catch(() => setSelectedProvider("duckduckgo-engine"));
  }, []);

  const selectedSearchProviderObject =
    SEARCH_PROVIDERS.find((provider) => provider.value === selectedProvider) ??
    SEARCH_PROVIDERS[0];

  return (
    <div className="p-2">
      <div className="flex flex-col gap-y-[18px] max-w-[500px]">
        <div className="flex w-full justify-between items-center">
          <div className="flex items-center gap-x-2">
            <ListMagnifyingGlass
              size={24}
              color="var(--theme-text-primary)"
              weight="bold"
            />
            <label
              htmlFor="name"
              className="text-theme-text-primary text-md font-bold"
            >
              {title}
            </label>
          </div>
          <Toggle
            size="lg"
            enabled={enabled}
            onChange={() => toggleSkill(skill)}
          />
        </div>
        <img
          src={WebSearchImage}
          alt="联网搜索"
          className="w-full rounded-md"
        />
        <p className="text-theme-text-secondary text-opacity-60 text-xs font-medium py-1.5">
          {description}
        </p>
        <div hidden={!enabled}>
          <div className="relative">
            <input
              type="hidden"
              name="system::agent_search_provider"
              value={selectedProvider}
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
                      name="web-provider-search"
                      autoComplete="off"
                      placeholder="搜索可用的搜索引擎"
                      className="border-none -ml-4 my-2 bg-transparent z-20 pl-12 h-[38px] w-full px-4 py-1 text-sm outline-none text-theme-text-primary placeholder:text-theme-text-primary placeholder:font-medium"
                      onChange={(e) => setSearchQuery(e.target.value)}
                      ref={searchInputRef}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.preventDefault();
                      }}
                    />
                    <X
                      size={20}
                      weight="bold"
                      className="cursor-pointer text-white hover:text-x-button"
                      onClick={handleXButton}
                    />
                  </div>
                  <div className="flex-1 pl-4 pr-2 flex flex-col gap-y-1 overflow-y-auto white-scrollbar pb-4 max-h-[245px]">
                    {filteredResults.map((provider) => (
                      <SearchProviderItem
                        provider={provider}
                        key={provider.name}
                        checked={selectedProvider === provider.value}
                        onClick={() => updateChoice(provider.value)}
                      />
                    ))}
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
                    src={selectedSearchProviderObject.logo}
                    alt={`${selectedSearchProviderObject.name} logo`}
                    className="w-10 h-10 rounded-md"
                  />
                  <div className="flex flex-col text-left">
                    <div className="text-sm font-semibold text-white">
                      {selectedSearchProviderObject.name}
                    </div>
                    <div className="mt-1 text-xs text-description">
                      {selectedSearchProviderObject.description}
                    </div>
                  </div>
                </div>
                <CaretUpDown size={24} weight="bold" className="text-white" />
              </button>
            )}
          </div>
          <div className="mt-4 flex flex-col gap-y-1">
            {selectedSearchProviderObject.options(settings)}
          </div>
        </div>
      </div>
    </div>
  );
}
