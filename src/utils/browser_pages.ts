import { BrowserContext, Page } from 'playwright';

/** Ищет уже открытую вкладку, дожидаясь завершения её навигации. */
export async function findPageByUrl(
    context: BrowserContext,
    predicate: (url: string) => boolean,
    timeoutMs = 10000
): Promise<Page | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const page = context.pages().find((candidate) => predicate(candidate.url()));
        if (page) return page;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    return context.pages().find((candidate) => predicate(candidate.url()));
}
