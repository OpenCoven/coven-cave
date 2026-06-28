"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import type { RequiredInput } from "@/lib/required-inputs";

type RequiredInputsDialogProps = {
  inputs: RequiredInput[];
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
};

export function RequiredInputsDialog({ inputs, onSubmit, onCancel }: RequiredInputsDialogProps) {
  const initialValues = useMemo(
    () => Object.fromEntries(inputs.map((input) => [input.key, ""])),
    [inputs],
  );
  const [values, setValues] = useState<Record<string, string>>(initialValues);

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  return (
    <Modal
      open
      onClose={onCancel}
      breadcrumb={["Flow", "Required inputs"]}
      ariaLabel="Required flow inputs"
      footerActions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="required-inputs-form">
            Continue
          </Button>
        </>
      }
    >
      <form
        id="required-inputs-form"
        className="required-inputs-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(values);
        }}
      >
        <div className="required-inputs-dialog">
          <p className="required-inputs-copy">
            Add the missing values before running this flow.
          </p>
          {inputs.map((input) => (
            <label key={input.key} className="required-inputs-field">
              <span className="required-inputs-label">{input.label}</span>
              {input.control === "textarea" || input.control === "code" || input.control === "json" ? (
                <textarea
                  required
                  value={values[input.key] ?? ""}
                  placeholder={input.placeholder}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [input.key]: event.target.value }))
                  }
                />
              ) : (
                <input
                  required
                  type={input.control === "number" ? "number" : "text"}
                  value={values[input.key] ?? ""}
                  placeholder={input.placeholder}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [input.key]: event.target.value }))
                  }
                />
              )}
              {input.help ? <span className="required-inputs-help">{input.help}</span> : null}
            </label>
          ))}
        </div>
      </form>
    </Modal>
  );
}
