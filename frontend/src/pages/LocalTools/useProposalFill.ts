import { useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import type { DownloadedList } from "@/utils/localTools/meetingDownload";
import {
  LIMITS,
  LocalToolError,
  readMeetingList,
  mergeMeetingLists,
  readProposal,
  matchRecords,
  planProposal,
  duplicateNames,
  isDuplicateName,
  generateProposal,
  packageResults,
} from "@/utils/localTools/proposalFill";

import type {
  ExportFile,
  MeetingFile,
  NamingMode,
  ProposalItem,
  ProposalPlan,
  PlanFailure,
  SourcedRecord,
} from "@/utils/localTools/types";

interface MeetingSelection {
  files: MeetingFile[];
  records: SourcedRecord[];
}

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function useProposalFill() {
  const { t: tr } = useTranslation(undefined, { keyPrefix: "local_tools" });
  const [meeting, setMeeting] = useState<MeetingSelection | null>(null);
  const [items, setItems] = useState<ProposalItem[]>([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [busy, setBusy] = useState<"" | "reading" | "exporting">("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [naming, setNaming] = useState<NamingMode>("number");
  const operation = useRef(false);
  const nextId = useRef(0);
  const errorText = (error: unknown): string =>
    error instanceof LocalToolError
      ? tr(`errors.${error.code}`, error.params)
      : tr("errors.read_failed");
  const locked = Boolean(busy) || remoteBusy;
  function planItem(item: ProposalItem): ProposalPlan | PlanFailure | null {
    if (!item.proposal || !item.selectedId || !meeting || item.excluded)
      return null;
    try {
      return planProposal(
        item.proposal,
        meeting.records.find((r) => r.id === item.selectedId),
        item.confirmed,
        naming
      );
    } catch (error) {
      return { error: errorText(error) };
    }
  }
  const planned = items.map((item) => ({ item, plan: planItem(item) }));
  const duplicates = duplicateNames(planned.map(({ plan }) => plan));
  const previews = planned.map(({ item, plan }) => ({
    item,
    plan,
    duplicate: !!plan?.ready && isDuplicateName(plan.outputName, duplicates),
  }));
  const canExport = previews.some(
    ({ plan, duplicate }) => plan?.ready && !duplicate
  );
  const updateItem = (id: string, changes: Partial<ProposalItem>) => {
    setNotice("");
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...changes } : item))
    );
  };

  function applyMeetingFiles(files: MeetingFile[]) {
    const records = mergeMeetingLists(files);
    setMeeting(files.length ? { files, records } : null);
    setItems((current) =>
      current.map((item) =>
        item.proposal
          ? {
              ...item,
              ...matchRecords(item.proposal, records),
              confirmed: false,
              exportError: "",
            }
          : item
      )
    );
    setNotice("");
  }

  async function applyDownloadedList(list: DownloadedList) {
    if (operation.current) return;
    operation.current = true;
    setBusy("reading");
    setError("");
    try {
      const records = await readMeetingList(list.file);
      // An official selection replaces the old list to avoid matching across meetings.
      applyMeetingFiles([
        {
          id: `meeting-${++nextId.current}`,
          name: list.file.name,
          size: list.file.size,
          records,
          source: list.source,
          fetchedAt: list.fetchedAt,
        },
      ]);
    } finally {
      operation.current = false;
      setBusy("");
    }
  }

  async function selectMeeting(event: ChangeEvent<HTMLInputElement>) {
    const chosen = [...(event.target.files || [])];
    event.target.value = "";
    if (!chosen.length || operation.current) return;
    const files = chosen;
    const existing = meeting?.files || [];
    if (existing.length + files.length > LIMITS.meetingFiles) {
      setError(tr("errors.meeting_count"));
      return;
    }
    if (
      existing.reduce((sum, file) => sum + file.size, 0) +
        files.reduce((sum, file) => sum + file.size, 0) >
      LIMITS.batchBytes
    ) {
      setError(tr("errors.meeting_size"));
      return;
    }
    operation.current = true;
    setBusy("reading");
    setError("");
    setNotice("");
    try {
      const additions: MeetingFile[] = [];
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        setProgress(
          tr("read_meeting_progress", {
            current: index + 1,
            total: files.length,
          })
        );
        await pause();
        const entry: MeetingFile = {
          id: `meeting-${++nextId.current}`,
          name: file.webkitRelativePath || file.name,
          size: file.size,
        };
        try {
          entry.records = await readMeetingList(file);
        } catch (error) {
          entry.error = errorText(error);
        }
        additions.push(entry);
      }
      applyMeetingFiles([...existing, ...additions]);
    } finally {
      operation.current = false;
      setBusy("");
      setProgress("");
    }
  }

  async function selectDocuments(
    event: ChangeEvent<HTMLInputElement>,
    folder = false
  ) {
    const chosen = [...(event.target.files || [])];
    event.target.value = "";
    if (!chosen.length || operation.current) return;
    const files = folder
      ? chosen.filter(
          (f) => /\.docx$/i.test(f.name) && !f.name.startsWith("~$")
        )
      : chosen;
    if (!files.length) {
      setError(tr("errors.no_documents"));
      return;
    }
    if (items.length + files.length > LIMITS.files) {
      setError(tr("errors.batch_count"));
      return;
    }
    if (
      items.reduce((sum, i) => sum + i.file.size, 0) +
        files.reduce((sum, f) => sum + f.size, 0) >
      LIMITS.batchBytes
    ) {
      setError(tr("errors.batch_size"));
      return;
    }
    operation.current = true;
    setBusy("reading");
    setError("");
    setNotice("");
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        setProgress(
          tr("read_progress", { current: index + 1, total: files.length })
        );
        await pause();
        const item: ProposalItem = {
          candidates: [],
          selectedId: "",
          reason: "",
          id: `proposal-${++nextId.current}`,
          file,
          confirmed: false,
          excluded: false,
        };
        try {
          item.proposal = await readProposal(file);
          Object.assign(
            item,
            meeting?.records.length
              ? matchRecords(item.proposal, meeting.records)
              : { candidates: [], selectedId: "", reason: "" }
          );
        } catch (error) {
          item.error = errorText(error);
        }
        setItems((current) => [...current, item]);
      }
    } finally {
      operation.current = false;
      setBusy("");
      setProgress("");
    }
  }

  async function exportFiles() {
    if (operation.current || !canExport) return;
    operation.current = true;
    setBusy("exporting");
    setError("");
    setNotice("");
    setItems((current) =>
      current.map((item) => ({ ...item, exportError: "" }))
    );
    const results: ExportFile[] = [];
    const report: Record<string, unknown>[] = [];
    try {
      for (const [index, { item, plan, duplicate }] of previews.entries()) {
        let reason = item.excluded
          ? tr("excluded")
          : item.error ||
            plan?.error ||
            (duplicate
              ? tr("errors.duplicate")
              : !plan?.ready
                ? tr("pending")
                : "");
        if (!reason && plan?.ready && item.proposal) {
          setProgress(
            tr("export_progress", { current: index + 1, total: items.length })
          );
          await pause();
          try {
            results.push({
              name: plan.outputName,
              bytes: await generateProposal(item.proposal, plan),
            });
          } catch (error) {
            reason = errorText(error);
            updateItem(item.id, { exportError: reason });
          }
        }
        report.push({
          [tr("report.original")]: item.file.name,
          [tr("report.output")]: reason ? "" : plan?.outputName || "",
          [tr("report.status")]: reason || tr("report.success"),
          [tr("report.record")]: plan?.record
            ? `${plan.record.sourceFile} / TDoc_List / ${tr("row", { row: plan.record.row })}`
            : "",
          [tr("report.changes")]:
            plan?.changes?.map((c) => ({
              [tr("report.field")]: tr(`fields.${c.field}`),
              [tr("report.before")]: c.before,
              [tr("report.after")]: c.after,
            })) || [],
        });
      }
      if (!results.length) {
        setError(tr("errors.no_output"));
        return;
      }
      const bytes = packageResults(results, report);
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/zip" })
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "3GPP-TDoc.zip";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice(
        tr("export_done", {
          count: results.length,
          skipped: items.length - results.length,
        })
      );
    } catch (error) {
      setError(errorText(error));
    } finally {
      operation.current = false;
      setBusy("");
      setProgress("");
    }
  }

  function clearMeetings() {
    applyMeetingFiles([]);
    setError("");
  }

  function removeMeeting(id: string) {
    if (meeting)
      applyMeetingFiles(meeting.files.filter((entry) => entry.id !== id));
  }

  function clearDocuments() {
    setItems([]);
    setNotice("");
    setError("");
  }

  function removeDocument(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
    setNotice("");
  }

  function changeNaming(mode: NamingMode) {
    setNaming(mode);
    setNotice("");
  }

  return {
    meeting,
    previews,
    naming,
    busy,
    progress,
    error,
    notice,
    locked,
    canExport,
    setRemoteBusy,
    applyDownloadedList,
    selectMeeting,
    selectDocuments,
    clearMeetings,
    removeMeeting,
    clearDocuments,
    removeDocument,
    updateItem,
    changeNaming,
    exportFiles,
  };
}
