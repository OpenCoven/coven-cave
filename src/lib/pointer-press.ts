/**
 * Defer layout work until the pointer press in progress has finished.
 *
 * A click is delivered to whatever sits under the pointer when it is RELEASED.
 * Pressing a control blurs the focused element during `pointerdown`, so a blur
 * handler that collapses UI shifts the control out from under the press and
 * the release lands on its container instead (#5840: the phone composer's rest
 * state, #5546). `afterPress` runs its callback on a fresh task once the press
 * is over, after the click has been dispatched; with no press in progress
 * (keyboard focus moves, or a touch whose pointerup already fired before the
 * compatibility mousedown blurred the input) it runs on the next task.
 */

type PressTarget = Pick<Window, "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout">;

export type PointerPressTracker = {
  /** Schedule `run` past the current press. Returns a cancel function. */
  afterPress: (run: () => void) => () => void;
  dispose: () => void;
};

const RELEASE_EVENTS = ["pointerup", "pointercancel"] as const;

export function createPointerPressTracker(target: PressTarget): PointerPressTracker {
  let pressed = false;
  const onDown = () => {
    pressed = true;
  };
  const onRelease = () => {
    pressed = false;
  };
  target.addEventListener("pointerdown", onDown, true);
  for (const type of RELEASE_EVENTS) target.addEventListener(type, onRelease, true);

  return {
    afterPress(run) {
      let timer: number | undefined;
      let done = false;
      const settle = () => {
        stopWaiting();
        if (!done) timer = target.setTimeout(() => {
          done = true;
          run();
        }, 0);
      };
      const stopWaiting = () => {
        for (const type of RELEASE_EVENTS) target.removeEventListener(type, settle, true);
      };
      if (pressed) {
        for (const type of RELEASE_EVENTS) target.addEventListener(type, settle, true);
      } else {
        settle();
      }
      return () => {
        done = true;
        stopWaiting();
        if (timer !== undefined) target.clearTimeout(timer);
      };
    },
    dispose() {
      target.removeEventListener("pointerdown", onDown, true);
      for (const type of RELEASE_EVENTS) target.removeEventListener(type, onRelease, true);
    },
  };
}
