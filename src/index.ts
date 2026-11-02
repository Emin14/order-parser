import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { parseWhatsApp } from './parsers/whatsapp';
import { parseTelegram } from './parsers/telegram';
import { parseVk } from './parsers/vk';
import { OrderResult } from './types';
import { getCollectionContext } from './utils/collection';
import { getTopUpRange } from './utils/top_up';

// Общие настройки для сборщика и ярлыка рабочего браузера.
const { loadBrowserConfig } = require('../scripts/browser-config.cjs');

// ПЕРЕКЛЮЧАТЕЛЬ ДЛЯ ТЕСТИРОВАНИЯ WORD-ЭКСПОРТА:
// Установите USE_MOCK_DATA = true, чтобы использовать готовый mock_orders.json без запуска браузера
const USE_MOCK_DATA = false;

// ДОБОР ЗАКАЗОВ: укажите время в формате "HH:MM" чтобы собрать только с этого момента.
// Оставьте пустую строку '' для обычного полного сбора.
// Пример: const FROM_TIME = '23:01';  // собрать с 23:01 вчера/сегодня до сейчас
const FROM_TIME = '';
// Верхняя граница Word-экспорта включительно; '' — до момента запуска экспорта.
const TO_TIME = '';

async function main() {
    try {
        // Аргумент --from HH:MM из командной строки перекрывает FROM_TIME
        // Пример: node index.js --from 23:01
        const fromArgIndex = process.argv.indexOf('--from');
        const fromTime: string | undefined =
            fromArgIndex !== -1 ? process.argv[fromArgIndex + 1]
            : FROM_TIME || undefined;
        const toArgIndex = process.argv.indexOf('--to');
        const toTime: string | undefined =
            toArgIndex !== -1 ? process.argv[toArgIndex + 1]
            : TO_TIME || undefined;
        if ((fromArgIndex !== -1 && (!fromTime || fromTime.startsWith('--'))) ||
            (toArgIndex !== -1 && (!toTime || toTime.startsWith('--')))) {
            throw new Error('После --from и --to нужно указать время HH:MM.');
        }
        getTopUpRange(fromTime, toTime); // Проверяем параметры до запуска браузера.
        if (fromTime || toTime) {
            console.log(`⏱️ Режим ДОБОРА:${fromTime ? ` с ${fromTime}` : ''} до ${toTime || 'текущего момента'}`);
        }

        const allOrders: OrderResult[] = [];

        if (USE_MOCK_DATA) {
            console.log('🛠 ИСПОЛЬЗУЮТСЯ ТЕСТОВЫЕ ДАННЫЕ (mock_orders.json)');
            const mockData = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'mock_orders.json'), 'utf8'));
            allOrders.push(...mockData);
        } else {
            const { browserPath, userDataDir } = loadBrowserConfig();
            console.log('🚀 Запуск браузера заказов...');
            const context = await chromium.launchPersistentContext(userDataDir, {
                headless: false, 
                executablePath: browserPath,
                viewport: null, 
                args: ['--test-type', '--disable-gpu', '--disable-gpu-shader-disk-cache'],
                ignoreDefaultArgs: ['--enable-automation'] 
            });
            
            // Пробуждаем ВСЕ фоновые вкладки (Яндекс.Браузер усыпляет их, скрывая от скрипта)
            try {
                const pages = context.pages();
                if (pages.length > 0) {
                    const client = await context.newCDPSession(pages[0]);
                    const { targetInfos } = await client.send('Target.getTargets');
                    
                    for (const target of targetInfos) {
                        if (target.type === 'page') {
                            await client.send('Target.activateTarget', { targetId: target.targetId }).catch(() => {});
                        }
                    }
                    await new Promise(r => setTimeout(r, 1000));
                }
            } catch (e) {
                console.log('⚠️ Не удалось разбудить вкладки:', e instanceof Error ? e.message : String(e));
            }
            
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
        // Не печатаем все тексты сообщений: большой console.dir задерживает начало Word-экспорта.
        console.table(allOrders.map(order => ({
            messenger: order.messenger,
            chat: order.chatName,
            messages: order.messages.length,
        })));
        console.log('===================================\n');

        // Сохраняем в отдельный JSON-файл в корне проекта
        const outputPath = path.join(process.cwd(), 'orders.json');
        fs.writeFileSync(outputPath, JSON.stringify(allOrders, null, 2), 'utf-8');
        console.log(`💾 Все заказы успешно записаны в файл: ${outputPath}\n`);

        // Логика названия файла: Заказ на [дата]
        const targetDate = getCollectionContext(new Date()).deliveryDate;
        
        const day = String(targetDate.getDate()).padStart(2, '0');
        const month = String(targetDate.getMonth() + 1).padStart(2, '0');
        const year = targetDate.getFullYear();
        const dateStr = `${day}.${month}.${year}`;
        
        let fileName = `Заказ на ${dateStr}`;
        if (fromTime) {
            const timeSafe = fromTime.replace(/:/g, '.');
            fileName += ` с ${timeSafe}`;
        }
        if (toTime) fileName += ` до ${toTime.replace(/:/g, '.')}`;
        fileName += '.docx';
        
        const wordOutputPath = path.join(process.cwd(), fileName);
        
        const { exportToWord } = await import('./utils/word_exporter');
        const exportStartedAt = Date.now();
        console.log(`📝 Начинаем создание Word-файла: ${wordOutputPath}`);
        await exportToWord(allOrders, wordOutputPath, fromTime, toTime);
        console.log(`⏱️ Word-файл подготовлен за ${((Date.now() - exportStartedAt) / 1000).toFixed(1)} с`);

        console.log('⏳ Ожидание 5 минут перед завершением...');
        await new Promise(r => setTimeout(r, 300000));
        
    } catch (error) {
        console.error('❌ Ошибка во время выполнения:', error);
    }
}

main();
