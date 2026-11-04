const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
require('tsx/cjs');
const { exportToWord } = require('../src/utils/word_exporter.ts');

async function paragraphs(text, chatConfig, messageFields = {}, messenger = 'VK') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bar-kitchen-export-'));
    const previousDirectory = process.cwd();
    try {
        fs.writeFileSync(path.join(directory, 'cafes_config.json'), JSON.stringify({
            [messenger.toLowerCase()]: { chats: [{ name: 'Проверка', enabled: true, merge_same_spot: false, ...chatConfig }] }
        }));
        process.chdir(directory);
        const output = path.join(directory, 'orders.docx');
        await exportToWord([{
            messenger, chatName: 'Проверка',
            messages: [{ sender: 'Клиент', phone: '', time: '23:07', text, ...messageFields }]
        }], output);
        const zip = await JSZip.loadAsync(fs.readFileSync(output));
        const xml = await zip.file('word/document.xml').async('string');
        return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(([paragraph]) => ({
            text: [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join(''),
            bold: /<w:b(?:\s|\/|>)/.test(paragraph)
        }));
    } finally {
        process.chdir(previousDirectory);
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

const shared = { shared_chat: true, allow_unlisted_headers: true };

async function withDate(instant, action) {
    const RealDate = global.Date;
    global.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [instant.getTime()])); }
        static now() { return instant.getTime(); }
    };
    try { return await action(); } finally { global.Date = RealDate; }
}

const arcada = {
    shared_chat: true, split_sub_orders: true, use_branch_name: true,
    branches: [{ name: 'Аркада', aliases: ['аркаду'] }]
};

test('После отделения Аркады подходящий срок удаляется во всех мессенджерах', async () => {
    await withDate(new Date(2026, 10, 4, 23), async () => {
        for (const messenger of ['VK', 'Telegram', 'WhatsApp']) {
            for (const term of ['на завтра', 'на четверг', 'заявка на 5.11', 'на 5 ноября']) {
                const result = await paragraphs(`Здравствуйте! В аркаду пожалуйста  ${term} :\nБананы 2 кг\nАпельсины 20кг`, arcada,
                    { date: '04.11', time: '15:43' }, messenger);
                assert.deepEqual(result.map(p => p.text), ['Аркада:', 'Бананы 2 кг', 'Апельсины 20кг']);
            }
        }
    });
});

test('После отделения филиала сохраняются чужой срок, старое сообщение и комментарии', async () => {
    await withDate(new Date(2026, 10, 4, 23), async () => {
        for (const [term, fields, expected] of [
            ['на пятницу', { date: '04.11', time: '15:43' }, 'на пятницу'],
            ['на 6 ноября', { date: '04.11', time: '15:43' }, 'на 6 ноября'],
            ['на завтра', { date: '03.11', time: '20:00' }, 'на завтра'],
            ['на завтра привезите к открытию', { date: '04.11', time: '15:43' }, 'привезите к открытию'],
            ['на завтра', { date: '04.11', time: '' }, 'на завтра']
        ]) {
            const result = await paragraphs(`В аркаду пожалуйста ${term}\nБананы 2 кг\nАпельсины 20кг`, arcada, fields);
            assert.ok(result.some(p => p.text === expected), JSON.stringify(result));
            assert.ok(result.some(p => p.text === 'Бананы 2 кг'));
            assert.ok(result.some(p => p.text === 'Апельсины 20кг'));
        }
    });
});

test('Без замены филиала каноническим именем исходный заголовок сохраняется', async () => {
    await withDate(new Date(2026, 10, 4, 23), async () => {
        const result = await paragraphs('Здравствуйте! В аркаду пожалуйста на завтра:\nБананы 2 кг',
            { ...arcada, use_branch_name: false }, { date: '04.11', time: '15:43' });
        assert.deepEqual(result.map(p => p.text), ['В аркаду на завтра:', 'Бананы 2 кг']);
    });
});

test('ИП Каюмова: заявка на 2 ноября во второй строке удаляется, товары остаются', async () => {
    await withDate(new Date(2026, 10, 2, 10), async () => {
        for (const request of ['примите пожалуйста заявку', 'примите заявку пожалуйста', 'примите заявку']) {
            const text = `Ип каюмова\nЗдравствуйте, ${request} на 2 ноября\nКартофель 25\nЛук репчатый 10 кг\nЛук зелёный 150`;
            for (const fields of [
                { date: '01.11' },
                { date: '01.11', isForwarded: true, forwardedText: text, forwardedOuterText: '' }
            ]) {
                const result = await paragraphs(text, shared, fields);
                assert.deepEqual(result.map(p => p.text), ['Ип каюмова:', 'Картофель 25', 'Лук репчатый 10 кг', 'Лук зелёный 150']);
            }
        }
    });
});

