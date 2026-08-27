import { useMemo, useState } from "react";
import { CaretDown, CheckCircle } from "@phosphor-icons/react";
import AgentAnimation from "@/media/animations/agent-animation.webm";
import AgentStatic from "@/media/animations/agent-static.png";

export default function AgentStatus({
  summary,
  phase = "working",
  active = true,
  details = [],
}) {
  const [expanded, setExpanded] = useState(false);
  const normalizedDetails = useMemo(() => {
    const seen = new Set();
    return details.reduce((lines, entry) => {
      const line =
        typeof entry === "string" ? entry : entry?.content || entry?.summary;
      if (!line || seen.has(line)) return lines;
      seen.add(line);
      lines.push(line);
      return lines;
    }, []);
  }, [details]);
  const detailLines = normalizedDetails.filter((line) => line !== summary);
  const stepCount =
    normalizedDetails.length +
    (active && !normalizedDetails.includes(summary) ? 1 : 0);
  const hasDetails = detailLines.length > 0;
  const Header = hasDetails ? "button" : "div";
  const phaseLabel = phase.replaceAll("_", " ");

  return (
    <div className="w-full pr-4 mb-2" role="status" aria-live="polite">
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-zinc-800/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] light:border-slate-200 light:bg-slate-100/90">
        <span
          className={`absolute inset-y-0 left-0 w-[3px] ${active ? "bg-amber-400" : "bg-emerald-500"}`}
        />
        <Header
          {...(hasDetails
            ? {
                type: "button",
                onClick: () => setExpanded((value) => !value),
                "aria-label": expanded
                  ? "Hide Agent work details"
                  : "Show Agent work details",
                "aria-expanded": expanded,
              }
            : {})}
          className="grid min-h-[54px] w-full grid-cols-[24px_minmax(0,1fr)_auto] grid-rows-[auto_auto] items-center gap-x-3 px-3.5 py-2 text-left"
        >
          <div className="col-start-1 row-span-2 row-start-1 flex h-6 w-6 items-center justify-center self-center">
            {active ? (
              <video
                autoPlay
                loop
                muted
                playsInline
                className="h-[18px] w-[18px] scale-[150%] light:invert light:opacity-50"
                aria-hidden="true"
              >
                <source src={AgentAnimation} type="video/webm" />
              </video>
            ) : (
              <img
                src={AgentStatic}
                alt=""
                className="h-[18px] w-[18px] light:invert light:opacity-50"
              />
            )}
          </div>
          <span className="col-start-2 row-start-1 flex min-w-0 items-center gap-2 self-end pb-0.5">
            <span
              className={`shrink-0 text-[9px] font-bold uppercase tracking-[0.16em] ${active ? "text-amber-300/90 light:text-amber-700" : "text-emerald-300/90 light:text-emerald-700"}`}
            >
              {active ? "Agent working" : "Agent complete"}
            </span>
            <span className="h-1 w-1 shrink-0 rounded-full bg-zinc-600 light:bg-slate-400" />
            <span className="truncate font-mono text-[9px] uppercase tracking-[0.1em] text-zinc-500 light:text-slate-500">
              {active ? phaseLabel : "completed"}
            </span>
          </span>
          <span className="col-start-2 row-start-2 min-w-0 truncate self-start text-[13px] leading-4 text-zinc-100 light:text-slate-800">
            {summary}
          </span>
          {hasDetails && (
            <span className="col-start-3 row-span-2 row-start-1 ml-2 flex items-center gap-2 self-center text-zinc-500 light:text-slate-500">
              {stepCount > 0 && (
                <span className="whitespace-nowrap rounded-md border border-white/[0.06] bg-black/10 px-1.5 py-0.5 font-mono text-[9px] light:border-slate-200 light:bg-white">
                  {stepCount} {stepCount === 1 ? "step" : "steps"}
                </span>
              )}
              <CaretDown
                size={14}
                className={`transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
              />
            </span>
          )}
        </Header>
        {expanded && hasDetails && (
          <div className="ml-[50px] mr-3 border-t border-white/[0.06] py-2.5 light:border-slate-200">
            <ol className="max-h-40 space-y-2 overflow-y-auto pr-2 text-xs text-zinc-400 light:text-slate-600">
              {detailLines.map((line, index) => (
                <li
                  key={`${line}-${index}`}
                  className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-2"
                >
                  <CheckCircle
                    size={14}
                    weight="fill"
                    className="mt-px text-emerald-400/70 light:text-emerald-600/70"
                  />
                  <span className="min-w-0 break-words leading-[18px]">
                    {line}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
