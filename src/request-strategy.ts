import type { SourceContext } from './types.js';

export const HTTP_REQUEST_ATTEMPTS = 3;

export async function proxyUrlForAttempt(
  proxyConfiguration: SourceContext['proxyConfiguration'],
  sessionPrefix: string,
  attempt: number,
): Promise<string | undefined> {
  if (attempt <= 1) return undefined;
  return proxyConfiguration?.newUrl(`${sessionPrefix}_proxy_${attempt - 1}`);
}
