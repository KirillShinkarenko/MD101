import type { FullScreenView } from "../domain/chat";

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
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <section
        className="modal-panel modal-panel-full"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{view === "request" ? "Request" : "Response"}</h3>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-content modal-content-full">
          <pre>{view === "request" ? requestRaw || "Will appear after send" : responseRaw || "Will appear after completion"}</pre>
        </div>
      </section>
    </div>
  );
}
