import type { ReactNode } from "react";
import { cn } from "./cn";

type HeaderTag = "h1" | "h2" | "h3";
type HeaderVariant = "panel" | "section" | "modal";

type Props = {
  title: ReactNode;
  as?: HeaderTag;
  variant?: HeaderVariant;
  actions?: ReactNode;
  className?: string;
  titleClassName?: string;
  actionsClassName?: string;
};

const rootByVariant: Record<HeaderVariant, string> = {
  panel: "panel-header",
  section: "side-section-header",
  modal: "modal-header",
};

const actionsByVariant: Record<HeaderVariant, string> = {
  panel: "header-actions",
  section: "section-actions",
  modal: "header-actions",
};

export function PanelHeader(props: Props) {
  const {
    title,
    as = "h2",
    variant = "panel",
    actions,
    className,
    titleClassName,
    actionsClassName,
  } = props;
  const HeadingTag = as;

  return (
    <div className={cn("ui-header", `ui-header--${variant}`, rootByVariant[variant], className)}>
      <HeadingTag className={cn("ui-header-title", titleClassName)}>{title}</HeadingTag>
      {actions ? (
        <div className={cn("ui-header-actions", actionsByVariant[variant], actionsClassName)}>{actions}</div>
      ) : null}
    </div>
  );
}
