import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useId,
  type ReactNode,
  type ReactElement,
  type LabelHTMLAttributes,
} from 'react';
import type { FieldError } from './api';

export const FormValidation = createContext<FieldError[]>([]);
const Group = createContext<string | undefined>(undefined);

// Keep the message outside the label: it describes the control without changing
// its accessible name. Existing hints remain associated with the input.
export function FormLabel({ children, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  const errors = useContext(FormValidation),
    group = useContext(Group),
    id = useId();
  const control = Children.toArray(children).find(
    (child) =>
      isValidElement(child) && ['input', 'select', 'textarea'].includes(String(child.type)),
  ) as
    | ReactElement<{
        name?: string;
        id?: string;
        'aria-describedby'?: string;
      }>
    | undefined;
  const error = errors.find((e) => e.field === control?.props.name);
  const errorId = `${id}-error`;
  // Group errors are associated by the fieldset itself; individual fields use their own description.
  const grouped = group !== undefined && group === control?.props.name;
  return (
    <>
      <label {...props}>
        {Children.map(children, (child) =>
          isValidElement(child) &&
          child.type === control?.type &&
          (child.props as { name?: string }).name === control?.props.name
            ? cloneElement(child as ReactElement<Record<string, unknown>>, {
                'aria-invalid': error ? true : undefined,
                'aria-describedby':
                  [control?.props['aria-describedby'], error && !grouped ? errorId : undefined]
                    .filter(Boolean)
                    .join(' ') || undefined,
              })
            : child,
        )}
      </label>
      {error && !grouped && (
        <p className="field-error" id={errorId}>
          {error.message}
        </p>
      )}
    </>
  );
}

export function ValidationGroup({
  name,
  legend,
  children,
}: {
  name: string;
  legend: string;
  children: ReactNode;
}) {
  const errors = useContext(FormValidation),
    id = useId();
  const error = errors.find((e) => e.field === name);
  return (
    <Group.Provider value={name}>
      <fieldset aria-invalid={error ? true : undefined} aria-describedby={error ? id : undefined}>
        <legend>{legend}</legend>
        {children}
      </fieldset>
      {error && (
        <p id={id} className="field-error">
          {error.message}
        </p>
      )}
    </Group.Provider>
  );
}

export function ErrorLinks({
  errors,
  form,
}: {
  errors: FieldError[];
  form: HTMLFormElement | null;
}) {
  return errors.length > 0 ? (
    <ul className="error-list">
      {errors.map((error) => (
        <li key={error.field}>
          <button
            type="button"
            className="error-link"
            onClick={() => {
              const control = Array.from(form?.elements ?? []).find(
                (element) => element.getAttribute('name') === error.field,
              ) as HTMLElement | undefined;
              control?.focus();
            }}
          >
            {error.message}
          </button>
        </li>
      ))}
    </ul>
  ) : null;
}
