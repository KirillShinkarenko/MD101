import type { FullScreenView } from "../domain/chat";
import { ModalShell } from "./ui/ModalShell";

type Props = {
  view: FullScreenView;
  requestRaw: string;
  responseRaw: string;
  onClose: () => void;
};

export function FullScreenJsonModal(props: Props) {
  const { view, requestRaw, responseRaw, onClose } = props;

  if (!view) {
    return null;
  }

  return (
    <ModalShell
      isOpen={Boolean(view)}
      title={view === "request" ? "Request" : "Response"}
      onClose={onClose}
      panelClassName="modal-panel-full"
      contentClassName="modal-content-full"
    >
      <pre>{view === "request" ? requestRaw || "Will appear after send" : responseRaw || "Will appear after completion"}</pre>
    </ModalShell>
  );
}
