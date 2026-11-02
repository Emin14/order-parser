const { test } = require('node:test');
const assert = require('node:assert/strict');
require('tsx/cjs');
const { stripDeliveryPhrase: strip, getDeliveryPeriod, DELIVERY_RULES } = require('../src/utils/delivery_rules.ts');
const { isForTomorrow, getBannerDateCategory } = require('../src/utils/date.ts');

const monday = new Date(2026, 10, 2, 10);

test('Заявка на 2.11 и варианты числовой даты удаляются для понедельничной поставки', () => {
    for (const phrase of ['заявка на 2.11', 'ЗАЯВКА НА 02.11:', 'заказ на 2.11.26', 'закупка на 02.11.2026', 'на 2.11.', 'заказы на 2.11']) {
        assert.equal(strip(`${phrase}\nЛимоны 5шт`, '23:07', '01.11', monday), 'Лимоны 5шт', phrase);
    }
});

test('Другая дата, год, некорректное число и похожие слова сохраняются', () => {
    for (const phrase of ['заявка на 3.11', 'заявка на 2.12', 'заявка на 2.11.2027', 'заявка на 2.11.27', 'заявка на 2.11.20260', 'на понедельники', 'на завтраки']) {
        const text = phrase + '\nЛимоны 5шт';
        assert.equal(strip(text, '23:07', '01.11', monday), text, phrase);
    }
});

test('Контекст клиента после удалённого срока сохраняется', () => {
    assert.equal(strip('Заказ на понедельник ИП Лутикова Екатерина:\nЗаказ бар:\nЛимоны 5шт', '23:07', '01.11', monday),
        'ИП Лутикова Екатерина:\nЗаказ бар:\nЛимоны 5шт');
});

test('Все дни и сокращения поддерживаются из общего массива', () => {
    for (let day = 0; day < 7; day++) {
        const now = new Date(2026, 10, 2 + day, 10);
        const { deliveryDate, start } = getDeliveryPeriod(now);
        const date = `${start.getDate()}.${start.getMonth() + 1}`;
        for (const alias of DELIVERY_RULES.weekdays[deliveryDate.getDay()].aliases) {
            assert.equal(strip(`Заказ на ${alias}\nЛимоны 5шт`, '20:00', date, now), 'Лимоны 5шт', alias);
        }
    }
});

test('Понедельничное окно: суббота 15:00 — понедельник 15:00', () => {
    const period = getDeliveryPeriod(monday);
    assert.equal(period.start.getTime(), new Date(2026, 9, 31, 15).getTime());
    assert.equal(period.end.getTime(), new Date(2026, 10, 2, 15).getTime());
    const text = 'Заказ на понедельник\nЛимоны 5шт';
    assert.equal(strip(text, '14:59', '31.10', monday), text);
    for (const [date, time] of [['31.10', '15:00'], ['31.10', '20:45'], ['01.11', '11:00'], ['02.11', '14:59']]) {
        assert.equal(strip(text, time, date, monday), 'Лимоны 5шт');
    }
    assert.equal(strip(text, '15:00', '02.11', monday), text);
});

test('Смена сбора в 18:00, граница сообщений в 15:00, воскресенье включается в понедельник', () => {
    assert.equal(getDeliveryPeriod(new Date(2026, 10, 2, 14, 59)).deliveryDate.getDate(), 2);
    assert.equal(getDeliveryPeriod(new Date(2026, 10, 2, 15)).deliveryDate.getDate(), 2);
    assert.equal(getDeliveryPeriod(new Date(2026, 10, 2, 17, 59)).deliveryDate.getDate(), 2);
    assert.equal(getDeliveryPeriod(new Date(2026, 10, 2, 18)).deliveryDate.getDate(), 3);
    for (const now of [new Date(2026, 9, 31, 18), new Date(2026, 10, 1, 10), new Date(2026, 10, 1, 23)]) {
        assert.equal(getDeliveryPeriod(now).deliveryDate.getTime(), new Date(2026, 10, 2).getTime());
    }
});

test('Регрессия лога 02.11 16:26: все три срока воскресных сообщений очищаются', () => {
    for (const now of [new Date(2026, 10, 2, 15), new Date(2026, 10, 2, 16, 26), new Date(2026, 10, 2, 17, 59)]) {
        assert.equal(strip('на завтра\nАпельсины 3 кг', '20:20', '01.11', now), 'Апельсины 3 кг');
        assert.equal(strip('заявка на 2.11\nКартофель 15кг', '23:48', '01.11', now), 'Картофель 15кг');
        assert.equal(strip('Ип каюмова\nна 2 ноября\nКартофель 25', '23:07', '01.11', now), 'Ип каюмова\n\nКартофель 25');
    }
});

