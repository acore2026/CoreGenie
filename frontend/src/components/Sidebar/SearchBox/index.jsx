import { useState, useEffect, useRef } from "react";
import {
  CaretDown,
  ChatCircleText,
  CircleNotch,
  FolderPlus,
  MagnifyingGlass,
  Plus,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import paths from "@/utils/paths";
import Preloader from "@/components/Preloader";
import debounce from "lodash.debounce";
import Workspace from "@/models/workspace";
import { Tooltip } from "react-tooltip";
import { LAST_VISITED_WORKSPACE } from "@/utils/constants";
import { safeJsonParse } from "@/utils/request";
import showToast from "@/utils/toast";
import { THREAD_CREATED_EVENT } from "../events";

const DEFAULT_SEARCH_RESULTS = {
  workspaces: [],
  threads: [],
};

const SEARCH_RESULT_SELECTED = "search-result-selected";
export default function SearchBox({ showNewWsModal }) {
  const { t } = useTranslation();
  const searchRef = useRef(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchResults, setSearchResults] = useState(DEFAULT_SEARCH_RESULTS);
  const handleSearch = debounce(handleSearchDebounced, 500);

  async function handleSearchDebounced(e) {
    try {
      const searchValue = e.target.value;
      setSearchTerm(searchValue);
      setLoading(true);
      const searchResults =
        await Workspace.searchWorkspaceOrThread(searchValue);
      setSearchResults(searchResults);
    } catch (error) {
      console.error(error);
      setSearchResults(DEFAULT_SEARCH_RESULTS);
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    searchRef.current.value = "";
    setSearchTerm("");
    setLoading(false);
    setSearchResults(DEFAULT_SEARCH_RESULTS);
  }

  useEffect(() => {
    window.addEventListener(SEARCH_RESULT_SELECTED, handleReset);
    return () =>
      window.removeEventListener(SEARCH_RESULT_SELECTED, handleReset);
  }, []);

  return (
    <div className="relative flex gap-x-[5px] w-full items-center h-[32px] z-[12]">
      <div className="relative h-full w-full flex">
        <input
          ref={searchRef}
          type="search"
          placeholder={t("common.search")}
          onChange={handleSearch}
          onReset={handleReset}
          onFocus={(e) => e.target.select()}
          className="border-none w-full h-full rounded-lg bg-theme-sidebar-item-default pl-9 focus:pl-4 pr-1 placeholder:text-white/50 light:placeholder:text-slate-500 placeholder:font-semibold outline-none text-theme-text-primary search-input peer text-sm"
        />
        <MagnifyingGlass
          size={14}
          className="absolute left-3 top-1/2 transform -translate-y-1/2 text-theme-settings-input-placeholder peer-focus:invisible"
          weight="bold"
          hidden={!!searchTerm}
        />
      </div>
      <CreateMenuButton showNewWsModal={showNewWsModal} />
      <SearchResults
        searchResults={searchResults}
        searchTerm={searchTerm}
        loading={loading}
      />
    </div>
  );
}

function SearchResultWrapper({ children }) {
  return (
    <div className="absolute right-0 top-[6.2%] w-full flex flex-col gap-y-[24px] h-auto bg-theme-modal-border light:bg-theme-bg-primary light:border-2 light:border-theme-modal-border rounded-lg p-[16px] z-10 max-h-[calc(100%-24px)] overflow-y-scroll no-scroll">
      {children}
    </div>
  );
}

function SearchResults({ searchResults, searchTerm, loading }) {
  if (!searchTerm || searchTerm.length < 3) return null;
  if (loading)
    return (
      <SearchResultWrapper>
        <div className="flex flex-col gap-y-[8px] h-[200px] justify-center items-center">
          <Preloader size={5} />
          <p className="text-theme-text-secondary text-xs font-semibold text-center">
            Searching for "{searchTerm}"
          </p>
        </div>
      </SearchResultWrapper>
    );

  if (
    searchResults.workspaces.length === 0 &&
    searchResults.threads.length === 0
  ) {
    return (
      <SearchResultWrapper>
        <div className="flex flex-col gap-y-[8px] h-[200px] justify-center items-center">
          <p className="text-theme-text-secondary text-xs font-semibold text-center">
            No results found for
            <br />
            <span className="text-theme-text-primary font-semibold text-sm">
              "{searchTerm}"
            </span>
          </p>
        </div>
      </SearchResultWrapper>
    );
  }

  return (
    <SearchResultWrapper>
      <SearchResultCategory
        name="Workspaces"
        items={searchResults.workspaces?.map((workspace) => ({
          id: workspace.slug,
          to: paths.workspace.chat(workspace.slug),
          name: workspace.name,
        }))}
      />
      <SearchResultCategory
        name="Threads"
        items={searchResults.threads?.map((thread) => ({
          id: thread.slug,
          to: paths.workspace.thread(thread.workspace.slug, thread.slug),
          name: thread.name,
          hint: thread.workspace.name,
        }))}
      />
    </SearchResultWrapper>
  );
}

function SearchResultCategory({ items, name }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-col gap-y-[8px]">
      <p className="text-theme-text-secondary text-xs uppercase font-semibold px-[4px]">
        {name}
      </p>
      <div className="flex flex-col gap-y-[6px]">
        {items.map((item) => (
          <SearchResultItem
            key={item.id}
            to={item.to}
            name={item.name}
            hint={item.hint}
          />
        ))}
      </div>
    </div>
  );
}

function SearchResultItem({ to, name, hint }) {
  return (
    <Link
      to={to}
      onClick={() => window.dispatchEvent(new Event(SEARCH_RESULT_SELECTED))}
      className="hover:bg-[#FFF]/10 light:hover:bg-[#000]/10 transition-all duration-300 rounded-sm px-[8px] py-[2px]"
    >
      <p className="text-theme-text-primary text-sm truncate w-[80%]">
        {name}
        {hint && (
          <span className="text-theme-text-secondary text-xs ml-[4px]">
            | {hint}
          </span>
        )}
      </p>
    </Link>
  );
}

function CreateMenuButton({ showNewWsModal }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { slug = null } = useParams();
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [creatingThread, setCreatingThread] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  async function resolveActiveWorkspaceSlug() {
    if (slug) return slug;
    const lastVisited = safeJsonParse(
      localStorage.getItem(LAST_VISITED_WORKSPACE)
    );
    if (lastVisited?.slug) return lastVisited.slug;
    const workspaces = Workspace.orderWorkspaces(await Workspace.all());
    return workspaces[0]?.slug || null;
  }

  async function createThread() {
    if (creatingThread) return;
    setCreatingThread(true);
    try {
      const workspaceSlug = await resolveActiveWorkspaceSlug();
      if (!workspaceSlug) {
        showToast(t("sidebar-create.no-workspace"), "error", { clear: true });
        return;
      }
      const { thread, error } = await Workspace.threads.new(workspaceSlug);
      if (!thread) {
        showToast(error || t("sidebar-create.thread-failed"), "error", {
          clear: true,
        });
        return;
      }
      window.dispatchEvent(
        new CustomEvent(THREAD_CREATED_EVENT, {
          detail: { workspaceSlug, thread },
        })
      );
      setOpen(false);
      navigate(paths.workspace.thread(workspaceSlug, thread.slug));
    } finally {
      setCreatingThread(false);
    }
  }

  function createWorkspace() {
    setOpen(false);
    showNewWsModal();
  }

  return (
    <div ref={menuRef} className="relative h-full shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("sidebar-create.title")}
        data-tooltip-id="sidebar-create-tooltip"
        data-tooltip-content={t("sidebar-create.title")}
        onClick={() => setOpen((value) => !value)}
        className={`border-none h-full min-w-[38px] flex items-center justify-center gap-0.5 rounded-lg px-2 transition-all duration-200 ${open ? "bg-white/90 shadow-[0_5px_16px_rgba(0,0,0,0.24)]" : "bg-white hover:bg-white/80 light:hover:bg-slate-300"}`}
      >
        <Plus
          size={16}
          weight="bold"
          className="text-black light:text-slate-500"
        />
        <CaretDown
          size={9}
          weight="bold"
          className={`text-black/55 light:text-slate-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-[38px] right-0 w-[190px] rounded-xl border border-white/10 light:border-slate-300 bg-zinc-900 light:bg-white p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.4)] z-[60]"
        >
          <button
            type="button"
            role="menuitem"
            disabled={creatingThread}
            onClick={createThread}
            className="group w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-white light:text-slate-800 hover:bg-white/10 light:hover:bg-slate-100 disabled:opacity-60"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-400/15 text-sky-300 light:text-sky-700">
              {creatingThread ? (
                <CircleNotch size={16} className="animate-spin" />
              ) : (
                <ChatCircleText size={16} weight="bold" />
              )}
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-semibold">
                {creatingThread
                  ? t("sidebar-create.creating-thread")
                  : t("sidebar-create.thread")}
              </span>
              <span className="mt-0.5 text-[11px] text-zinc-400 light:text-slate-500">
                {t("sidebar-create.thread-hint")}
              </span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={createWorkspace}
            className="group w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-white light:text-slate-800 hover:bg-white/10 light:hover:bg-slate-100"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-400/15 text-amber-300 light:text-amber-700">
              <FolderPlus size={16} weight="bold" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-semibold">
                {t("sidebar-create.workspace")}
              </span>
              <span className="mt-0.5 text-[11px] text-zinc-400 light:text-slate-500">
                {t("sidebar-create.workspace-hint")}
              </span>
            </span>
          </button>
        </div>
      )}
      <Tooltip
        id="sidebar-create-tooltip"
        place="top"
        delayShow={300}
        className="tooltip !text-xs"
      />
    </div>
  );
}
