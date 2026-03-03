import type { UserProfile } from "../domain/chat";
import { UiButton } from "./ui/UiButton";
import { ModalShell } from "./ui/ModalShell";

type ProfileDraft = {
  name: string;
  style: string;
  outputFormat: string;
  constraints: string;
  notes: string;
};

type Props = {
  isOpen: boolean;
  profiles: UserProfile[];
  activeProfileId: string | null;
  selectedProfileId: string | null;
  draft: ProfileDraft;
  isSaving: boolean;
  onClose: () => void;
  onCreate: () => void;
  onDelete: (profileId: string) => void;
  onSelect: (profileId: string) => void;
  onSetActive: (profileId: string | null) => void;
  onChangeDraft: (value: ProfileDraft) => void;
  onSave: () => void;
};

export function ProfileManagerModal(props: Props) {
  const {
    isOpen,
    profiles,
    activeProfileId,
    selectedProfileId,
    draft,
    isSaving,
    onClose,
    onCreate,
    onDelete,
    onSelect,
    onSetActive,
    onChangeDraft,
    onSave,
  } = props;

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;

  return (
    <ModalShell isOpen={isOpen} title="Profiles" onClose={onClose} panelClassName="modal-panel-profiles">
      <div className="profiles-modal-layout">
        <section className="profiles-list-panel">
          <div className="profiles-list-header">
            <p className="hint">User profiles</p>
            <UiButton size="sm" onClick={onCreate} disabled={isSaving}>
              Create
            </UiButton>
          </div>

          {profiles.length === 0 ? <p className="hint">Профилей пока нет.</p> : null}

          <div className="profiles-list">
            {profiles.map((profile) => {
              const isActive = profile.id === activeProfileId;
              const isSelected = profile.id === selectedProfileId;
              return (
                <article
                  key={profile.id}
                  className={`profile-item ${isSelected ? "is-selected" : ""}`}
                  onClick={() => onSelect(profile.id)}
                >
                  <button type="button" className="profile-item-title">
                    <span>{profile.name}</span>
                    {isActive ? <small>Active</small> : <small>Inactive</small>}
                  </button>
                  <div className="profile-item-actions">
                    <UiButton
                      size="sm"
                      variant={isActive ? "subtle" : "default"}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onSetActive(isActive ? null : profile.id);
                      }}
                      disabled={isSaving}
                    >
                      {isActive ? "Unset" : "Set active"}
                    </UiButton>
                    <UiButton
                      size="sm"
                      variant="subtle"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(profile.id);
                      }}
                      disabled={isSaving}
                    >
                      Delete
                    </UiButton>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="profiles-editor-panel">
          {!selectedProfile ? <p className="hint">Выберите профиль для редактирования.</p> : null}

          {selectedProfile ? (
            <>
              <div className="profile-field">
                <label className="profile-field-title" htmlFor="profile-name">
                  Название профиля
                </label>
                <input
                  id="profile-name"
                  type="text"
                  value={draft.name}
                  onChange={(event) => onChangeDraft({ ...draft, name: event.target.value })}
                />
              </div>

              <div className="profile-field">
                <label className="profile-field-title" htmlFor="profile-style">
                  Стиль общения
                </label>
                <p className="profile-field-description">
                  Как ассистент говорит: тон, длина, формальность, лексика.
                </p>
                <textarea
                  id="profile-style"
                  rows={3}
                  value={draft.style}
                  placeholder="Например: дружелюбно, кратко, без канцелярита."
                  onChange={(event) => onChangeDraft({ ...draft, style: event.target.value })}
                />
              </div>

              <div className="profile-field">
                <label className="profile-field-title" htmlFor="profile-output-format">
                  Формат ответа
                </label>
                <p className="profile-field-description">
                  Как структурировать ответ: TL;DR, шаги, таблица, JSON и т.д.
                </p>
                <textarea
                  id="profile-output-format"
                  rows={3}
                  value={draft.outputFormat}
                  placeholder="Например: сначала TL;DR, затем шаги списком."
                  onChange={(event) => onChangeDraft({ ...draft, outputFormat: event.target.value })}
                />
              </div>

              <div className="profile-field">
                <label className="profile-field-title" htmlFor="profile-constraints">
                  Ограничения
                </label>
                <p className="profile-field-description">
                  Что нельзя делать: запреты, безопасные рамки, обязательные оговорки.
                </p>
                <textarea
                  id="profile-constraints"
                  rows={3}
                  value={draft.constraints}
                  placeholder="Например: не выдумывать факты; если не уверен, явно писать об этом."
                  onChange={(event) => onChangeDraft({ ...draft, constraints: event.target.value })}
                />
              </div>

              <div className="profile-field">
                <label className="profile-field-title" htmlFor="profile-notes">
                  Заметки
                </label>
                <p className="profile-field-description">
                  Дополнительный контекст для профиля (необязательно).
                </p>
                <textarea
                  id="profile-notes"
                  rows={4}
                  value={draft.notes}
                  onChange={(event) => onChangeDraft({ ...draft, notes: event.target.value })}
                />
              </div>

              <div className="profiles-editor-actions">
                <UiButton size="sm" onClick={onSave} disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save profile"}
                </UiButton>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </ModalShell>
  );
}
