import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { APIError } from 'openai';

export const AI_UNAVAILABLE_MESSAGE =
  'Our AI service is temporarily unavailable. Please try again in a few minutes.';

/**
 * True when the call failed on OpenAI's side or on the way there
 * (bad/expired key, no credits, rate limit, network) — i.e. not the user's photo.
 */
export function isOpenAiServiceError(error: unknown): error is APIError {
  return error instanceof APIError;
}

/**
 * Logs the real OpenAI failure (HTTP status + error code, e.g. 401 invalid_api_key,
 * 429 insufficient_quota) and returns a 503 the app can show as-is.
 */
export function toAiUnavailable(
  logger: Logger,
  context: string,
  error: APIError,
): ServiceUnavailableException {
  logger.error(
    `OpenAI call failed (${context}): status=${error.status ?? 'n/a'} code=${error.code ?? 'n/a'} type=${error.type ?? 'n/a'} — ${error.message}`,
  );
  return new ServiceUnavailableException({
    code: 'AI_UNAVAILABLE',
    message: AI_UNAVAILABLE_MESSAGE,
  });
}
