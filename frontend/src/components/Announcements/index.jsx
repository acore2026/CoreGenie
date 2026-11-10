import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Bell } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import Announcements from "@/models/announcements";
import { AUTH_TOKEN, AUTH_USER } from "@/utils/constants";
import { CLOSE_MOBILE_SIDEBAR_EVENT } from "@/components/Sidebar/events";
import AnnouncementModal, {
  AnnouncementContent,
  buttonClass,
  primaryClass,
  formatDate,
} from "./Modal";

const Context = createContext(null);
const active = (item) =>
  new Date(item.startsAt).getTime() <= Date.now() &&
  (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now());

export function AnnouncementProvider({ children }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [queue, setQueue] = useState([]);
  const [selected, setSelected] = useState(null);
  const [listOpen, setListOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const identity = useRef(null);
  const requestId = useRef(0);
  const closing = useRef(false);
  const [, tick] = useState(0);

  const load = useCallback(async (automatic = false) => {
    const current = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const { announcements } = await Announcements.list();
      if (current !== requestId.current) return;
      setItems(announcements);
      if (automatic)
        setQueue(
          announcements
            .filter((item) => !item.readAt && active(item))
            .map((item) => item.id)
        );
    } catch (e) {
      if (current === requestId.current) setError(e.message);
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, []);
  const activate = useCallback(() => {
    const key = `${localStorage.getItem(AUTH_TOKEN) || "single-user"}:${localStorage.getItem(AUTH_USER) || ""}`;
    if (identity.current === key) return;
    identity.current = key;
    setItems([]);
    setQueue([]);
    setSelected(null);
    setListOpen(false);
    load(true);
  }, [load]);
  // Re-evaluate queued notices when their display period ends, even on an idle page.
  useEffect(() => {
    const deadlines = items
      .filter(
        (item) =>
          item.expiresAt && new Date(item.expiresAt).getTime() > Date.now()
      )
      .map((item) => new Date(item.expiresAt).getTime());
    if (!deadlines.length) return;
    const timer = setTimeout(
      () => tick((n) => n + 1),
      Math.min(
        2147483647,
        Math.max(1, Math.min(...deadlines) - Date.now() + 10)
      )
    );
    return () => clearTimeout(timer);
  });
  const popup = items.find(
    (item) => queue.includes(item.id) && !item.readAt && active(item)
  );
  const displayed = selected
    ? items.find((item) => item.id === selected)
    : popup;
  async function closeNotice() {
    if (!displayed || closing.current) return;
    closing.current = true;
    setBusy(true);
    setError("");
    try {
      if (!displayed.readAt) {
        const { readAt } = await Announcements.read(displayed.id);
        setItems((prev) =>
          prev.map((item) =>
            item.id === displayed.id ? { ...item, readAt } : item
          )
        );
      }
      setQueue((prev) => prev.filter((id) => id !== displayed.id));
      setSelected(null);
    } catch (e) {
      if (e.status === 404) {
        setItems((prev) => prev.filter((item) => item.id !== displayed.id));
        setSelected(null);
      } else setError(t("announcements.readError"));
    } finally {
      closing.current = false;
      setBusy(false);
    }
  }
  const openList = () => {
    window.dispatchEvent(new Event(CLOSE_MOBILE_SIDEBAR_EVENT));
    setListOpen(true);
    load();
  };
  return (
    <Context.Provider
      value={{
        activate,
        openList,
        unread: items.filter((item) => !item.readAt && active(item)).length,
      }}
    >
      {children}
      {listOpen && !selected && !popup && (
        <AnnouncementModal
          title={t("announcements.title")}
          onClose={() => setListOpen(false)}
        >
          {loading ? (
            <p role="status" className="text-sm text-theme-text-secondary">
              {t("announcements.loading")}
            </p>
          ) : error ? (
            <div role="alert">
              <p className="mb-3 text-sm">{error}</p>
              <button className={buttonClass} onClick={() => load()}>
                {t("announcements.retry")}
              </button>
            </div>
          ) : !items.length ? (
            <p className="py-8 text-center text-sm text-theme-text-secondary">
              {t("announcements.empty")}
            </p>
          ) : (
            <ul className="divide-y divide-theme-sidebar-border">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    className="w-full rounded-lg px-2 py-4 text-left transition-colors hover:bg-theme-sidebar-item-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button"
                    onClick={() => {
                      setError("");
                      setSelected(item.id);
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <span className="min-w-0 flex-1 break-words text-sm font-semibold">
                        {item.title}
                      </span>
                      <span className="shrink-0 text-xs text-theme-text-secondary">
                        {t(`announcements.${item.readAt ? "read" : "unread"}`)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 break-words text-xs leading-5 text-theme-text-secondary">
                      {item.content}
                    </p>
                    <div className="mt-3 flex gap-3 text-xs text-theme-text-secondary">
                      <time>{formatDate(item.startsAt)}</time>
                      {!active(item) && (
                        <span>{t("announcements.expired")}</span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </AnnouncementModal>
      )}
      {displayed && (
        <AnnouncementModal
          key={displayed.id}
          title={displayed.title}
          onClose={closeNotice}
          busy={busy}
          footer={
            <>
              <span className="mr-auto text-xs text-theme-text-secondary">
                {t("announcements.closeHint")}
              </span>
              <button
                className={primaryClass}
                onClick={closeNotice}
                disabled={busy}
              >
                {t(busy ? "announcements.saving" : "announcements.acknowledge")}
              </button>
            </>
          }
        >
          <AnnouncementContent item={displayed} />
          {error && (
            <p role="alert" className="mt-4 text-sm text-red-500">
              {error}
            </p>
          )}
        </AnnouncementModal>
      )}
    </Context.Provider>
  );
}

export function AnnouncementSession() {
  const { activate } = useContext(Context);
  useEffect(() => {
    activate();
  }, [activate]);
  return null;
}

export default function AnnouncementButton({ menu = false, onOpen }) {
  const { t } = useTranslation();
  const context = useContext(Context);
  return (
    <button
      type="button"
      role={menu ? "menuitem" : undefined}
      aria-label={t("announcements.title")}
      title={t("announcements.title")}
      onClick={() => {
        onOpen?.();
        context.openList();
      }}
      className={
        menu
          ? "dsh-menu-item min-h-10 whitespace-nowrap"
          : "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-theme-text-secondary transition-colors hover:bg-theme-sidebar-item-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button"
      }
    >
      <Bell size={18} />
      {menu && t("announcements.title")}
      {context.unread > 0 && (
        <span
          className={
            menu
              ? "ml-auto text-xs tabular-nums"
              : "absolute right-0 top-0 rounded-full bg-primary-button px-1 text-[10px] text-white tabular-nums"
          }
        >
          {context.unread}
        </span>
      )}
    </button>
  );
}
