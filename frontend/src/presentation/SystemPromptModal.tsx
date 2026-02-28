import { ModalShell } from "./ui/ModalShell";

type Props = {
  isOpen: boolean;
  systemPrompt: string;
  onClose: () => void;
  onChange: (value: string) => void;
};

export function SystemPromptModal(props: Props) {
  const { isOpen, systemPrompt, onClose, onChange } = props;

  return (
    <ModalShell isOpen={isOpen} title="System prompt" onClose={onClose}>
      <textarea
        value={systemPrompt}
        onChange={(event) => onChange(event.target.value)}
        rows={8}
        placeholder="System prompt"
      />
    </ModalShell>
  );
}
