# Phase 4 — LLM Router (Fast & Thinking Modes)

**Build spec for Claude Code.** Wire the transcript store and included screenshots
(`d:\Cluely\overlay\`) into a **provider-agnostic LLM router** with two modes — **fast** (low-latency
suggestion) and **thinking** (thorough, multimodal) — and **stream** the response into the overlay.
The router runs in **main** so API keys never touch the renderer. **Trigger-based this phase** — a
hotkey generates from context; the typed-question box and settings UI come in Phase 5.

Target OS: **Windows 10/11 (x64)**. Builds on the existing structure, `window.*` contextBridge
pattern, the Phase 2 transcript relay, the Phase 3 `includedShots()` store, and `config.ts`.

---

## Definition of done (acceptance criteria)

1. A **fast** hotkey produces a concise, immediately-useful response that **streams token-by-token**
   into the overlay within ~1–2 s, grounded in the recent transcript.
2. A **thinking** hotkey produces a thorough response that also **uses included screenshots**
   (multimodal) and the full session transcript.
3. **API keys live only in main** — they never appear in the renderer (verify in DevTools/network;
   calls originate from the main process).
4. If the primary provider for a mode fails (bad key, 429, 5xx), the router **fails over** to the
   next provider and still answers.
5. Thinking-mode output is **token-capped** (no runaway reasoning-token bills).
6. STT/screenshots keep working; only the LLM call needs network.
7. Packages to a working portable `.exe` end-to-end.

---

## Key architectural decisions (do not deviate)

1. **Router in the main process.** Keys (via `safeStorage`) and outbound HTTPS stay server-side.
   The renderer only *triggers* a turn and *renders* streamed tokens. Main holds a transcript ring
   buffer (teed from the existing `stt.ts` relay) and reads `includedShots()` locally, so it has
   both context sources without depending on the renderer store.

2. **Unify on OpenAI-compatible endpoints.** One client, three providers, swap `{baseURL, key,
   model}` per mode:
   - **Groq** — `https://api.groq.com/openai/v1` (natively compatible).
   - **Gemini** — `https://generativelanguage.googleapis.com/v1beta/openai` (OpenAI-compat endpoint;
     vision via base64 `image_url`). If a feature gaps, fall back to the `@google/genai` SDK *for
     Gemini only*.
   - **OpenRouter** — `https://openrouter.ai/api/v1` (one key, many models, fallback).
   Prefer the **OpenAI SDK's streaming iterator** over hand-parsing SSE — it handles chunk-boundary
   reassembly that hand-rolled `fetch` parsing gets wrong.

3. **Mode = context shape + model.** Fast: recent transcript window only, text-mostly, low
   `max_tokens`, snappy model. Thinking: full session transcript + included screenshots, multimodal
   reasoning model, capped `max_tokens`.

4. **Trigger-based generation this phase.** Hotkeys fire fast/thinking against current context. The
   router accepts an optional `userQuery` (unused until Phase 5 adds the input box + `focusable`
   flip). No typed input, no settings UI yet.

5. **Per-mode provider failover.** An ordered provider list per mode; iterate until one streams.

---

## Dependencies

- `npm i openai` (the SDK, pointed at each provider's base URL). Plain `fetch` works too but you'll
  hand-parse SSE.
- Optional: `npm i @google/genai` only if Gemini's OpenAI-compat endpoint proves limiting.

---

## Keys to obtain (get these now)

| Provider | Where | Role |
|---|---|---|
| **Google AI Studio (Gemini)** | aistudio.google.com → API key | Default; free tier; multimodal (screenshots) |
| **Groq** | console.groq.com → API keys | Fast-mode latency; free tier |
| **OpenRouter** | openrouter.ai → keys | Failover + variety (DeepSeek/Claude/GPT) |

For Phase 4, load keys from a **gitignored** `keys.local.json` (or env vars), wrapped with
`safeStorage` for at-rest encryption. The in-app key-entry UI is Phase 5 (needs `focusable`).

---

## Project structure additions

```
src/
  main/
    llm/
      router.ts         # NEW: run(mode, {userQuery?}) → assemble messages → stream → failover
      providers.ts      # NEW: per-mode provider configs (baseURL/model/keyRef) from config
      prompts.ts        # NEW: system prompts for fast / thinking
    context.ts          # NEW: transcript ring buffer (teed from stt relay) + re-export includedShots()
    keys.ts             # NEW: load keys (gitignored file/env) + safeStorage encrypt-at-rest
    config.ts           # EXTEND: LLM block (modes → providers, context window, maxTokens, temps)
    shortcuts.ts        # EXTEND: fast + thinking hotkeys
    stt.ts              # EXTEND: tee each transcript into context.ts (one line)
    index.ts            # EXTEND: init router; pass win for streaming
  preload/
    index.ts            # EXTEND: expose window.llm (run, cancel, onStart, onToken, onDone, onError)
    llm.d.ts            # NEW: types
  renderer/
    response/
      panel.ts          # NEW: streaming response panel (mode/provider badge, token append, error)
    index.html          # EXTEND: response area + Fast/Thinking buttons + mode indicator
    style.css           # EXTEND: response panel styling
    renderer.ts         # EXTEND: wire window.llm events → response panel
```

---

## Implementation details

### `src/main/context.ts` — the router's view of context

```ts
import { includedShots } from './screenshot'
export { includedShots }

type Turn = { source: 'system'|'mic'; text: string; t: number }
const turns: Turn[] = []
const MAX = 2000

export function addTurn(source: 'system'|'mic', text: string) {     // call from stt.ts relay
  turns.push({ source, text, t: Date.now() })
  if (turns.length > MAX) turns.shift()
}
export function window(n: number): Turn[] { return n === Infinity ? turns : turns.slice(-n) }
```

In `stt.ts`, where transcripts (final ones) are forwarded to the renderer, add
`context.addTurn(t.source, t.text)`.

### `src/main/llm/router.ts` — assemble, stream, failover

```ts
import OpenAI from 'openai'
import crypto from 'node:crypto'
import * as context from '../context'
import { PROMPTS } from './prompts'
import { resolveProviders } from './providers'

function buildMessages(mode: 'fast'|'thinking', cfg, userQuery?: string) {
  const turns = context.window(cfg.contextWindowTurns)
  const convo = turns.map(t => `${t.source === 'system' ? 'Them' : 'You'}: ${t.text}`).join('\n')
  const content: any[] = [{ type: 'text',
    text: `${userQuery ? `Question: ${userQuery}\n\n` : ''}Conversation so far:\n${convo}` }]
  if (cfg.includeScreenshots)
    for (const s of context.includedShots())
      content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${s.jpeg}` } })
  return [{ role: 'system', content: PROMPTS[mode] }, { role: 'user', content }]
}

