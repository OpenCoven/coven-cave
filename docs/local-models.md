# Local models: Ollama and LM Studio

Codex local mode runs a familiar's chat with inference on this computer.
Codex runs the agent loop, its tools and its sandbox as it does for the cloud
runtime. Ollama or LM Studio runs the model. Cave offers two runtimes:

| Runtime | Harness id | Server |
|---|---|---|
| Codex · Ollama | `codex-ollama` | Ollama, default `http://127.0.0.1:11434` |
| Codex · LM Studio | `codex-lmstudio` | LM Studio's server, default `http://127.0.0.1:1234` |

Tracking issue: #6049.

## What you need

- The Codex CLI (`npm install -g @openai/codex`). Local mode doesn't need
  `codex login`.
- Ollama or LM Studio. Cave was checked against Ollama 0.21.0, LM Studio
  0.4.21 and Codex CLI 0.163.0.
- A chat model the server marks as **tool-capable**. Codex works through tool
  calls, so a model without tool support can't run it. Ollama reports this
  in `/api/show` (`tools`), LM Studio in `/api/v0/models` (`tool_use`).
  Qwen3 8B is a reasonable start on either server.

## Set up

1. Start the server. Ollama: open the app, or run `ollama serve`. LM Studio:
   start the server from the Developer tab, or run `lms server start`.
2. Add a model. Ollama: `ollama pull qwen3:8b`. LM Studio: download Qwen3 8B,
   or another model it marks for tool use.
3. Open **Settings → Local models**. Each server shows whether it is
   running, the address chats use, and its models, with the ones Codex can
   use marked **Tool support**.
4. Open the familiar's **Brain** settings and choose **Codex · Ollama** or
   **Codex · LM Studio** as its runtime.
5. In chat, choose a model from the composer's model menu. A local session
   never picks a model for you.

## Addresses

An address comes from, in order:

1. `CAVE_OLLAMA_URL` or `CAVE_LMSTUDIO_URL` in Cave's environment. Settings
   shows the field locked while one is set.
2. The address saved in Settings → Local models. It is stored in
   `local-models.json` in Cave's home on the computer that runs the familiar.
   Only a request from that computer can change it. A paired phone can see
   it but not change it.
3. The server's default address.

An address is a plain `http` or `https` base URL with no path, credentials or
query, for example `http://127.0.0.1:11500`.

A server on another computer is refused until you turn on **Allow servers on
other computers** in Settings, or set `CAVE_LOCAL_MODELS_ALLOW_REMOTE=1`.
That computer then receives your prompts and anything you share in chat.

### LM Studio's LM Link

LM Link lets LM Studio serve a model loaded on another of your computers
through the local server, so `http://127.0.0.1:1234` can answer with
inference that happens elsewhere. LM Studio's REST API doesn't say which
computer a model is on, so Cave asks LM Studio's `lms` command (`lms ls` and
`lms link status`) after the server answers.

- Settings → Local models marks those models **LM Link** with the
  computer's name.
- Chats don't offer them, and a turn that names one is refused, unless
  **Allow servers on other computers** is on. The same permission covers a
  server address on another computer.
- A model that exists on this computer and on a linked one counts as linked,
  because LM Studio sends it to whichever device is preferred.
- If `lms` isn't installed or doesn't answer, Settings says Cave couldn't
  check. Nothing is blocked then, so with LM Link on, a model may run on
  another computer.

## What stays on this computer

- There is no cloud fallback. Every launch pins Codex's local provider. A
  session that can't run locally stops with a message and never switches to
  a cloud model.
- Codex's web search tool is turned off.
- The model runs locally, but a familiar's tools still reach the network:
  shell commands, MCP servers and connected services work as they do with any
  other runtime.
- The Thinking (reasoning effort) control is a cloud Codex setting and isn't
  sent to local models.

## How a turn runs

Before anything starts, Cave checks three things: the server answers, the
chosen model is installed, and the server marks it tool-capable. Each refusal
says what to do next.

Cave then uses one of two transports:

- **Direct**, for a Codex version Cave has a verified event schema for. Cave
  runs `codex exec --json` itself, passes the local provider as `-c`
  overrides, and resumes the Codex thread on later turns.
- **Through Coven**, for any other Codex version. Cave runs
  `coven run codex-ollama` (or `codex-lmstudio`) with an adapter manifest it
  writes to Coven's adapter directory. A saved address reaches Codex as
  `CODEX_OSS_BASE_URL`. Later turns continue by replaying the conversation.

On both transports Cave clears any `CODEX_OSS_BASE_URL` or `CODEX_OSS_PORT`
inherited from its own environment, so only the configured server is used.

## Limitations

- Research missions don't offer the local runtimes. Research launches through
  the daemon without the checks above, and it relies on web search.
- A familiar bound to an SSH host can't use them, because the server address
  belongs to this computer.
- The new-familiar flow doesn't offer the local runtimes yet. Create the
  familiar, then switch its runtime in Brain settings.
- The runtime picker lists the local runtimes as ready whenever Codex is
  installed, even if the server is stopped. The check before each turn
  catches a stopped server.
- Cave writes each adapter manifest only when it is missing. If you edit
  `codex-ollama.json` or `codex-lmstudio.json` in Coven's adapter directory,
  Cave keeps your copy.

## Troubleshooting

| Message | What to do |
|---|---|
| Choose a model for Codex · Ollama… | Pick a model in the composer's model menu. |
| Ollama isn't reachable at … | Start the server, then send again. |
| Ollama doesn't have … | Pull or download the model, or choose another. |
| … doesn't support tool calling | Choose a model marked **Tool support** in Settings. |
| The server at … didn't answer like Ollama | The address points at something else, often the other server's port. Check it in Settings. |
| … isn't this computer | The address is on another computer. Allow remote servers in Settings, or use a local address. |
| … runs on *computer* through LM Link | LM Studio serves that model from another computer. Load a model on this computer, or allow servers on other computers in Settings. |
| The model menu is empty | Settings → Local models says why: server stopped, address invalid, no tool-capable model, or only LM Link models while servers on other computers are off. |

Codex sends long instructions with every turn. If replies seem to ignore the
conversation, the server may be truncating the prompt. Raise the model's
context length: on Ollama, set `OLLAMA_CONTEXT_LENGTH` before starting the
server; in LM Studio, set the context length when loading the model.