test('Дата другого дня во второй строке остаётся в Word', async () => {
    await withDate(new Date(2026, 10, 2, 10), async () => {
        const result = await paragraphs('Ип каюмова\nЗдравствуйте, примите пожалуйста заявку на 3 ноября\nКартофель 25', shared, { date: '01.11' });
        assert.deepEqual(result.map(p => p.text), ['Ип каюмова:', 'на 3 ноября', 'Картофель 25']);
    });
});

test('Запуск в 16:26: ПУР-ПУР, числовая дата и Каюмова очищаются в готовом Word', async () => {
    await withDate(new Date(2026, 10, 2, 16, 26), async () => {
        const pur = await paragraphs('Примите заказ пожалуйста на завтра\n\nАпельсины 3 кг',
            { shared_chat: false }, { date: '01.11', time: '20:20' });
        assert.deepEqual(pur.map(p => p.text), ['Проверка:', 'Апельсины 3 кг']);
        const flame = await paragraphs('Добрый вечер,заявка на 2.11\nКартофель 15кг',
            { shared_chat: false }, { date: '01.11', time: '23:48' });
        assert.deepEqual(flame.map(p => p.text), ['Проверка:', 'Картофель 15кг']);
        const text = 'Здравствуйте, примите пожалуйста заявку на 2 ноября\nКартофель 25';
        const family = await paragraphs('Ип каюмова\n' + text, shared, {
            date: '01.11', time: '23:07', isForwarded: true,
            forwardedText: text, forwardedOuterText: 'Ип каюмова'
        });
        assert.deepEqual(family.map(p => p.text), ['Ип каюмова:', 'Картофель 25']);
    });
});

test('Семья: общий контекст и бар/кухня становятся жирными заголовками в Word', async () => {
    const result = await paragraphs('Добрый день!\nЗаказ на понедельник ИП Лутикова Екатерина:\nЗаказ бар:\nЛимоны 5шт\nЗаказ кухня:\nАйсберг 3кг', shared);
    assert.deepEqual(result, [
        { text: 'Заказ на понедельник ИП Лутикова Екатерина Заказ бар:', bold: true },
        { text: 'Лимоны 5шт', bold: false },
        { text: 'Заказ на понедельник ИП Лутикова Екатерина Заказ кухня:', bold: true },
        { text: 'Айсберг 3кг', bold: false }
    ]);
});

test('Контекст из нескольких строк сохраняется целиком, кухня может идти первой', async () => {
    const result = await paragraphs('ИП Лутикова\nЕкатерина:\nЗаказ кухня:\nАйсберг 3кг\nЗаказ бар:\nЛимоны 5шт', shared);
    assert.deepEqual(result.filter(p => p.bold).map(p => p.text), [
        'ИП Лутикова Екатерина Заказ кухня:', 'ИП Лутикова Екатерина Заказ бар:'
    ]);
    assert.deepEqual(result.filter(p => !p.bold).map(p => p.text), ['Айсберг 3кг', 'Лимоны 5шт']);
});

test('Приветствие без контекста не добавляется к заголовкам', async () => {
    const result = await paragraphs('Добрый день!\nЗаказ бар:\nЛимоны 5шт\nЗаказ кухня:\nАйсберг 3кг', shared);
    assert.deepEqual(result.filter(p => p.bold).map(p => p.text), ['Заказ бар:', 'Заказ кухня:']);
});

test('Срок поставки удаляется до формирования общего заголовка бара и кухни', async () => {
    const { getDeliveryPeriod } = require('../src/utils/delivery_rules.ts');
    const { deliveryDate, start } = getDeliveryPeriod(new Date());
    const target = `${deliveryDate.getDate()}.${deliveryDate.getMonth() + 1}`;
    const date = `${start.getDate()}.${start.getMonth() + 1}`;
    const result = await paragraphs(`Добрый день!\nЗаявка на ${target} ИП Лутикова Екатерина:\nЗаказ бар:\nЛимоны 5шт\nЗаказ кухня:\nАйсберг 3кг`, shared, { date });
    assert.deepEqual(result.filter(p => p.bold).map(p => p.text), [
        'ИП Лутикова Екатерина Заказ бар:', 'ИП Лутикова Екатерина Заказ кухня:'
    ]);
});

test('Обычные чаты без shared_chat сохраняют прежние блоки', async () => {
    const result = await paragraphs('Название организации:\nЗаказ бар:\nЛимоны 5шт\nЗаказ кухня:\nАйсберг 3кг', { shared_chat: false });
    assert.deepEqual(result.map(p => p.text), [
        'Проверка:', 'Заказ бар:', 'Лимоны 5шт', '', 'Заказ кухня:', 'Айсберг 3кг'
    ]);
});
