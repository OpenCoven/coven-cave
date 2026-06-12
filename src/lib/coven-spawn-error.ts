export function isMissingExecutableError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export function covenCliMissingError() {
  return {
    ok: false,
    code: "ENOENT",
    error: "coven CLI not found on PATH. Open Setup to install it, then try again.",
  };
}
