import { createPortal } from "react-dom";
import { createContext, useContext } from "react";

// Nested modals must stay inside a native dialog's top layer.
export const ModalPortalContext = createContext<Element | null>(null);
export default function ModalWrapper({
  children,
  isOpen,
  noPortal = false,
}: React.PropsWithChildren<{ isOpen: boolean; noPortal?: boolean }>) {
  const portalTarget = useContext(ModalPortalContext);
  if (!isOpen) return null;

  if (noPortal) {
    return (
      <div className="fixed left-0 top-0 z-99 flex h-screen w-screen items-center justify-center bg-black/55 outline-none backdrop-blur-[2px]">
        {children}
      </div>
    );
  }

  const target = portalTarget ?? document.getElementById("root");
  if (!target) return null;
  return createPortal(
    <div className="fixed left-0 top-0 z-99 flex h-screen w-screen items-center justify-center bg-black/55 outline-none backdrop-blur-[2px]">
      {children}
    </div>,
    target
  );
}
