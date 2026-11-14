import { GoogleGenAI, Schema } from '@google/genai';
import { AppError } from '../../middleware/errorHandler.ts';

export interface StructuredGenerateParams {
  systemInstruction: string;
  userPrompt: string;
  responseSchema: Schema;
}

export interface LLMGenerationResult<T> {
  data: T;
  provider: string;
  model: string;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  generateStructuredJson<T>(params: StructuredGenerateParams): Promise<LLMGenerationResult<T>>;
}

class GeminiProvider implements LLMProvider {
  public readonly name = 'gemini';
  public readonly model = 'gemini-4-hydrogen';
  private client: GoogleGenAI | null = null;

  private getClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      throw new AppError(
        503,
        'AI_NOT_CONFIGURED',
        'GEMINI_API_KEY is not configured in server secrets.',
      );
    }
    if (!this.client) {
      this.client = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }
    return this.client;
  }

  async generateStructuredJson<T>(
    params: StructuredGenerateParams,
  ): Promise<LLMGenerationResult<T>> {
    const ai = this.getClient();
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: this.model,
          contents: params.userPrompt,
          config: {
            systemInstruction: params.systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: params.responseSchema,
          },
        });

        const rawText = (response.text ?? '').trim();
        if (!rawText) {
          throw new Error('Empty response received from Gemini model.');
        }
        const parsed = JSON.parse(rawText) as T;
        return {
          data: parsed,
          provider: this.name,
          model: this.model,
        };
      } catch (err: unknown) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        const isTransient = /429|503|RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(msg);
        if (isTransient && attempt < 2) {
          await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
          continue;
        }
        break;
      }
    }

    const message = lastError instanceof Error ? lastError.message : 'AI generation failed.';
    if (/PERMISSION_DENIED|API_KEY_INVALID|403|400/i.test(message)) {
      throw new AppError(
        502,
        'AI_AUTH_ERROR',
        'AI provider rejected the configured API key. Verify GEMINI_API_KEY in Settings > Secrets.',
      );
    }
    if (/429|RESOURCE_EXHAUSTED/i.test(message)) {
      throw new AppError(
        429,
        'AI_RATE_LIMITED',
        'AI provider quota reached. Please wait briefly and try again.',
      );
    }
    throw new AppError(502, 'AI_GENERATION_FAILED', `AI synthesis failed: ${message}`);
  }
}

export function getLLMProvider(): LLMProvider {
  const configured = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
  if (configured === 'gemini') {
    return new GeminiProvider();
  }
  // Future provider adapters (e.g., openai) plug in cleanly here
  return new GeminiProvider();
}
