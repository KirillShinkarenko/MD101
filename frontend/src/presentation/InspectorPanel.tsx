import { useState } from "react";
import { PanelHeader } from "./ui/PanelHeader";
import { UiButton } from "./ui/UiButton";

type Props = {
  requestRaw: string;
  responseRaw: string;
  errorText: string;
  onOpenFullScreenRequest: () => void;
  onOpenFullScreenResponse: () => void;
};

export function InspectorPanel(props: Props) {
  const {
    requestRaw,
    responseRaw,
    errorText,
    onOpenFullScreenRequest,
    onOpenFullScreenResponse,
  } = props;
  const [isRequestOpen, setIsRequestOpen] = useState(true);
  const [isResponseOpen, setIsResponseOpen] = useState(true);

  const inspectorRows =
    isRequestOpen && isResponseOpen
      ? "minmax(0, 2fr) minmax(0, 1fr) auto"
      : isRequestOpen
      ? "minmax(0, 1fr) auto auto"
      : isResponseOpen
      ? "auto minmax(0, 1fr) auto"
      : "auto auto auto";

  return (
    <aside className="sidebar right-col" style={{ gridTemplateRows: inspectorRows }}>
      <section className={`side-section raw-section ${isRequestOpen ? "is-open" : ""}`}>
        <PanelHeader
          as="h3"
          variant="section"
          title="Request"
          actions={
            <>
              <UiButton
                size="sm"
                className="section-action"
                aria-expanded={isRequestOpen}
                onClick={() => setIsRequestOpen((prev) => !prev)}
              >
                {isRequestOpen ? "Collapse" : "Expand"}
              </UiButton>
              <UiButton size="sm" className="section-action" onClick={onOpenFullScreenRequest}>
                Full screen
              </UiButton>
            </>
          }
        />
        {isRequestOpen ? <pre>{requestRaw || "Will appear after send"}</pre> : null}
      </section>

      <section className={`side-section raw-section ${isResponseOpen ? "is-open" : ""}`}>
        <PanelHeader
          as="h3"
          variant="section"
          title="Response"
          actions={
            <>
              <UiButton
                size="sm"
                className="section-action"
                aria-expanded={isResponseOpen}
                onClick={() => setIsResponseOpen((prev) => !prev)}
              >
                {isResponseOpen ? "Collapse" : "Expand"}
              </UiButton>
              <UiButton size="sm" className="section-action" onClick={onOpenFullScreenResponse}>
                Full screen
              </UiButton>
            </>
          }
        />
        {isResponseOpen ? <pre>{responseRaw || "Will appear after completion"}</pre> : null}
      </section>

      {errorText ? <p className="error">{errorText}</p> : null}
    </aside>
  );
}
