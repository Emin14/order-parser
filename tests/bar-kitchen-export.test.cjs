const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
require('tsx/cjs');
const { exportToWord } = require('../src/utils/word_exporter.ts');

async function paragraphs(text, chatConfig) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bar-kitchen-export-'));
    const previousDirectory = process.cwd();
    try {
        fs.writeFileSync(path.join(directory, 'cafes_config.json'), JSON.stringify({
            vk: { chats: [{ name: 'Проверка', enabled: true, merge_same_spot: false, ...chatConfig }] }
        }));
        process.chdir(directory);
        const output = path.join(directory, 'orders.docx');
        await exportToWord([{
            messenger: 'VK', chatName: 'Проверка',
            messages: [{ sender: 'Клиент', phone: '', time: '23:07', text }]
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

test('Обычные чаты без shared_chat сохраняют прежние блоки', async () => {
    const result = await paragraphs('Название организации:\nЗаказ бар:\nЛимоны 5шт\nЗаказ кухня:\nАйсберг 3кг', { shared_chat: false });
    assert.deepEqual(result.map(p => p.text), [
        'Проверка:', 'Заказ бар:', 'Лимоны 5шт', '', 'Заказ кухня:', 'Айсберг 3кг'
    ]);
});
