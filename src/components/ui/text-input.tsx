"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { useFieldControlProps } from "@/components/ui/field";

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className, type = "text", ...rest },
  ref,
) {
  const controlProps = useFieldControlProps(rest);
  const classes = ["ui-text-input", className ?? ""].filter(Boolean).join(" ");

  return <input {...controlProps} ref={ref} type={type} className={classes} />;
});
