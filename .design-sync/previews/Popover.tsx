import { useRef, useState } from "react";
import {
  Button,
  Popover,
  PopoverBody,
  PopoverItem,
  PopoverLabel,
  PopoverSeparator,
} from "coven-cave";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 24,
        borderRadius: "var(--radius-card)",
        minHeight: "70vh",
      }}
    >
      {children}
    </div>
  );
}

export const Basic = () => {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(true);
  return (
    <Surface>
      <Button ref={anchorRef as never} variant="secondary" onClick={() => setOpen(true)}>
        Chat actions
      </Button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        placement="bottom-start"
        minWidth={220}
        ariaLabel="Chat actions"
      >
        <PopoverBody role="menu" ariaLabel="Chat actions">
          <PopoverLabel>Moonlit refactor</PopoverLabel>
          <PopoverItem icon="pencil-simple" onSelect={() => {}}>
            Rename chat
          </PopoverItem>
          <PopoverItem icon="push-pin" onSelect={() => {}}>
            Pin to rail
          </PopoverItem>
          <PopoverItem icon="arrow-square-out" onSelect={() => {}}>
            Open in editor
          </PopoverItem>
          <PopoverSeparator />
          <PopoverItem icon="trash" danger onSelect={() => {}}>
            Sacrifice session
          </PopoverItem>
        </PopoverBody>
      </Popover>
    </Surface>
  );
};

export const RadioGroup = () => {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(true);
  const [model, setModel] = useState("opus");
  return (
    <Surface>
      <Button ref={anchorRef as never} variant="secondary" trailingIcon="caret-down" onClick={() => setOpen(true)}>
        Model: Opus
      </Button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        placement="bottom-start"
        minWidth={240}
        ariaLabel="Choose model"
      >
        <PopoverBody role="menu" ariaLabel="Choose model">
          <PopoverLabel>Model for this familiar</PopoverLabel>
          <PopoverItem checked={model === "fable"} onSelect={() => setModel("fable")}>
            Fable 5 — deepest spellwork
          </PopoverItem>
          <PopoverItem checked={model === "opus"} onSelect={() => setModel("opus")}>
            Opus 4.8 — balanced
          </PopoverItem>
          <PopoverItem checked={model === "haiku"} onSelect={() => setModel("haiku")}>
            Haiku 4.5 — fastest
          </PopoverItem>
          <PopoverSeparator />
          <PopoverItem icon="gear-six" onSelect={() => {}}>
            Runtime settings…
          </PopoverItem>
        </PopoverBody>
      </Popover>
    </Surface>
  );
};
