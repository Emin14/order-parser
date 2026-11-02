const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
require('tsx/cjs');
const { exportToWord } = require('../src/utils/word_exporter.ts');

async function exportedText(now, fromTime, messages) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'top-up-export-'));
    const previousDirectory = process.cwd();
    const RealDate = global.Date;
    try {
        global.Date = class extends RealDate {
            constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
            static now() { return now.getTime(); }
        };
        const platforms = ['VK', 'Telegram', 'WhatsApp'];
        fs.writeFileSync(path.join(directory, 'cafes_config.json'), JSON.stringify(Object.fromEntries(
            platforms.map(platform => [platform.toLowerCase(), { chats: [{ name: platform, enabled: true }] }])
        )));
        process.chdir(directory);
        const output = path.join(directory, 'orders.docx');
        await exportToWord(platforms.map(messenger => ({
            messenger, chatName: messenger,
            messages: messages.map(message => ({ sender: 'Клиент', phone: '', ...message, text: `${messenger} ${message.text}` }))
        })), output, fromTime);
        const zip = await JSZip.loadAsync(fs.readFileSync(output));
        return await zip.file('word/document.xml').async('string');
    } finally {
        global.Date = RealDate;
        process.chdir(previousDirectory);
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

function checkPlatforms(xml, included, excluded) {
    for (const platform of ['VK', 'Telegram', 'WhatsApp']) {
        for (const text of included) assert.ok(xml.includes(`${platform} ${text}`), `${platform}: отсутствует ${text}`);
        for (const text of excluded) assert.ok(!xml.includes(`${platform} ${text}`), `${platform}: лишнее ${text}`);
    }
}

test('Word всех платформ: FROM_TIME=00:00 исключает вчера и субботу, сохраняя сегодняшний текст', async () => {
    const xml = await exportedText(new Date(2026, 10, 2, 16, 26), '00:00', [
        { date: '31.10', time: '11:00', text: 'Субботний текст' },
        { date: '01.11', time: '10:00', text: 'Вчерашний текст' },
        { date: '02.11', time: '00:00', text: 'Полуночный текст' },
        { date: '02.11', time: '12:00', text: 'Сегодняшний текст' }
    ]);
    checkPlatforms(xml, ['Полуночный текст', 'Сегодняшний текст'], ['Субботний текст', 'Вчерашний текст']);
});

test('Word всех платформ: утренний добор с 23:00 включает вчерашний вечер и сегодняшнее утро', async () => {
    const xml = await exportedText(new Date(2026, 10, 2, 10), '23:00', [
        { date: '31.10', time: '23:30', text: 'Субботний текст' },
        { date: '01.11', time: '22:59', text: 'Перед границей' },
        { date: '01.11', time: '23:00', text: 'На границе' },
        { date: '02.11', time: '09:00', text: 'Сегодняшний текст' }
    ]);
    checkPlatforms(xml, ['На границе', 'Сегодняшний текст'], ['Субботний текст', 'Перед границей']);
});

test('Word всех платформ: без FROM_TIME прежние сообщения остаются в экспорте', async () => {
    const xml = await exportedText(new Date(2026, 10, 2, 16, 26), undefined, [
        { date: '31.10', time: '11:00', text: 'Субботний текст' },
        { date: '01.11', time: '10:00', text: 'Вчерашний текст' },
        { date: '02.11', time: '12:00', text: 'Сегодняшний текст' }
    ]);
    checkPlatforms(xml, ['Субботний текст', 'Вчерашний текст', 'Сегодняшний текст'], []);
});
