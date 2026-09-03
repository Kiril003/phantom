/**
 * PHANTOM Sovereign AI Engine Service
 * Provides direct, zero-proxy client-side integration with:
 * - Google Gemini (Gemini 2.5 Flash, Gemini 1.5 Pro)
 * - OpenAI (GPT-4o, GPT-4o-mini)
 * - Groq / DeepSeek
 * - Anthropic Claude
 * - Local / Custom endpoints (Ollama, vLLM)
 */

export type AIProvider = 'gemini' | 'openai' | 'groq' | 'anthropic' | 'custom';

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  systemInstruction?: string;
}

const STORAGE_KEY = 'phantom_sovereign_ai_config';

const DEFAULT_CONFIG: AIConfig = {
  provider: 'gemini',
  apiKey: '',
  model: 'gemini-2.5-flash',
  temperature: 0.7,
  systemInstruction:
    'Ти PHANTOM — суверенний автономний цифровий симбіонт і персональний агент оператора Kiril. Твоя мова за замовчуванням — бездоганна українська, стиль — лаконічний, точний, технологічно глибокий, без зайвої води. Допомагай у плануванні, програмуванні, аналізі даних, координуванні завдань та побудові рішень.',
};

export interface ChatHistoryItem {
  role: 'user' | 'model' | 'assistant' | 'system';
  content: string;
}

export interface GenerateOptions {
  prompt: string;
  history?: ChatHistoryItem[];
  persona?: string;
  systemInstruction?: string;
}

class AIEngineService {
  private config: AIConfig = DEFAULT_CONFIG;
  private listeners = new Set<() => void>();

  constructor() {
    this.loadConfig();
  }

