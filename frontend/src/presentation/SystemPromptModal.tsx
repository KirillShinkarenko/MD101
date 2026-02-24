type Props = {
  isOpen: boolean;
  systemPrompt: string;
  onClose: () => void;
  onChange: (value: string) => void;
};

export function SystemPromptModal(props: Props) {
  const { isOpen, systemPrompt, onClose, onChange } = props;

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <section className="modal-panel" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>System prompt</h3>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-content">
          <textarea
            value={systemPrompt}
            onChange={(event) => onChange(event.target.value)}
            rows={8}
            placeholder="System prompt"
          />
        </div>
      </section>
    </div>
  );
}
