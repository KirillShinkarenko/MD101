import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type DropdownOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  id: string;
  value: string;
  options: ReadonlyArray<DropdownOption>;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function DropdownSelect(props: Props) {
  const { id, value, options, disabled = false, onChange } = props;
  const [isOpen, setIsOpen] = useState(false);
  const [openDirection, setOpenDirection] = useState<"down" | "up">("down");
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value]
  );

  const resolveDirection = useCallback(() => {
    const root = rootRef.current;
    if (!root || typeof window === "undefined") {
      setOpenDirection("down");
      return;
    }

    const rect = root.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const estimatedMenuHeight = 260;

    if (spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow) {
      setOpenDirection("up");
      return;
    }

    setOpenDirection("down");
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (!root || root.contains(event.target as Node)) {
        return;
      }
      setIsOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const toggleOpen = () => {
    if (disabled) {
      return;
    }
    if (!isOpen) {
      resolveDirection();
    }
    setIsOpen((prev) => !prev);
  };

  return (
    <div
      ref={rootRef}
      className={`custom-select ${isOpen ? "is-open" : ""} ${openDirection === "up" ? "open-up" : "open-down"}`}
    >
      <button
        id={id}
        type="button"
        className="custom-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={`${id}-listbox`}
        disabled={disabled}
        onClick={toggleOpen}
      >
        {selectedOption?.label ?? value}
      </button>

      {isOpen ? (
        <div id={`${id}-listbox`} className="custom-select-menu" role="listbox" aria-labelledby={id}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`custom-select-option ${option.value === value ? "is-selected" : ""}`}
              disabled={option.disabled}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
