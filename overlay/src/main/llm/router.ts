import OpenAI from 'openai'
import crypto from 'node:crypto'
import { ipcMain, BrowserWindow } from 'electron'
import * as context from '../context'
import { PROMPTS } from './prompts'
import { resolveProviders } from './providers'
import { LLM } from '../config'

let activeRequest: { id: string; controller: AbortController } | null = null

/**
 * Cancels the in-flight copilot request.
 */
export function cancel(id?: string): void {
  if (activeRequest && (!id || activeRequest.id === id)) {
    console.log(`[LLM Router] Cancelling request: ${activeRequest.id}`)
    activeRequest.controller.abort()
    activeRequest = null
  }
}

/**
 * Assembles the system and user messages, bundling screenshots if configured.
 */
function buildMessages(mode: 'fast' | 'thinking', cfg: any, userQuery?: string) {
  const turns = context.getTurnsWindow(cfg.contextWindowTurns)
  const convo = turns.map((t) => `${t.source === 'system' ? 'Them' : 'You'}: ${t.text}`).join('\n')

  const content: any[] = []

  // Add conversation transcript
  const textPrompt = `${userQuery ? `Question: ${userQuery}\n\n` : ''}Conversation so far:\n${convo}`
  content.push({ type: 'text', text: textPrompt })

  // Add multimodal screenshots if included
  if (cfg.includeScreenshots) {
    const shots = context.includedShots()
    for (const s of shots) {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${s.jpeg}`
        }
      })
    }
  }

  return [
    { role: 'system', content: PROMPTS[mode] },
    { role: 'user', content }
  ]
}

/**
 * Formats context, triggers provider failover loop, streams responses,
 * and handles cancellation aborts.
 */
export async function run(
  mode: 'fast' | 'thinking',
  opts: { userQuery?: string } = {},
  win: BrowserWindow
): Promise<void> {
  const id = crypto.randomUUID()

  // Cancel any existing running request
  cancel()

  const controller = new AbortController()
  activeRequest = { id, controller }

  const cfg = LLM.modes[mode]
  const providers = resolveProviders(cfg)

  if (providers.length === 0) {
    console.error(`[LLM Router] No active providers found for mode: ${mode} (check your API keys)`)
    if (!win.isDestroyed()) {
      win.webContents.send('llm:error', {
        id,
        error: 'No active keys found. Please check keys.local.json.'
      })
    }
    activeRequest = null
    return
  }

  const messages = buildMessages(mode, cfg, opts.userQuery)

  for (const p of providers) {
    if (controller.signal.aborted) {
      break
    }

    try {
      console.log(
        `[LLM Router] Starting turn ${id} (${mode}) on provider: ${p.name} using model: ${p.model}`
      )
      if (!win.isDestroyed()) {
        win.webContents.send('llm:start', { id, mode, provider: p.name })
      }

      const client = new OpenAI({ apiKey: p.key, baseURL: p.baseURL })

      const stream = await client.chat.completions.create(
        {
          model: p.model,
          messages: messages as any,
          stream: true,
          max_tokens: cfg.maxTokens,
          temperature: cfg.temperature
        },
        {
          signal: controller.signal
        }
      )

      for await (const chunk of stream) {
        if (controller.signal.aborted) {
          break
        }
        const delta = chunk.choices?.[0]?.delta?.content
        if (delta && !win.isDestroyed()) {
          win.webContents.send('llm:token', { id, delta })
        }
      }

      if (!controller.signal.aborted) {
        console.log(`[LLM Router] Finished streaming response for turn ${id}`)
        if (!win.isDestroyed()) {
          win.webContents.send('llm:done', { id })
        }
        activeRequest = null
        return
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        console.log(`[LLM Router] Request ${id} was aborted`)
        if (!win.isDestroyed()) {
          win.webContents.send('llm:done', { id })
        }
        return
      }
      console.warn(
        `[LLM Router] Provider ${p.name} failed for request ${id}:`,
        err.message || String(err)
      )
      // Continue to next provider in loop
    }
  }

  // Check if we didn't succeed and weren't aborted
  if (!controller.signal.aborted) {
    console.error(`[LLM Router] All providers failed for request ${id}`)
    if (!win.isDestroyed()) {
      win.webContents.send('llm:error', {
        id,
        error: 'All configured LLM providers failed to respond.'
      })
    }
    activeRequest = null
  }
}

/**
 * Sets up IPC listeners for LLM requests.
 */
export function setupLlmHandlers(win: BrowserWindow): void {
  ipcMain.handle(
    'llm:run',
    async (_e, mode: 'fast' | 'thinking', opts?: { userQuery?: string }) => {
      await run(mode, opts || {}, win)
    }
  )

  ipcMain.handle('llm:cancel', (_e, id?: string) => {
    cancel(id)
  })
}
