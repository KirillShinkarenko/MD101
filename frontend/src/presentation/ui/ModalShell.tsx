import type { ReactNode } from "react";
import { cn } from "./cn";
import { PanelHeader } from "./PanelHeader";
import { UiButton } from "./UiButton";

type Props = {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  panelClassName?: string;
  contentClassName?: string;
  closeLabel?: string;
  headerActions?: ReactNode;
};

export function ModalShell(props: Props) {
  const {
    isOpen,
    title,
    onClose,
    children,
    panelClassName,
    contentClassName,
    closeLabel = "Close",
    headerActions,
  } = props;

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <section
        className={cn("modal-panel", panelClassName)}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <PanelHeader
          as="h3"
          variant="modal"
          title={title}
          actions={
            <>
              {headerActions}
              <UiButton size="sm" onClick={onClose}>
                {closeLabel}
              </UiButton>
            </>
          }
        />
        <div className={cn("modal-content", contentClassName)}>{children}</div>
      </section>
    </div>
  );
}
