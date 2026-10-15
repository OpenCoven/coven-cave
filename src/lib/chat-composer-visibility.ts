/** Reading history must never unmount the input or resize its scroll viewport.
 * Flow executions remain read-only; new chats choose inline placement upstream. */
export function shouldShowDockedComposer({ readOnly }: { readOnly: boolean }): boolean {
  return !readOnly;
}
