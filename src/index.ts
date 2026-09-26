import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { parseWhatsApp } from './parsers/whatsapp';
import { parseTelegram } from './parsers/telegram';
import { parseVk } from './parsers/vk';
import { OrderResult } from './types';

// Загружаем переменные окружения из файла .env
dotenv.config();

const USER_DATA_DIR = process.env.USER_DATA_DIR || 'C:\\Users\\emina\\.yandex-debug';
const YANDEX_PATH = process.env.YANDEX_PATH || 'C:\\Program Files\\Yandex\\YandexBrowser\\Application\\browser.exe';

// ПЕРЕКЛЮЧАТЕЛЬ ДЛЯ ТЕСТИРОВАНИЯ WORD-ЭКСПОРТА:
// Установите USE_MOCK_DATA = true, чтобы использовать готовый mock_orders.json без запуска браузера
const USE_MOCK_DATA = true;

async function main() {
    try {
        const allOrders: OrderResult[] = [];

        if (USE_MOCK_DATA) {
            console.log('🛠 ИСПОЛЬЗУЮТСЯ ТЕСТОВЫЕ ДАННЫЕ (mock_orders.json)');
            const mockData = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'mock_orders.json'), 'utf8'));
            allOrders.push(...mockData);
        } else {
            console.log('🚀 Запуск Яндекс.Браузера...');
            const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
                headless: false, 
                executablePath: YANDEX_PATH,
                viewport: null, 
                args: ['--test-type', '--disable-gpu', '--disable-gpu-shader-disk-cache'],
                ignoreDefaultArgs: ['--enable-automation'] 
            });
            
            try {
                // 1. Сбор заказов из WhatsApp
                const whatsappOrders = await parseWhatsApp(context);
                allOrders.push(...whatsappOrders);

                // 2. Сбор заказов из Telegram
                const telegramOrders = await parseTelegram(context);
                allOrders.push(...telegramOrders);

                // 3. Сбор заказов из VKontakte
                const vkOrders = await parseVk(context);
                allOrders.push(...vkOrders);
            } finally {
                await context.close();
            }
        }

        console.log('\n===================================');
        console.log(`🎉 ВСЕГО СОБРАНО ЗАКАЗОВ: ${allOrders.length}`);
        console.dir(allOrders, { depth: null, colors: true });
        console.log('===================================\n');

        // Сохраняем в отдельный JSON-файл в корне проекта
        const outputPath = path.join(process.cwd(), 'orders.json');
        fs.writeFileSync(outputPath, JSON.stringify(allOrders, null, 2), 'utf-8');
        console.log(`💾 Все заказы успешно записаны в файл: ${outputPath}\n`);

        // Логика названия файла: Заказ на [дата]
        const now = new Date();
        const targetDate = new Date(now);
        // Если время после 12:00 (до 23:59), заказы собираются на завтра
        if (now.getHours() >= 12) {
            targetDate.setDate(targetDate.getDate() + 1);
        }
        
        const day = String(targetDate.getDate()).padStart(2, '0');
        const month = String(targetDate.getMonth() + 1).padStart(2, '0');
        const year = targetDate.getFullYear();
        const dateStr = `${day}.${month}.${year}`;
        
        const wordOutputPath = path.join(process.cwd(), `Заказ на ${dateStr}.docx`);
        
        const { exportToWord } = await import('./utils/word_exporter');
        await exportToWord(allOrders, wordOutputPath);

        console.log('⏳ Ожидание 5 минут перед завершением...');
        await new Promise(r => setTimeout(r, 300000));

    } catch (error) {
        console.error('❌ Ошибка во время выполнения:', error);
    }
}

main();