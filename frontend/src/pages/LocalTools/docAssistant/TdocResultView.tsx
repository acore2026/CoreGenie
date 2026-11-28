import { useEffect, useRef, useState } from "react";
import { API_BASE } from "@/utils/constants";
import {
  controlClass,
  primaryButtonClass,
  formatBytes,
  isWorkingStatus,
  startDocConvert,
  pollDocConvert,
  fetchDocumentBlob,
  triggerBlobDownload,
  tr,
  type DocZipMember,
  type TdocLookupResult,
  type RfcLookupResult,
  type DraftLookupResult,
  type AgendaFileItem,
} from "./api";

export function FileActions({
  url,
  name,
  member,
  convertible,
  pdfPath,
  status = "idle",
  mirrored = false,
}: {
  url: string;
  name: string;
  member?: string;
  convertible?: boolean;
  pdfPath?: string;
  status?: string;
  mirrored?: boolean;
}) {
  const [request, setRequest] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [ready, setReady] = useState(pdfPath);
  const [job, setJob] = useState(status);
  const active = useRef<AbortController | null>(null);
  const payload = member ? { zipUrl: url, member } : { directUrl: url };

  useEffect(() => () => active.current?.abort(), []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview]
  );
  useEffect(() => {
    if (!isWorkingStatus(job)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const data = await pollDocConvert(
          member ? { zipUrl: url, member } : { directUrl: url },
          controller.signal
        );
        if (controller.signal.aborted) return;
        setReady(data.pdfPath);
        setError(data.error || "");
        setJob(data.status);
        if (isWorkingStatus(data.status)) timer = setTimeout(poll, 1500);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : tr("failed"));
          setJob("failed");
        }
      }
    }
    timer = setTimeout(poll, 1200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [url, member, job]);

  async function run(action: "download" | "pdf" | "convert") {
    const controller = new AbortController();
    active.current = controller;
    setRequest(action);
    setError("");
    try {
      if (action === "convert") {
        const data = await startDocConvert(payload, controller.signal);
        setReady(data.pdfPath);
        setJob(data.status);
        setError(data.error || "");
      } else {
        const blob = await fetchDocumentBlob(url, member, controller.signal);
        if (action === "pdf")
          setPreview(
            URL.createObjectURL(new Blob([blob], { type: "application/pdf" }))
          );
        else triggerBlobDownload(blob, name.split("/").pop() || name);
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : tr("failed"));
    } finally {
      if (!controller.signal.aborted) setRequest("");
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {member || mirrored ? (
        <button
          type="button"
          className={controlClass}
          disabled={!!request}
          onClick={() => run("download")}
        >
          {tr(request === "download" ? "extracting" : "download")}
        </button>
      ) : (
        <a className={controlClass} target="_blank" rel="noreferrer" href={url}>
          {tr(/\.zip$/i.test(name) ? "original" : "openFile")} ↗
        </a>
      )}
      {ready ? (
        <a
          className={primaryButtonClass}
          target="_blank"
          rel="noreferrer"
          href={API_BASE + ready}
        >
          {tr("preview")} ↗
        </a>
      ) : convertible ? (
        <button
          type="button"
          className={controlClass}
          disabled={!!request || isWorkingStatus(job)}
          onClick={() => run("convert")}
        >
          {tr(
            isWorkingStatus(job) || request === "convert"
              ? "working"
              : job === "failed"
                ? "retry"
                : "makePdf"
          )}
        </button>
      ) : (
        /\.pdf$/i.test(name) &&
        (member || mirrored) && (
          <button
            type="button"
            className={controlClass}
            disabled={!!request}
            onClick={() => run("pdf")}
          >
            {tr(request === "pdf" ? "pending" : "preview")}
          </button>
        )
      )}
      {error && (
        <p role="alert" className="w-full text-sm text-red-400">
          {error}
        </p>
      )}
      {preview && (
        <div className="w-full space-y-2">
          <button className={controlClass} onClick={() => setPreview("")}>
            {tr("previewClose")}
          </button>
          <iframe className="h-[65vh] w-full" title={name} src={preview} />
        </div>
      )}
    </div>
  );
}

export function AgendaFile({ file }: { file: AgendaFileItem }) {
  return (
    <li className="space-y-2 py-2">
      <p className="break-all">{file.name}</p>
      <FileActions
        name={file.name}
        url={file.url}
        mirrored={file.mirrored}
        convertible={file.convertible}
        status={file.status}
        pdfPath={file.pdfPath}
      />
    </li>
  );
}

function Member({ member, url }: { member: DocZipMember; url: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <span className="break-all">
        {member.name} <small>{formatBytes(member.size)}</small>
      </span>
      <FileActions
        name={member.name}
        url={url}
        member={member.name}
        convertible={member.convertible}
        status={member.status}
        pdfPath={member.pdfPath}
      />
      {member.reason && (
        <p className="w-full text-xs text-theme-text-secondary">
          {member.reason}
        </p>
      )}
    </li>
  );
}

export function TdocResultView({ result }: { result: TdocLookupResult }) {
  return (
    <section className="space-y-3 rounded-lg border border-theme-sidebar-border p-4">
      <h2 className="text-lg font-semibold">{result.id}</h2>
      <p className="break-all text-sm text-theme-text-secondary">
        {[result.sourceLabel, result.meetingFolder, result.subfolder]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {result.warning && (
        <p role="status" className="text-sm text-theme-text-secondary">
          {result.warning}
        </p>
      )}
      {result.members.length > 0 && (
        <div>
          <h3 className="text-sm font-medium">
            {tr("members", { count: result.members.length })}
          </h3>
          <ul className="divide-y divide-theme-sidebar-border">
            {result.members.map((m) => (
              <Member key={m.name} member={m} url={result.zipUrl} />
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <FileActions
          name={result.zipName}
          url={result.zipUrl}
          mirrored={result.sourceId !== "public"}
          convertible={/\.(?:docx?|rtf)$/i.test(result.zipName)}
        />
        {result.dirUrl && (
          <a
            className={controlClass}
            href={result.dirUrl}
            target="_blank"
            rel="noreferrer"
          >
            {tr("directory")} ↗
          </a>
        )}
      </div>
    </section>
  );
}

export function ExternalDocResultView({
  result,
}: {
  result: RfcLookupResult | DraftLookupResult;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-theme-sidebar-border p-4">
      <h2 className="break-all text-lg font-semibold">{result.id}</h2>
      <div className="flex flex-wrap gap-2">
        {(result.kind === "rfc"
          ? [
              [result.htmlUrl, "openHtml"],
              [result.txtUrl, "openText"],
              [result.pdfUrl, "preview"],
            ]
          : [
              [result.txtUrl, "openDraft"],
              [result.datatrackerUrl, "versions"],
            ]
        ).map(([url, key]) => (
          <a
            className={controlClass}
            href={url}
            target="_blank"
            rel="noreferrer"
            key={url}
          >
            {tr(key)} ↗
          </a>
        ))}
        {result.kind === "rfc" && result.localUrl && (
          <FileActions
            mirrored
            url={result.localUrl}
            name={result.id + ".txt"}
          />
        )}
      </div>
    </section>
  );
}