  public loadConfig(): AIConfig {
    if (typeof window === 'undefined') return this.config;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.config = { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch (e) {
      console.warn('[AIEngine] Failed to load AI config from localStorage', e);
    }
    return this.config;
  }

  public saveConfig(updated: Partial<AIConfig>) {
    this.config = { ...this.config, ...updated };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch (e) {
      console.warn('[AIEngine] Failed to save AI config to localStorage', e);
    }
    this.notify();
  }

  public getConfig(): AIConfig {
    return { ...this.config };
  }

  public getApiKey(): string {
    return this.config.apiKey?.trim() || '';
  }

  public hasApiKey(): boolean {
    return !!this.config.apiKey?.trim();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  /**
   * Tests whether current API Key and provider setup works
   */
  public async testConnection(): Promise<{ ok: boolean; message: string }> {
    const key = this.getApiKey();
    if (!key && this.config.provider !== 'custom') {
      return { ok: false, message: 'Введіть API ключ для перевірки' };
    }

    try {
      const reply = await this.generateReply({
        prompt: 'Привіт, підтверди зв\'язок одним словом.',
        systemInstruction: 'Відповідай рівно одним словом: ПІДТВЕРДЖЕНО',
      });
      if (reply) {
        return { ok: true, message: `Зв'язок успішний (${this.config.provider.toUpperCase()} ${this.config.model}): ${reply.slice(0, 40)}` };
      }
      return { ok: false, message: 'Отримано порожню відповідь' };
    } catch (err: any) {
      return { ok: false, message: err?.message || 'Помилка з\'єднання з AI API' };
    }
  }

  /**
   * Main completion generation entry point
   */
  public async generateReply(options: GenerateOptions): Promise<string> {
    const { provider, model, apiKey, baseUrl, temperature } = this.config;
    const sysPrompt = options.systemInstruction || this.config.systemInstruction || DEFAULT_CONFIG.systemInstruction!;

    if (!apiKey && provider !== 'custom') {
      throw new Error('API ключ не налаштовано. Відкрийте Налаштування ⚙️ -> Нейромережа та введіть ваш API ключ.');
    }

    if (provider === 'gemini') {
      return this.callGemini(model || 'gemini-2.5-flash', apiKey, options.prompt, options.history || [], sysPrompt, temperature ?? 0.7);
    } else if (provider === 'openai' || provider === 'groq' || provider === 'custom') {
      const defaultEndpoint =
        provider === 'openai'
          ? 'https://api.openai.com/v1/chat/completions'
          : provider === 'groq'
          ? 'https://api.groq.com/openai/v1/chat/completions'
          : `${(baseUrl || 'http://localhost:11434').replace(/\/$/, '')}/v1/chat/completions`;

      return this.callOpenAICompatible(defaultEndpoint, model, apiKey, options.prompt, options.history || [], sysPrompt, temperature ?? 0.7);
    } else if (provider === 'anthropic') {
      return this.callAnthropic(model || 'claude-3-5-sonnet-20241022', apiKey, options.prompt, options.history || [], sysPrompt, temperature ?? 0.7);
    }

    throw new Error(`Невідомий провайдер: ${provider}`);
  }

  private async callGemini(
    model: string,
    apiKey: string,
    prompt: string,
    history: ChatHistoryItem[],
    systemPrompt: string,
    temperature: number
  ): Promise<string> {
    const effectiveModel = model.includes('gemini') ? model : 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent?key=${apiKey}`;

    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    const recentHistory = history.slice(-12);
    for (const h of recentHistory) {
      if (h.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: h.content }] });
      } else if (h.role === 'model' || h.role === 'assistant') {
        contents.push({ role: 'model', parts: [{ text: h.content }] });
      }
    }

    contents.push({ role: 'user', parts: [{ text: prompt }] });

    const payload: any = {
      contents,
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      generationConfig: {
        temperature,
        maxOutputTokens: 2048,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let parsedMsg = errText;
      try {
        const errJson = JSON.parse(errText);
        parsedMsg = errJson.error?.message || errText;
      } catch {
        // Тіло помилки не JSON — лишаємо сирий текст як є.
        // Порожній блок тут ЧЕСНИЙ, на відміну від решти таких у
        // дереві: нічого не ковтається, бо рядком нижче виняток
        // однаково летить далі з цим самим текстом. Це розбір
        // формату, а не приховування відмови.
      }
      throw new Error(`Gemini API помилка (${res.status}): ${parsedMsg}`);
    }

    const json = await res.json();
    const candidates = json.candidates;
    if (candidates && candidates[0]?.content?.parts) {
      const texts = candidates[0].content.parts.map((p: any) => p.text || '').join('');
      return texts.trim();
    }

    return 'Не вдалося розпізнати відповідь Gemini.';
  }

  private async callOpenAICompatible(
    url: string,
    model: string,
    apiKey: string,
    prompt: string,
    history: ChatHistoryItem[],
    systemPrompt: string,
    temperature: number
  ): Promise<string> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    const recentHistory = history.slice(-12);
    for (const h of recentHistory) {
      messages.push({
        role: h.role === 'user' ? 'user' : 'assistant',
        content: h.content,
      });
    }

    messages.push({ role: 'user', content: prompt });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages,
        temperature,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let parsedMsg = errText;
      try {
        const errJson = JSON.parse(errText);
        parsedMsg = errJson.error?.message || errText;
      } catch {
        // Тіло помилки не JSON — лишаємо сирий текст як є.
        // Порожній блок тут ЧЕСНИЙ, на відміну від решти таких у
        // дереві: нічого не ковтається, бо рядком нижче виняток
        // однаково летить далі з цим самим текстом. Це розбір
        // формату, а не приховування відмови.
      }
      throw new Error(`AI API помилка (${res.status}): ${parsedMsg}`);
    }

    const json = await res.json();
    return json.choices?.[0]?.message?.content?.trim() || 'Порожня відповідь від AI.';
  }

  private async callAnthropic(
    model: string,
    apiKey: string,
    prompt: string,
    history: ChatHistoryItem[],
    systemPrompt: string,
    temperature: number
  ): Promise<string> {
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const recentHistory = history.slice(-12);
    for (const h of recentHistory) {
      messages.push({
        role: h.role === 'user' ? 'user' : 'assistant',
        content: h.content,
      });
    }
    messages.push({ role: 'user', content: prompt });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: model || 'claude-3-5-sonnet-20241022',
        system: systemPrompt,
        messages,
        max_tokens: 2048,
        temperature,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Anthropic API помилка (${res.status}): ${errText}`);
    }

    const json = await res.json();
    const content = json.content;
    if (Array.isArray(content)) {
      return content.map((c: any) => c.text || '').join('').trim();
    }
    return 'Порожня відповідь від Anthropic.';
  }
}

export const aiEngineService = new AIEngineService();
