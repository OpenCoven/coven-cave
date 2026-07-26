"use client";

import {
  createContext,
  useContext,
  useId,
  type AriaAttributes,
  type ReactNode,
} from "react";

type FieldContextValue = {
  controlId: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

export type FieldProps = {
  id?: string;
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  required?: boolean;
  children: ReactNode;
  className?: string;
};

export type FieldControlProps = {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
};

function joinIds(...values: Array<string | undefined>): string | undefined {
  const ids = values
    .flatMap((value) => value?.split(/\s+/) ?? [])
    .filter(Boolean);
  const unique = [...new Set(ids)];
  return unique.length ? unique.join(" ") : undefined;
}

export function Field({
  id,
  label,
  description,
  error,
  optional = false,
  required = false,
  children,
  className,
}: FieldProps) {
  const generatedId = useId();
  const controlId = id ?? `ui-field-${generatedId.replace(/:/g, "")}`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = joinIds(descriptionId, errorId);
  const invalid = Boolean(error);
  const classes = ["ui-field", className ?? ""].filter(Boolean).join(" ");

  return (
    <FieldContext.Provider value={{ controlId, describedBy, invalid, required }}>
      <div className={classes} data-invalid={invalid || undefined}>
        <div className="ui-field__label-row">
          <label className="ui-field__label" htmlFor={controlId}>
            {label}
          </label>
          {optional && !required ? <span className="ui-field__optional">Optional</span> : null}
        </div>
        {children}
        {description ? (
          <div className="ui-field__description" id={descriptionId}>
            {description}
          </div>
        ) : null}
        {error ? (
          <div className="ui-field__error" id={errorId} role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

export function useFieldControlProps<T extends FieldControlProps>(
  props: T,
): T & FieldControlProps {
  const context = useContext(FieldContext);
  if (!context) return props;

  return {
    ...props,
    id: props.id ?? context.controlId,
    required: props.required ?? context.required,
    "aria-describedby": joinIds(context?.describedBy, props["aria-describedby"]),
    "aria-invalid": props["aria-invalid"] ?? (context.invalid || undefined),
  };
}
