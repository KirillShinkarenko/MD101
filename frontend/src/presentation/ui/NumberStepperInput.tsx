type Props = {
  id: string;
  value: string;
  min?: number;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function NumberStepperInput(props: Props) {
  const { id, value, min = 1, disabled = false, onChange } = props;

  const handleStep = (delta: -1 | 1) => {
    if (disabled) {
      return;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      onChange(String(min));
      return;
    }

    const nextValue = Math.max(min, Math.trunc(parsed) + delta);
    onChange(String(nextValue));
  };

  return (
    <div className="counter-input">
      <input
        id={id}
        className="counter-input-field"
        type="number"
        min={min}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
      <div className="counter-input-controls">
        <button
          type="button"
          className="counter-input-btn counter-input-btn-up"
          onClick={() => handleStep(1)}
          disabled={disabled}
          aria-label="Increase value"
        />
        <button
          type="button"
          className="counter-input-btn counter-input-btn-down"
          onClick={() => handleStep(-1)}
          disabled={disabled}
          aria-label="Decrease value"
        />
      </div>
    </div>
  );
}