test('После 18:00 очистка соответствует следующему сбору и не стирает старые сроки', () => {
    const now = new Date(2026, 10, 2, 18);
    const text = 'Заявка на 2 ноября\nКартофель 25';
    assert.equal(strip(text, '23:07', '01.11', now), text);
    assert.equal(strip('Заявка на 3 ноября\nКартофель 25', '16:00', '02.11', now), 'Картофель 25');
    assert.equal(strip('На завтра\nКартофель 25', '16:00', '02.11', now), 'Картофель 25');
});

test('Во вторник вечером «на среду» удаляется, «на пятницу» остаётся', () => {
    const now = new Date(2026, 10, 3, 20);
    assert.equal(strip('Заказ на среду\nЛимоны 5шт', '19:00', '03.11', now), 'Лимоны 5шт');
    const text = 'Заказ на пятницу\nЛимоны 5шт';
    assert.equal(strip(text, '19:00', '03.11', now), text);
});

test('«Завтра» определяется по исходному дню, включая перенос с выходного', () => {
    const text = 'На завтра\nЛимоны 5шт';
    assert.equal(strip(text, '20:45', '31.10', monday), 'Лимоны 5шт');
    assert.equal(strip(text, '11:00', '01.11', monday), 'Лимоны 5шт');
    assert.equal(strip(text, '11:00', '02.11', monday), text);
    assert.equal(strip('на завтра 3.11\nЛимоны 5шт', '20:45', '01.11', monday), 'на завтра 3.11\nЛимоны 5шт');
});

test('Прошлые сообщения и сроки внутри комментариев не очищаются', () => {
    const text = 'Заявка на 2.11\nЛимоны 5шт';
    assert.equal(strip(text, '11:21', '31.10', monday), text);
    const comment = 'Лимоны 5шт\nПросьба уточнить: заявка на 2.11';
    assert.equal(strip(comment, '23:07', '01.11', monday), comment);
    assert.equal(strip(text, undefined, '01.11', monday), text);
    assert.equal(strip(text, '23:07', 'неизвестно', monday), text);
});

test('Срок удаляется в начале первой, второй и третьей непустой строки', () => {
    for (const prefix of ['', 'ИП Каюмова\n', 'ИП Каюмова\n\nКафе:\n\n']) {
        const text = prefix + 'Заявка на 2 ноября\nКартофель 25';
        assert.equal(strip(text, '23:07', '01.11', monday), (prefix + '\nКартофель 25').trim());
    }
    const text = 'ИП Каюмова\nКафе\nКартофель 25\nЗаявка на 2 ноября';
    assert.equal(strip(text, '23:07', '01.11', monday), text);
});

test('Каждая подходящая вводная строка очищается, оставшийся текст сохраняется', () => {
    assert.equal(strip('ИП Каюмова\nЗаявка на 2 ноября\nНа понедельник привезти к открытию\nКартофель 25',
        '23:07', '01.11', monday), 'ИП Каюмова\n\nпривезти к открытию\nКартофель 25');
});

test('Месяцы словами и сокращённо поддерживаются во всех 12 месяцах', () => {
    for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
        const now = new Date(2026, monthIndex, 15, 10);
        const { deliveryDate: target, start } = getDeliveryPeriod(now);
        const sourceDate = `${start.getDate()}.${start.getMonth() + 1}.${start.getFullYear()}`;
        const month = DELIVERY_RULES.months[target.getMonth()];
        for (const alias of [month.dateName, month.ruShort, month.ruShort + '.']) {
            const phrase = `Заявка на ${target.getDate()} ${alias}\nКартофель 25`;
            assert.equal(strip(phrase, '20:00', sourceDate, now), 'Картофель 25', phrase);
        }
    }
});

