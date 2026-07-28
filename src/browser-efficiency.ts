const BLOCKED_RESOURCE_TYPES = new Set(['font', 'image', 'media']);

export function shouldBlockBrowserResource(resourceType: string): boolean {
  return BLOCKED_RESOURCE_TYPES.has(resourceType);
}

export async function blockHeavyBrowserResources(page: {
  route(
    pattern: string,
    handler: (route: {
      request(): { resourceType(): string };
      abort(): Promise<void>;
      continue(): Promise<void>;
    }) => Promise<void>,
  ): Promise<unknown>;
}): Promise<void> {
  await page.route('**/*', async (route) => {
    if (shouldBlockBrowserResource(route.request().resourceType())) {
      await route.abort().catch(() => undefined);
      return;
    }
    await route.continue().catch(() => undefined);
  });
}
