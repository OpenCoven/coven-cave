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
            {inputs.length === 1
              ? "One value is required before this flow can run."
              : `${inputs.length} values are required before this flow can run.`}
          </p>
          <div className="required-inputs-list">
            {inputs.map((input) => (
              <label key={input.key} className="required-inputs-field">
                <span className="required-inputs-field-head">
                  <span className="required-inputs-label">{input.paramLabel}</span>
                  <span className="required-inputs-node" title={`Step: ${input.nodeName}`}>
                    {input.nodeName}
                  </span>
                </span>
                {input.control === "textarea" || input.control === "code" || input.control === "json" ? (
                  <textarea
                    required
                    className="required-inputs-control"
                    rows={3}
                    value={values[input.key] ?? ""}
                    placeholder={input.placeholder}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [input.key]: event.target.value }))
                    }
                  />
                ) : (
                  <input
                    required
                    className="required-inputs-control"
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
        </div>
      </form>
    </Modal>
  );
}
