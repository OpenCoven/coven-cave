# Screenshots

The images the top-level `README.md` shows. Each one is captured by a script
from synthetic data, so it can be refreshed after every release without
anyone's real chats, projects or paths ending up in the repository.

## What is captured

`manifest.json` is the list. `scripts/readme-screenshots.test.mjs` fails when
the README and the manifest disagree.

| File | Surface | Shows |
| --- | --- | --- |
| `home.png` | Home | The composer with a familiar selected and recent chats |
| `chat.png` | Chat | A finished turn with its tool activity and the chat list |
| `tasks.png` | Tasks | The board with cards in Backlog, Inbox, Running and Review |

`fixtures.json` holds the synthetic familiars, project, chats and task cards.
It answers the app's API reads during a capture. Keep it free of real names,
paths and message text.

## Refresh them

```bash
pnpm build
pnpm screenshots:readme                  # all of them
pnpm screenshots:readme --only chat.png  # one
```

The command starts its own production server on a free port with an empty
temporary home, captures at 1440×900 at 2× in dark mode, and stops the server.
A capture whose surface never renders fails and writes no file.

Look at every image before committing it. A loading state, an empty panel or a
toast over the content is a failed capture even when the command exits 0.

This is step 11 of the [release train](../docs/workflows/release-train.md).

## Add or replace an image

1. Add the entry to `manifest.json`: `file`, `alt`, the surface `mode`, and a
   `waitFor` selector that only matches once the surface has real content.
2. Add any data it needs to `fixtures.json`.
3. Run the capture and look at the result.
4. Reference it from `README.md` with the same alt text.
