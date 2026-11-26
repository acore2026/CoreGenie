import { useEffect, useRef, useState } from "react";
import { LocalToolError } from "@/utils/localTools/proposalFill";
import { defaultDownloadMeetingId } from "@/utils/meetingSelection";
import { useTranslation } from "react-i18next";
import {
  GROUPS,
  MeetingResponseError,
  loadMeetings,
  downloadList,
} from "@/utils/localTools/meetingDownload";
import type {
  DownloadedList,
  MeetingCatalog,
} from "@/utils/localTools/meetingDownload";

// Reuse the tool's control tokens, density and native keyboard interactions.
export default function MeetingDownload({
  disabled,
  control,
  input,
  onApply,
  onLoading,
}: {
  disabled: boolean;
  onLoading: (busy: boolean) => void;
  control: string;
  input: string;
  onApply: (list: DownloadedList) => Promise<void>;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`local_tools.${key}`);
  const [group, setGroup] = useState("CT4");
  const [catalog, setCatalog] = useState<MeetingCatalog | null>(null);
  const [meeting, setMeeting] = useState("");
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function run(download: boolean) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    onLoading(true);
    setLoading(download ? "download_list" : "load_meetings");
    setError("");
    try {
      if (download) {
        const result = await downloadList(group, meeting, controller.signal);
        if (!controller.signal.aborted) await onApply(result);
      } else {
        const result = await loadMeetings(group, controller.signal);
        if (!controller.signal.aborted) {
          setCatalog(result);
          setMeeting(defaultDownloadMeetingId(result.meetings));
        }
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof LocalToolError
            ? t(`local_tools.errors.${error.code}`, error.params)
            : error instanceof MeetingResponseError && error.message
              ? error.message
              : tr("download_failed")
        );
    } finally {
      if (!controller.signal.aborted) {
        setLoading("");
        onLoading(false);
      }
    }
  }
  const locked = disabled || Boolean(loading);
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-xs text-theme-text-secondary">
          {tr("working_group")}
          <select
            aria-label={tr("working_group")}
            className={`${input} mt-1`}
            value={group}
            disabled={locked}
            onChange={(e) => {
              setGroup(e.target.value);
              setCatalog(null);
              setMeeting("");
              setError("");
            }}
          >
            {GROUPS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={control}
          disabled={locked}
          onClick={() => run(false)}
        >
          {tr(
            loading === "load_meetings" ? "loading_meetings" : "load_meetings"
          )}
        </button>
      </div>
      {catalog && (
        <>
          <label className="block text-xs text-theme-text-secondary">
            {tr("official_meeting")}
            <select
              aria-label={tr("official_meeting")}
              className={`${input} mt-1`}
              value={meeting}
              disabled={locked}
              onChange={(e) => setMeeting(e.target.value)}
            >
              <option value="">{tr("choose_meeting")}</option>
              {[...catalog.meetings].reverse().map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs leading-5 text-theme-text-secondary">
            {tr(catalog.stale ? "meetings_stale" : "latest_meeting_hint")}
          </p>
          <button
            type="button"
            className={control}
            disabled={locked || !meeting}
            onClick={() => run(true)}
          >
            {tr(
              loading === "download_list" ? "downloading_list" : "download_list"
            )}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <p className="text-xs text-theme-text-secondary">
        {tr("manual_list_hint")}
      </p>
    </div>
  );
}
