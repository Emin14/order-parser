import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { parseWhatsApp } from './parsers/whatsapp';
import { parseTelegram } from './parsers/telegram';
import { parseVk } from './parsers/vk';
import { OrderResult } from './types';

const USER_DATA_DIR = 'C:\\Users\\emina\\.yandex-debug';
const YANDEX_PATH = 'C:\\Program Files\\Yandex\\YandexBrowser\\Application\\browser.exe';

async function main() {
    console.log('🚀 Запуск Яндекс.Браузера...');
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false, 
        executablePath: YANDEX_PATH,
        viewport: null, 
        args: ['--test-type', '--disable-gpu', '--disable-gpu-shader-disk-cache'],
        ignoreDefaultArgs: ['--enable-automation'] 
    });

    try {
        const allOrders: OrderResult[] = [];

        // 1. Сбор заказов из WhatsApp
        // const whatsappOrders = await parseWhatsApp(context);
        // allOrders.push(...whatsappOrders);

        // 2. Сбор заказов из Telegram
        const telegramOrders = await parseTelegram(context);
        allOrders.push(...telegramOrders);

        // 3. Сбор заказов из VKontakte
        // const vkOrders = await parseVk(context);
        // allOrders.push(...vkOrders);

        console.log('\n===================================');
        console.log(`🎉 ВСЕГО СОБРАНО ЗАКАЗОВ: ${allOrders.length}`);
        console.dir(allOrders, { depth: null, colors: true });
        console.log('===================================\n');

        // Сохраняем в отдельный JSON-файл в корне проекта
        const outputPath = path.join(process.cwd(), 'orders.json');
        fs.writeFileSync(outputPath, JSON.stringify(allOrders, null, 2), 'utf-8');
        console.log(`💾 Все заказы успешно записаны в файл: ${outputPath}\n`);

        console.log('⏳ Ожидание 5 минут перед завершением...');
        await new Promise(r => setTimeout(r, 300000));

    } catch (error) {
        console.error('❌ Ошибка во время выполнения:', error);
    } finally {
        await context.close();
    }
}

main();