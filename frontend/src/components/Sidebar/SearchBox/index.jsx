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
import useUser from "@/hooks/useUser";
import useAdminView from "@/hooks/useAdminView";
import { assignedAdminWorkspaces } from "@/utils/adminView";

const DEFAULT_SEARCH_RESULTS = {
  workspaces: [],
  threads: [],
};

const SEARCH_RESULT_SELECTED = "search-result-selected";
export default function SearchBox() {
  const { t } = useTranslation();
  const { user } = useUser();
  const { adminView, canUseAdminView } = useAdminView(user);
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
      const [searchResults, assignedWorkspaces] = await Promise.all([
        Workspace.searchWorkspaceOrThread(searchValue),
        canUseAdminView && !adminView
          ? assignedAdminWorkspaces(user.id)
          : Promise.resolve(null),
      ]);
      if (!assignedWorkspaces) {
        setSearchResults(searchResults);
        return;
      }
      const assignedSlugs = new Set(
        assignedWorkspaces.map((workspace) => workspace.slug)
      );
      setSearchResults({
        workspaces: searchResults.workspaces.filter((workspace) =>
          assignedSlugs.has(workspace.slug)
        ),
        threads: searchResults.threads.filter((thread) =>
          assignedSlugs.has(thread.workspace?.slug)
        ),
      });
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
    <div className="relative flex gap-x-1 w-full items-center h-10 z-[12]">
      <div className="relative h-full w-full flex">
        <input
          ref={searchRef}
          type="search"
          aria-label={t("workbench_nav.search")}
          placeholder={t("common.search")}
          onChange={handleSearch}
          onReset={handleReset}
          onFocus={(e) => e.target.select()}
          className="border-none w-full h-full rounded-md bg-transparent pl-9 pr-2 placeholder:text-theme-text-secondary outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary text-theme-text-primary text-sm"
        />
        <MagnifyingGlass
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 transform -translate-y-1/2 text-theme-text-secondary"
          weight="bold"
          hidden={!!searchTerm}
        />
      </div>
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
          hint: thread.owner?.username
            ? `${thread.workspace.name} · ${thread.owner.username}`
            : thread.workspace.name,
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

export function CreateMenuButton({ showNewWsModal }) {
  const { t } = useTranslation();
  const { user } = useUser();
  const { adminView, canUseAdminView } = useAdminView(user);
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
    const visibleWorkspaces =
      canUseAdminView && !adminView
        ? await assignedAdminWorkspaces(user.id)
        : await Workspace.all();
    const workspaces = Workspace.orderWorkspaces(visibleWorkspaces);
    if (
      lastVisited?.slug &&
      workspaces.some((workspace) => workspace.slug === lastVisited.slug)
    )
      return lastVisited.slug;
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
    <div ref={menuRef} className="relative h-9 shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("sidebar-create.title")}
        data-tooltip-id="sidebar-create-tooltip"
        data-tooltip-content={t("sidebar-create.title")}
        onClick={() => setOpen((value) => !value)}
        className={`flex h-9 min-w-9 items-center justify-center gap-0.5 rounded-md border-none px-2 text-theme-text-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary ${open ? "bg-theme-sidebar-item-hover text-theme-text-primary" : "hover:bg-theme-sidebar-item-hover hover:text-theme-text-primary"}`}
      >
        <Plus size={16} weight="bold" className="text-theme-text-primary" />
        <CaretDown
          size={9}
          weight="bold"
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          role="menu"
          className="dsh-menu absolute right-0 top-10 z-[60] w-[190px]"
        >
          <button
            type="button"
            role="menuitem"
            disabled={creatingThread}
            onClick={createThread}
            className="dsh-menu-item group disabled:opacity-60"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md text-theme-text-secondary">
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
              <span className="mt-0.5 text-[11px] text-theme-text-secondary">
                {t("sidebar-create.thread-hint")}
              </span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={createWorkspace}
            className="dsh-menu-item group"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md text-theme-text-secondary">
              <FolderPlus size={16} weight="bold" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-semibold">
                {t("sidebar-create.workspace")}
              </span>
              <span className="mt-0.5 text-[11px] text-theme-text-secondary">
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
