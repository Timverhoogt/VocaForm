import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent
} from "react";
import type { FormField } from "../domain/schemas";

interface ChoiceQuestionModalProps {
  busy: boolean;
  field: FormField;
  locale: string;
  onClose: () => void;
  onSkip: () => Promise<void>;
  onSubmit: (value: string | string[]) => Promise<void>;
}

export function ChoiceQuestionModal(props: ChoiceQuestionModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstOptionRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const optionGroupId = useId();
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const multiple = props.field.type === "multi_choice";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      firstOptionRef.current?.focus();
    }
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  function updateSelection(option: string, checked: boolean) {
    if (!multiple) {
      setSelectedOptions(checked ? [option] : []);
      return;
    }
    setSelectedOptions((current) => checked
      ? [...current, option]
      : current.filter((candidate) => candidate !== option));
  }

  async function submitChoice(event: FormEvent) {
    event.preventDefault();
    if (selectedOptions.length === 0) return;
    await props.onSubmit(multiple ? selectedOptions : selectedOptions[0] as string);
  }

  return (
    <dialog
      ref={dialogRef}
      className="choice-modal"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
    >
      <form className="choice-modal-card" onSubmit={(event) => void submitChoice(event)}>
        <header>
          <div>
            <p className="stage-kicker">{multiple ? "Choose all that apply" : "Choose one answer"}</p>
            <h2 id={titleId} dir="auto" lang={props.locale}>{props.field.interviewPrompt}</h2>
          </div>
          <button
            type="button"
            className="drawer-close"
            aria-label="Close answer choices"
            onClick={props.onClose}
          >
            ×
          </button>
        </header>
        <p id={descriptionId} className="choice-modal-lead">
          {multiple
            ? "Select every option that applies, then save your answer."
            : "Select an option, then save your answer."}
        </p>
        <fieldset className="choice-options" aria-describedby={descriptionId}>
          <legend className="sr-only">Available answers</legend>
          {props.field.options.map((option, index) => {
            const optionId = `${optionGroupId}-${index}`;
            const selected = selectedOptions.includes(option);
            return (
              <label key={option} className={selected ? "choice-option selected" : "choice-option"} htmlFor={optionId}>
                <input
                  ref={index === 0 ? firstOptionRef : undefined}
                  id={optionId}
                  name={optionGroupId}
                  type={multiple ? "checkbox" : "radio"}
                  value={option}
                  checked={selected}
                  disabled={props.busy}
                  onChange={(event) => updateSelection(option, event.target.checked)}
                />
                <span dir="auto" lang={props.locale}>{option}</span>
              </label>
            );
          })}
        </fieldset>
        <div className="choice-modal-actions">
          <button type="button" className="quiet-button" disabled={props.busy} onClick={() => void props.onSkip()}>
            I’ll answer this later
          </button>
          <button type="submit" className="primary-button compact" disabled={props.busy || selectedOptions.length === 0}>
            Save and continue <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>
    </dialog>
  );
}
