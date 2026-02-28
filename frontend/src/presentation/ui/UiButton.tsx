import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

type UiButtonSize = "sm" | "md";
type UiButtonVariant = "default" | "subtle";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: UiButtonSize;
  variant?: UiButtonVariant;
  fullWidth?: boolean;
};

export function UiButton(props: Props) {
  const {
    size = "md",
    variant = "default",
    fullWidth = false,
    className,
    type = "button",
    ...rest
  } = props;

  return (
    <button
      type={type}
      className={cn(
        "ui-button",
        size === "sm" ? "ui-button--sm" : "ui-button--md",
        variant === "subtle" ? "ui-button--subtle" : "ui-button--default",
        fullWidth ? "ui-button--full" : null,
        className,
      )}
      {...rest}
    />
  );
}
