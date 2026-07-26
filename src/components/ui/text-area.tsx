"use client";

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { useFieldControlProps } from "@/components/ui/field";

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, ...rest },
  ref,
) {
  const controlProps = useFieldControlProps(rest);
  const classes = ["ui-text-area", className ?? ""].filter(Boolean).join(" ");

  return <textarea {...controlProps} ref={ref} className={classes} />;
});
