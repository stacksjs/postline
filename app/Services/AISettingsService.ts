/**
 * Which AI provider campaign planning uses, and its key (#138).
 *
 * The environment (`AI_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
 * `OLLAMA_HOST`) was the only way to set it, and the Mac app has no
 * environment. A provider and key saved in Settings now win over it; with
 * nothing saved, `config/ai.ts` reads the environment exactly as before.
 *
 * The key is sealed with the instance key, like network tokens, and never
 * leaves the server: the browser only learns whether one is saved.
 */
import type { AIProvider, ConfiguredAIOptions } from '@stacksjs/ai'
import { db } from '@stacksjs/database'
import aiConfig from '../../config/ai'
import { UserFacingError } from '../Support/Http/user-error'
import { openToken, sealToken } from '../Support/Social/token-vault'
import { ensureAccount, now } from './Social/support'

const database = db as any

export const AI_PROVIDERS = ['anthropic', 'openai', 'ollama'] as const
export type SettingsAIProvider = typeof AI_PROVIDERS[number]

export interface AISettingsView {
  /** The provider saved in Settings, or '' when the environment decides. */
  provider: SettingsAIProvider | ''
  model: string
  /** Whether a key is saved. The key itself is never sent back. */
  hasKey: boolean
}

function isProvider(value: unknown): value is SettingsAIProvider {
  return AI_PROVIDERS.includes(String(value) as SettingsAIProvider)
}

export class AISettingsService {
  async view(): Promise<AISettingsView> {
    const row = await this.row()
    return {
      provider: isProvider(row?.ai_provider) ? row.ai_provider : '',
      model: String(row?.ai_model || ''),
      hasKey: Boolean(row?.ai_api_key),
    }
  }

  /**
   * Save the provider, model and key. A blank key keeps the saved one, so the
   * form can be saved again without retyping it; `clearKey` removes it.
   */
  async save(input: { provider?: string, model?: string, apiKey?: string, clearKey?: boolean }): Promise<AISettingsView> {
    const values: Record<string, unknown> = {}

    if (input.provider !== undefined) {
      const provider = input.provider.trim()
      if (provider && !isProvider(provider)) throw new UserFacingError('Choose Anthropic, OpenAI or Ollama.')
      values.ai_provider = provider
    }
    if (input.model !== undefined) {
      const model = input.model.trim()
      if (model.length > 120) throw new UserFacingError('The model name is too long.')
      values.ai_model = model
    }
    if (input.clearKey) {
      values.ai_api_key = null
    }
    else if (input.apiKey !== undefined && input.apiKey.trim()) {
      const key = input.apiKey.trim()
      if (key.length > 4096) throw new UserFacingError('That key is too long to be an API key.')
      values.ai_api_key = await sealToken(key)
    }

    if (Object.keys(values).length) {
      const id = await ensureAccount()
      await database.updateTable('accounts').set({ ...values, updated_at: now() }).where('id', '=', id).execute()
    }
    return await this.view()
  }

  /**
   * The AI configuration to plan with: `config/ai.ts`, with the provider, key
   * and model from Settings laid over it when one is saved.
   */
  async config(): Promise<ConfiguredAIOptions> {
    const base = aiConfig as unknown as ConfiguredAIOptions
    const row = await this.row()
    if (!isProvider(row?.ai_provider)) return base

    const provider = row.ai_provider as SettingsAIProvider
    const apiKey = await openToken(row.ai_api_key)
    const drivers = { ...(base.drivers || {}) } as Record<string, Record<string, unknown>>
    drivers[provider] = {
      ...(drivers[provider] || {}),
      ...(provider === 'ollama' ? {} : apiKey ? { apiKey } : {}),
      ...(row.ai_model ? { model: String(row.ai_model) } : {}),
    }
    return { ...base, default: provider as AIProvider, drivers } as ConfiguredAIOptions
  }

  private async row(): Promise<Record<string, any> | undefined> {
    const id = await ensureAccount()
    return await database
      .selectFrom('accounts')
      .select(['ai_provider', 'ai_api_key', 'ai_model'])
      .where('id', '=', id)
      .executeTakeFirst()
  }
}

export const aiSettings = new AISettingsService()
