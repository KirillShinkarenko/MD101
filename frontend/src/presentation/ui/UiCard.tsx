import type { ReactNode } from "react";
import { cn } from "./cn";

type Props = {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  titleClassName?: string;
  as?: "section" | "div";
};

export function UiCard(props: Props) {
  const { title, children, className, titleClassName, as = "section" } = props;
  const Tag = as;

  return (
    <Tag className={cn("ui-card", className)}>
      {title ? <h4 className={cn("ui-card-title", titleClassName)}>{title}</h4> : null}
      {children}
    </Tag>
  );
}
