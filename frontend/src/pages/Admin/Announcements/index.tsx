import type { Announcement } from "@coregenie/contracts/announcements.mts";
import { useEffect, useState } from "react";
import {
  Plus,
  PencilSimple,
  Trash,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import Sidebar from "@/components/SettingsSidebar";
import Announcements from "@/models/announcements";
import AnnouncementModal, {
  AnnouncementContent,
  buttonClass,
  primaryClass,
  inputClass,
  formatDate,
} from "@/components/Announcements/Modal";
import showToast from "@/utils/toast";
import AnnouncementMarkdown from "@/components/Announcements/Markdown";

function localDate(value?: string) {
  const date = value ? new Date(value) : new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export default function AdminAnnouncements() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Partial<Announcement> | null>(null);
  const [viewing, setViewing] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  async function load() {
    setLoading(true);
    setError("");
    try {
      setItems((await Announcements.list(true)).announcements ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  const visible = items.filter(
    (item) =>
      (!status || item.status === status) &&
      `${item.title}\n${item.content}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase())
  );
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true);
    setDeleteError("");
    try {
      await Announcements.delete(deleting.id);
      setDeleting(null);
      showToast(t("announcements.deleted"), "success");
      await load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="announcements-admin flex h-screen w-screen overflow-hidden bg-theme-bg-container">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto bg-theme-bg-secondary px-5 pb-8 pt-20 md:px-7 md:py-7">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-theme-sidebar-border pb-6 md:pr-7">
          <div className="max-w-xl">
            <h1 className="text-xl font-semibold text-theme-text-primary">
              {t("announcements.manage")}
            </h1>
            <p className="mt-2 text-sm leading-6 text-theme-text-secondary">
              {t("announcements.description")}
            </p>
          </div>
          <button className={primaryClass} onClick={() => setEditing({})}>
            <Plus size={17} />
            {t("announcements.create")}
          </button>
        </header>
        <div className="my-5 flex flex-col gap-3 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <MagnifyingGlass
              size={18}
              className="pointer-events-none absolute left-3 top-3 text-theme-text-secondary"
            />
            <input
              type="search"
              aria-label={t("announcements.search")}
              placeholder={t("announcements.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${inputClass} pl-10`}
            />
          </div>
          <select
            className={`${inputClass} sm:!w-40`}
            aria-label={t("announcements.all")}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{t("announcements.all")}</option>
            {["active", "scheduled", "expired"].map((value) => (
              <option key={value} value={value}>
                {t(`announcements.${value}`)}
              </option>
            ))}
          </select>
        </div>
        {loading ? (
          <p role="status" className="py-8 text-sm text-theme-text-secondary">
            {t("announcements.loading")}
          </p>
        ) : error ? (
          <div role="alert">
            <p className="mb-3 text-sm text-theme-text-primary">{error}</p>
            <button className={buttonClass} onClick={load}>
              {t("announcements.retry")}
            </button>
          </div>
        ) : !visible.length ? (
          <p className="py-12 text-center text-sm text-theme-text-secondary">
            {t(
              items.length ? "announcements.noResults" : "announcements.empty"
            )}
          </p>
        ) : (
          <ul className="divide-y divide-theme-sidebar-border">
            {visible.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-4 py-5 sm:flex-row sm:items-start"
              >
                <button
                  onClick={() => setViewing(item)}
                  aria-label={`${t("announcements.view")}：${item.title}`}
                  className="min-w-0 flex-1 rounded-lg p-2 text-left transition-colors hover:bg-theme-sidebar-item-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="break-words text-base font-semibold text-theme-text-primary">
                      {item.title}
                    </h2>
                    <span className="rounded-md bg-theme-sidebar-subitem-hover px-2 py-1 text-xs text-theme-text-secondary">
                      {t(`announcements.${item.status}`)}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 break-words text-sm leading-6 text-theme-text-secondary">
                    {item.content}
                  </p>
                  <p className="mt-3 text-xs leading-5 text-theme-text-secondary">
                    {formatDate(item.startsAt)} —{" "}
                    {item.expiresAt
                      ? formatDate(item.expiresAt)
                      : t("announcements.noExpiry")}
                  </p>
                </button>
                <div className="flex shrink-0 gap-2 sm:pt-2">
                  <button
                    className={buttonClass}
                    onClick={() => setEditing(item)}
                  >
                    <PencilSimple size={16} />
                    {t("announcements.edit")}
                  </button>
                  <button
                    className={buttonClass}
                    onClick={() => {
                      setDeleteError("");
                      setDeleting(item);
                    }}
                  >
                    <Trash size={16} />
                    {t("announcements.delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
      {editing && (
        <Editor
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {viewing && (
        <AnnouncementModal
          title={viewing.title}
          onClose={() => setViewing(null)}
        >
          <AnnouncementContent item={viewing} />
        </AnnouncementModal>
      )}
      {deleting && (
        <AnnouncementModal
          title={t("announcements.confirmDelete")}
          busy={busy}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button
                className={buttonClass}
                disabled={busy}
                onClick={() => setDeleting(null)}
              >
                {t("announcements.cancel")}
              </button>
              <button
                className={`${buttonClass} !text-red-500`}
                disabled={busy}
                onClick={remove}
              >
                {t(busy ? "announcements.deleting" : "announcements.delete")}
              </button>
            </>
          }
        >
          <p className="break-words text-sm leading-6">
            {t("announcements.deleteHint", { title: deleting.title })}
          </p>
          {deleteError && (
            <p role="alert" className="mt-3 text-sm text-red-500">
              {deleteError}
            </p>
          )}
        </AnnouncementModal>
      )}
    </div>
  );
}

function Editor({
  item,
  onClose,
  onSaved,
}: {
  item: Partial<Announcement>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(item.title || "");
  const [content, setContent] = useState(item.content || "");
  const [start, setStart] = useState(localDate(item.startsAt));
  const [end, setEnd] = useState(
    item.expiresAt ? localDate(item.expiresAt) : ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (end && new Date(end) <= new Date(start)) {
      setError(t("announcements.invalidPeriod"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await Announcements.save(item.id, {
        title,
        content,
        startsAt: new Date(start).toISOString(),
        expiresAt: end ? new Date(end).toISOString() : null,
      });
      showToast(t("announcements.saved"), "success");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AnnouncementModal
      title={t(item.id ? "announcements.edit" : "announcements.create")}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className={buttonClass} disabled={busy} onClick={onClose}>
            {t("announcements.cancel")}
          </button>
          <button
            type="submit"
            form="announcement-editor"
            className={primaryClass}
            disabled={busy}
          >
            {t(busy ? "announcements.saving" : "announcements.save")}
          </button>
        </>
      }
    >
      <form
        id="announcement-editor"
        onSubmit={submit}
        className="flex flex-col gap-5"
      >
        <label className="flex flex-col gap-2 text-sm font-medium">
          {t("announcements.titleLabel")}
          <input
            autoFocus
            required
            maxLength={120}
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          {t("announcements.contentLabel")}
          <textarea
            required
            maxLength={20000}
            rows={8}
            className={`${inputClass} resize-y leading-6`}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={busy}
          />
        </label>
        <p className="-mt-3 text-xs text-theme-text-secondary">
          {t("announcements.markdownHint")}
        </p>
        <details className="rounded-lg border border-theme-sidebar-border p-3">
          <summary className="cursor-pointer rounded text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button">
            {t("announcements.preview")}
          </summary>
          <div className="mt-4">
            <AnnouncementMarkdown content={content} />
          </div>
        </details>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
            {t("announcements.startsAt")}
            <input
              type="datetime-local"
              required
              className={inputClass}
              value={start}
              onChange={(e) => setStart(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
            {t("announcements.expiresAt")}
            <input
              type="datetime-local"
              className={inputClass}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>
        <p className="text-xs leading-5 text-theme-text-secondary">
          {t("announcements.timeHint")}
        </p>
        {item.id && (
          <p className="text-xs leading-5 text-theme-text-secondary">
            {t("announcements.editHint")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        )}
      </form>
    </AnnouncementModal>
  );
}
