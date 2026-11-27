import { Link, useLocation } from "react-router-dom";

export default function FeatureLink({
  to,
  label,
  icon: Icon,
  iconOnly = false,
  iconClassName = "",
}) {
  const { pathname } = useLocation();
  const active = pathname === to || pathname.startsWith(`${to}/`);
  return (
    <Link
      to={to}
      title={iconOnly ? label : undefined}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`flex h-10 shrink-0 items-center gap-2.5 rounded-md border px-2.5 text-sm font-medium text-theme-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${iconOnly ? "w-10 justify-center !px-0" : "w-full"} ${active ? "border-cyan-400/20 bg-theme-sidebar-item-selected" : "border-transparent hover:bg-theme-sidebar-item-hover"}`}
    >
      <Icon
        size={20}
        weight={active ? "fill" : "duotone"}
        className={`shrink-0 ${iconClassName}`}
        aria-hidden="true"
      />
      {!iconOnly && <span className="truncate">{label}</span>}
    </Link>
  );
}
