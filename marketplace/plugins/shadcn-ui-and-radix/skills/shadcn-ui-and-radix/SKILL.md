---
name: shadcn-ui-and-radix
description: Use when building or editing React UI with shadcn/ui, Radix Primitives, and Tailwind — the "open code" pattern where components are copied into your repo (components/ui/*) via the shadcn CLI and owned/edited by you, not installed as a runtime package. Covers the cva + tailwind-merge + clsx (cn) styling stack, the Radix headless a11y substrate (focus management, ARIA, keyboard nav, portals) exposed through asChild/Slot and data-slot/data-state, and concrete recipes for Button, Dialog, AlertDialog, DropdownMenu, Popover, Tooltip, Combobox (Popover+Command), Select, DataTable (TanStack Table), Sheet, Drawer (Vaul), and Form (react-hook-form + zod). Also decides when to prefer shadcn vs React Aria Components, HeroUI, Base UI, Chakra v3, Mantine, MUI, or Ant. Do NOT use for non-React frameworks (use shadcn-vue/svelte ports), deep design-token theming (tailwind-design-tokens), rich motion (framer-motion-patterns), or form UX depth (form-ux-patterns).
---

# shadcn/ui + Radix + Tailwind

## Use When
- Building/editing UI in a **React + Tailwind** app (esp. Next.js App Router).
- The repo already has `components/ui/*` and `lib/utils.ts` (a shadcn project), or you're initializing one.
- You need an **accessible** interactive component (dialog, menu, popover, combobox, select, tabs, tooltip, form) and want a11y handled for you.
- You want to **own and customize** component source rather than depend on a black-box library.
- An AI/coding familiar must read and edit real component source (the OpenCoven default stack).

## Guardrails
- **No runtime install.** There is no `shadcn` component package — use `npx shadcn@latest add <name>` (or copy source). Treat `components/ui/*` as owned source you may edit freely.
- **Import from unified `radix-ui`** in new code (`import { Dialog as DialogPrimitive } from "radix-ui"`, `import { Slot } from "radix-ui"`), not the legacy `@radix-ui/react-*` scoped packages.
- **`className` goes LAST inside `cn(...)`** so consumer overrides win via tailwind-merge. Never plain string-concatenate Tailwind classes (conflicts won't resolve).
- **Dialog/Sheet must render a `DialogTitle`** (wrap in Radix `VisuallyHidden` if not visually wanted) and ideally a `DialogDescription`, or Radix logs an a11y warning.
- **`asChild` takes exactly ONE element child** and you must forward the ref; use it instead of nesting interactive elements (`<Button asChild><Link/></Button>`, never `<button><a/></button>`).
- **Tooltip content must be non-interactive**; use Popover/HoverCard for focusable content. Mount one `TooltipProvider` near the app root.
- **AlertDialog for destructive confirms** (no overlay-dismiss; explicit action/cancel) — not plain Dialog.
- **Combobox/Command are compositions** (Popover + cmdk `Command`), and **DataTable = shadcn table primitives + TanStack Table v8** — don't hunt for a monolithic component.
- **Radix ships behavior only.** Every visual class is yours; unstyled Radix looks unstyled by design.
- Prefer **plain function components** with `React.ComponentProps<...>` typing (current shadcn style) over `forwardRef` boilerplate unless a ref passthrough is required.

## Default Flow
1. **Detect/scaffold.** Check for `components.json` + `lib/utils.ts`. If absent and starting fresh, run `npx shadcn@latest init` (sets style, RSC, Tailwind paths, aliases, base color). Confirm `cn()` exists.
2. **Add only what you need.** `npx shadcn@latest add button dialog dropdown-menu ...`. This copies source and installs deps (`radix-ui`, `class-variance-authority`, `tailwind-merge`, `clsx`, `lucide-react`, and per-component libs like `@tanstack/react-table`, `vaul`, `cmdk`, `react-hook-form`, `zod`).
3. **Style via `cva` + `cn`.** For variantable components, define `const xVariants = cva(base, { variants, compoundVariants, defaultVariants })`, derive props with `VariantProps<typeof xVariants>`, and render `cn(xVariants({ variant, size, className }))`. Tag each part with `data-slot="..."`.
4. **Compose, don't fork behavior.** Reach for `asChild`/`Slot` for polymorphism; build compound components (Dialog, DropdownMenu) from Radix parts; build Combobox from Popover + Command; wire DataTable to TanStack Table.
5. **Animate off state.** Use `tailwindcss-animate` utilities keyed on `data-[state=open]`/`data-[state=closed]` (`animate-in fade-in-0 zoom-in-95`, `slide-in-from-*`). Defer complex motion to framer-motion-patterns.
6. **Verify a11y quickly.** Keyboard-only pass (Tab/Shift-Tab/arrows/Esc/Enter), focus trap + return on dialogs, `DialogTitle` present, `aria-invalid` wired on invalid inputs, visible `focus-visible` ring. Radix covers ARIA roles/attributes automatically.
7. **Pick the right tool.** shadcn (own-code React+Tailwind) is the default. Escalate to **React Aria Components** for the hardest headless a11y (date pickers, i18n, drag-drop), **HeroUI/Chakra v3/Mantine/MUI/Ant** when a shipped styled package beats owning source, **Base UI** if the project standardized on it, or a **shadcn-vue/svelte** port for non-React — the cva/Tailwind pattern transfers, the `radix-ui` package does not.

## Reference Snippets
```ts
// lib/utils.ts — the merge helper every component uses
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
```
```tsx
// Button — cva + Slot polymorphism + data-slot (current shadcn idiom)
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"
const buttonVariants = cva("inline-flex items-center justify-center rounded-md text-sm font-medium transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 disabled:pointer-events-none", {
  variants: {
    variant: { default: "bg-primary text-primary-foreground hover:bg-primary/90", destructive: "bg-destructive text-white hover:bg-destructive/90", outline: "border bg-background hover:bg-accent", secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80", ghost: "hover:bg-accent hover:text-accent-foreground", link: "text-primary underline-offset-4 hover:underline" },
    size: { default: "h-9 px-4 py-2", sm: "h-8 px-3", lg: "h-10 px-6", icon: "size-9" },
  },
  defaultVariants: { variant: "default", size: "default" },
})
function Button({ className, variant, size, asChild = false, ...props }:
  React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button"
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}
```
```tsx
// Dialog — compound parts wrapping radix-ui, animated via data-[state]
import { Dialog as DialogPrimitive } from "radix-ui"
function Dialog(p) { return <DialogPrimitive.Root data-slot="dialog" {...p} /> }
function DialogContent({ className, children, ...p }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={cn("fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0")} />
      <DialogPrimitive.Content data-slot="dialog-content"
        className={cn("fixed top-1/2 left-1/2 z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:zoom-out-95", className)} {...p}>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
```

See NOTES.md for trade-offs and the full synthesis at
`research/synthesis/2026-07-01-shadcn-ui-and-radix.md`.
