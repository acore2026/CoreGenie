import { useRef, useEffect } from "react";

export default function SkillRow({
  name,
  enabled,
  onToggle,
  highlighted = false,
  disabled = false,
}: {
  name: string;
  enabled: boolean;
  onToggle: () => void;
  highlighted?: boolean;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  let classNames =
    "border-none bg-transparent w-full flex items-center justify-between px-2 py-1 rounded";
  if (highlighted) classNames += " bg-zinc-700/50 light:bg-slate-100";
  else classNames += " hover:bg-zinc-700/50 light:hover:bg-slate-100";

  if (disabled) classNames += " opacity-60 cursor-not-allowed";
  else classNames += " cursor-pointer";
  return (
    <button
      ref={ref}
      type="button"
      className={classNames}
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="text-xs text-white light:text-slate-900">{name}</span>
      <div className="pointer-events-none" aria-hidden="true">
        <span
          className={`relative block h-3 w-5 rounded-full ${enabled ? "bg-green-400" : "bg-zinc-500"}`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-2 w-2 rounded-full bg-white transition-transform ${enabled ? "translate-x-full" : ""}`}
          />
        </span>
      </div>
    </button>
  );
}
