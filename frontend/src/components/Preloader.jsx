export default function PreLoader({ size = "16" }) {
  return (
    <div
      className={`h-${size} w-${size} animate-spin rounded-full border-4 border-solid border-primary border-t-transparent`}
    ></div>
  );
}

/**
 * A non-blocking loader for data that belongs to an already-mounted page.
 * Unlike FullScreenLoader, this keeps the surrounding navigation visible.
 */
export function ContentLoader({ label = "Loading" }) {
  return (
    <div
      className="flex min-h-[240px] h-full w-full items-center justify-center bg-transparent"
      role="status"
      aria-label={label}
    >
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-solid border-[var(--theme-loader)] border-t-transparent" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function FullScreenLoader() {
  return (
    <div
      id="preloader"
      className="fixed left-0 top-0 z-999999 flex h-screen w-screen items-center justify-center bg-theme-bg-primary"
    >
      <div className="h-16 w-16 animate-spin rounded-full border-4 border-solid border-[var(--theme-loader)] border-t-transparent"></div>
    </div>
  );
}