export async function run(mode: 'fast'|'thinking', opts: { userQuery?: string }, win) {
  const cfg = CONFIG.LLM.modes[mode]
  const messages = buildMessages(mode, cfg, opts.userQuery)
  const id = crypto.randomUUID()
  for (const p of resolveProviders(cfg)) {                 // failover loop
    try {
      const client = new OpenAI({ apiKey: p.key, baseURL: p.baseURL })
      win.webContents.send('llm:start', { id, mode, provider: p.name })
      const stream = await client.chat.completions.create({
        model: p.model, messages, stream: true,
        max_tokens: cfg.maxTokens, temperature: cfg.temperature,
      })
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content
        if (delta) win.webContents.send('llm:token', { id, delta })
      }
      win.webContents.send('llm:done', { id }); return
    } catch (e) { /* log; try next provider */ }
  }
  win.webContents.send('llm:error', { id, error: 'all providers failed' })
}
```

Support cancellation via an `AbortController` per `id` (abort when the user re-triggers or hides).

### `src/main/llm/prompts.ts`

```ts
export const PROMPTS = {
  fast: 'You are a real-time copilot in a live conversation. Using the recent exchange, give a brief, immediately useful response or suggested reply — a few sentences, no preamble.',
  thinking: 'You are an expert copilot. Analyze the full conversation and any screenshots carefully, then give a thorough, well-reasoned answer or recommendation. Use the on-screen context where relevant.',
}
```

### `src/main/config.ts` — LLM block

```ts
export const LLM = {
  modes: {
    fast: {
      providers: [
        { name: 'groq',   baseURL: 'https://api.groq.com/openai/v1',                          model: '<current-groq-llama-id>',      keyRef: 'GROQ' },
        { name: 'gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.1-flash-lite',        keyRef: 'GEMINI' }, // multimodal fallback
      ],
      contextWindowTurns: 12, includeScreenshots: false, maxTokens: 400, temperature: 0.4,
    },
    thinking: {
      providers: [
        { name: 'gemini',     baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.1-pro',          keyRef: 'GEMINI' },
        { name: 'openrouter', baseURL: 'https://openrouter.ai/api/v1',                            model: 'deepseek/deepseek-r1',    keyRef: 'OPENROUTER' },
      ],
      contextWindowTurns: Infinity, includeScreenshots: true, maxTokens: 1500, temperature: 0.6,
    },
  },
}
```

> **Confirm current model IDs** from each provider's docs — model slugs change. The families
> (Groq Llama, Gemini 3.1 Flash-Lite / Pro, DeepSeek R1) are right; the exact strings may have moved.

### `src/main/shortcuts.ts`

```ts
globalShortcut.register('Control+Return',       () => run('fast', {}, win))
globalShortcut.register('Control+Shift+Return', () => run('thinking', {}, win))
```

### `src/preload` + renderer

Expose `window.llm`: `run(mode, opts)`, `cancel(id?)`, `onStart(cb)`, `onToken(cb)`, `onDone(cb)`,
`onError(cb)`. The renderer `response/panel.ts`: on `llm:start` clear + show a mode/provider badge +
spinner; on `llm:token` append; on `llm:done` finalize; on `llm:error` show the error. Add **Fast**
and **Thinking** buttons too. Interactive controls need `-webkit-app-region: no-drag`.

---

## Windows / Electron / API gotchas (consolidated)

- **Keys never leave main.** The renderer triggers; main calls. Do not pass keys over IPC or embed
  them in renderer code. Verify nothing key-shaped appears in the renderer bundle or network tab.
- **Cap thinking `max_tokens`.** Reasoning models bill hidden thinking tokens at the output rate; an
  uncapped call can burn thousands of tokens before a short answer.
- **Gemini via OpenAI-compat:** base URL `.../v1beta/openai`, images as base64 `image_url` data
  URLs. If streaming or vision misbehaves there, use `@google/genai` for Gemini only.
- **Free-tier rate limits** (Groq, Gemini) surface as 429 — the failover loop must catch HTTP errors
  and advance to the next provider; order so a free primary degrades to OpenRouter.
- **Prefer the SDK streaming iterator** over hand-parsed `fetch` SSE — chunk-boundary reassembly is
  where hand-rolled parsers drop tokens.
- **Context growth:** in thinking mode a long session can approach the model's context limit and
  inflate latency/cost. The ring buffer caps turns; consider summarizing/trimming old turns if you
  hit limits.
- **Cancellation:** abort the in-flight stream (`AbortController`) when the user re-triggers or hides
  the overlay, or you'll get overlapping responses.
- **No CORS concerns** — calls originate from main (Node), not the browser.

---

## Verification protocol (run all before Phase 4 is done)

1. Set keys in `keys.local.json`. Have a short conversation captured, trigger **fast** → a concise
   suggestion streams in token-by-token within ~1–2 s.
2. Capture a screenshot (include it), trigger **thinking** → a thorough response streams and clearly
   references the on-screen content (proves multimodal + screenshots wired).
3. Put an invalid key on the primary provider → the **failover** provider answers.
4. Long session → thinking still responds (trim works) and output stops at the cap (no runaway).
5. Open the renderer DevTools network tab → **no LLM calls or keys** there; calls are from main.
6. Pull network → STT/screenshots still work; LLM reports a clean error via `llm:error`.
7. `npm run build:win` → end-to-end works in the portable `.exe`.

---

## Out of scope for Phase 4 (Phase 5)

No typed-question input box, no in-app settings/key-entry UI, no model picker, no auto-trigger on
speech end, no prompt presets, no conversation persistence. Just trigger-based fast/thinking
generation streaming into the overlay, with failover.

## Forward-compat notes (Phase 5 — the finish)

- **Flip `focusable: true`** + show via `showInactive()` with focus management, then add a **text
  input** wired to `run(mode, { userQuery })` — the router already takes it.
- **Settings UI**: enter/store keys (`safeStorage`), pick models per mode, edit prompts — needs the
  focusable input.
- Polish: prompt presets per context, idle STT-model unload, conversation save/clear, and final
  electron-builder packaging.