test('Месяц словами: регистр, неразрывные пробелы, год и совпадение дня', () => {
    // Обычные и неразрывные пробелы между числом и названием месяца.
    for (const phrase of ['Заявка на 02 НОЯБРЯ', 'на 2 ноября 2026:', 'на 2 ноября 26', 'на завтра 2 ноября', 'Заявка\u00a0на\u00a02\u00a0ноября']) {
        assert.equal(strip(phrase + '\nКартофель 25', '23:07', '01.11', monday), 'Картофель 25', phrase);
    }
    for (const phrase of ['на 3 ноября', 'на 2 декабря', 'на 2 ноября 2027', 'на 2 ноября 27', 'на 2 ноября 20260', 'на 31 ноября', 'на 2 ноябряков']) {
        const text = phrase + '\nКартофель 25';
        assert.equal(strip(text, '23:07', '01.11', monday), text, phrase);
    }
});

test('Вводные сроки не забирают числа товаров и названия организаций', () => {
    for (const text of ['ИП Каюмова\nКартофель 25\nЛук 10 кг', 'На 2 банки огурцов нужна накладная', '2 ноября привезли 25 кг картофеля', 'Добавьте на завтра картофель 25 кг']) {
        assert.equal(strip(text, '23:07', '01.11', monday), text);
    }
});

test('Переход месяца и года: числовая дата сверяется с годом поставки', () => {
    const now = new Date(2027, 0, 1, 10);
    assert.equal(strip('Заявка на 1.1.2027\nЛимоны 5шт', '20:00', '31.12', now), 'Лимоны 5шт');
    const text = 'Заявка на 1.1.2026\nЛимоны 5шт';
    assert.equal(strip(text, '20:00', '31.12', now), text);
});

test('Общие названия дней не меняют проверку «на завтра» для отбора', () => {
    for (let offset = 0; offset < 7; offset++) {
        const reference = new Date(2026, 10, 2 + offset);
        const target = new Date(reference); target.setDate(target.getDate() + 1);
        for (const alias of DELIVERY_RULES.weekdays[target.getDay()].aliases) {
            assert.equal(isForTomorrow(`Заказ на ${alias}`, reference), true);
        }
    }
});

test('Общий справочник сохраняет распознавание баннеров всех месяцев мессенджеров', () => {
    const RealDate = global.Date;
    try {
        for (let month = 0; month < 12; month++) {
            const instant = new RealDate(2026, month, 15, 10);
            global.Date = class extends RealDate {
                constructor(...args) { super(...(args.length ? args : [instant.getTime()])); }
                static now() { return instant.getTime(); }
            };
            const vocabulary = DELIVERY_RULES.months[month];
            for (const alias of [vocabulary.en, vocabulary.enShort, vocabulary.ruShort, vocabulary.dateName]) {
                assert.equal(getBannerDateCategory(`15 ${alias}`), 'today', alias);
                assert.equal(getBannerDateCategory(`14 ${alias}`), 'yesterday', alias);
            }
        }
    } finally { global.Date = RealDate; }
});

test('Годовая матрица: дни, граница 15:00, числовые/словесные сроки и сохранность заказа', () => {
    for (let offset = 0; offset < 365; offset++) {
        for (const [hour, minute] of [[0, 1], [10, 0], [14, 59], [15, 0], [16, 26], [17, 59], [18, 0], [23, 59]]) {
            const now = new Date(2026, 0, 1 + offset, hour, minute);
            const { deliveryDate: target, start } = getDeliveryPeriod(now);
            const sourceDate = `${start.getDate()}.${start.getMonth() + 1}.${start.getFullYear()}`;
            const dateName = DELIVERY_RULES.months[target.getMonth()].dateName;
            const terms = [
                `${target.getDate()}.${target.getMonth() + 1}.${target.getFullYear()}`,
                `${target.getDate()} ${dateName} ${target.getFullYear()}`,
                DELIVERY_RULES.weekdays[target.getDay()].aliases[1]
            ];
            for (const term of terms) {
                const text = `ИП Каюмова\nЗаявка на ${term}\nАвокадо 10 шт\nЛук репчатый 2 кг`;
                assert.equal(strip(text, '15:00', sourceDate, now),
                    'ИП Каюмова\n\nАвокадо 10 шт\nЛук репчатый 2 кг', `${now.toISOString()} ${term}`);
            }
            const other = new Date(target); other.setDate(other.getDate() + 1);
            const text = `ИП Каюмова\nЗаявка на ${other.getDate()}.${other.getMonth() + 1}.${other.getFullYear()}\nАвокадо 10 шт`;
            assert.equal(strip(text, '15:00', sourceDate, now), text);
        }
    }
});
