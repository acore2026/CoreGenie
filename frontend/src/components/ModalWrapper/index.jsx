import { createPortal } from "react-dom";
import { createContext, useContext } from "react";

// Nested modals must stay inside a native dialog's top layer.
export const ModalPortalContext = createContext(null);
/**
 * @typedef {Object} ModalWrapperProps
 * @property {import("react").ReactComponentElement} children - The DOM/JSX to render
 * @property {boolean} isOpen - Option that renders the modal
 * @property {boolean} noPortal - (default: false) Used for creating sub-DOM modals that need to be rendered as a child element instead of a modal placed at the root
 * Note: This can impact the bg-overlay presentation due to conflicting DOM positions so if using this property you should
   double check it renders as desired.
 */

/**
 *
 * @param {ModalWrapperProps} props - ModalWrapperProps to pass
 * @returns {import("react").ReactNode}
 *
 * @todo Add a closeModal prop to the ModalWrapper component so we can escape dismiss anywhere this is used
 */
export default function ModalWrapper({ children, isOpen, noPortal = false }) {
  const portalTarget = useContext(ModalPortalContext);
  if (!isOpen) return null;

  if (noPortal) {
    return (
      <div className="fixed left-0 top-0 z-99 flex h-screen w-screen items-center justify-center bg-black/55 outline-none backdrop-blur-[2px]">
        {children}
      </div>
    );
  }

  return createPortal(
    <div className="fixed left-0 top-0 z-99 flex h-screen w-screen items-center justify-center bg-black/55 outline-none backdrop-blur-[2px]">
      {children}
    </div>,
    portalTarget || document.getElementById("root")
  );
}
