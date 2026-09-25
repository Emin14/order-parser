import { chromium } from 'playwright';
import * as fs from 'fs';

(async () => {
    console.log("Launching browser...");
    const browser = await chromium.launchPersistentContext(
        'C:\\Users\\emina\\.yandex-debug',
        {
            headless: false,
            executablePath: 'C:\\Program Files\\Yandex\\YandexBrowser\\Application\\browser.exe',
            viewport: null,
            args: ['--disable-gpu-shader-disk-cache']
        }
    );

    const page = browser.pages().find(p => p.url().includes('vk.com') || p.url().includes('vk.me')) || await browser.newPage();
    await page.goto('https://vk.com/im', { waitUntil: 'domcontentloaded' });
    await page.bringToFront();

    console.log("Waiting for Orders tab...");
    const ordersTab = page.locator('.OrganiserViewHorizontal__item, [data-testid^="me_folder_tab_"]').filter({ hasText: 'Заказы' });
    await ordersTab.waitFor({ state: 'visible', timeout: 15000 });
    await ordersTab.click();
    await page.waitForTimeout(2000);

    console.log("Clicking Овощи Хорошие руки/Зерно...");
    const targetChat = page.locator('button[data-testid="vkme_convo_list_item"]').filter({ hasText: 'Овощи Хорошие руки/Зерно' }).first();
    await targetChat.scrollIntoViewIfNeeded().catch(() => {});
    await targetChat.evaluate((el: HTMLElement) => el.click()).catch(() => {});
    await page.waitForTimeout(3000);

    // Scroll up a few times to reveal some banners
    console.log("Scrolling up...");
    for (let i=0; i<3; i++) {
        await page.mouse.wheel(0, -800);
        await page.waitForTimeout(1000);
    }

    console.log("Dumping DOM...");
    const domDump = await page.evaluate(() => {
        const chatRoot = document.querySelector('.ConvoMain, [class*="ConvoMain"], .ConvoHistory, [class*="ConvoHistory"], .im-page--chat-body') 
            || document.querySelector('[class*="ConvoMessage"]')?.closest('[data-scrollbar="scrollable"]')
            || document.body;
        return chatRoot.innerHTML;
    });

    fs.writeFileSync('vk_dom_dump.html', domDump);
    console.log("Dump saved to vk_dom_dump.html");

    await browser.close();
})();
