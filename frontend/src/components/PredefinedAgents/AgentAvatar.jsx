import { Robot } from "@phosphor-icons/react";

export default function AgentAvatar({ agent, size = 40, className = "" }) {
  const style = { width: size, height: size };
  if (agent?.iconUrl)
    return (
      <img
        src={agent.iconUrl}
        alt=""
        style={style}
        className={`rounded-xl object-cover ring-1 ring-white/10 light:ring-black/10 ${className}`}
      />
    );
  return (
    <span
      style={style}
      className={`inline-flex shrink-0 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-300/20 light:bg-cyan-50 light:text-cyan-700 light:ring-cyan-200 ${className}`}
    >
      <Robot size={Math.max(16, size * 0.52)} weight="duotone" />
    </span>
  );
}
