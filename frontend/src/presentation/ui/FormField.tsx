import type { ReactNode } from "react";
import { cn } from "./cn";

type Props = {
  label: ReactNode;
  htmlFor: string;
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
  labelClassName?: string;
};

export function FormField(props: Props) {
  const { label, htmlFor, children, hint, className, labelClassName } = props;

  return (
    <div className={cn("form-field", className)}>
      <label className={cn("form-field-label", labelClassName)} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="form-field-hint hint">{hint}</p> : null}
    </div>
  );
}
