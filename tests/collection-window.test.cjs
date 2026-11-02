const { test } = require('node:test');
const assert = require('node:assert/strict');
require('tsx/cjs');
const { isMessageInCollection } = require('../src/utils/collection.ts');

function accepts(now, category, time) {
    return isMessageInCollection(category, time, 'Лайм 1кг', () => false, now);
}

test('Фобо Аркада: понедельник 17:20 принимает сегодняшний заказ 16:41', () => {
    assert.equal(accepts(new Date(2026, 10, 2, 17, 20), 'today', '16:41'), true);
});

test('Каждый день года: дневной сбор не обрезает сегодняшние сообщения в 15:00', () => {
    for (let offset = 0; offset < 365; offset++) {
        for (const [hour, minute] of [[15, 0], [16, 41], [17, 59]]) {
            const now = new Date(2026, 0, 1 + offset, hour, minute);
            for (const time of ['00:00', '14:59', '15:00', `${hour}:${String(minute).padStart(2, '0')}`]) {
                assert.equal(accepts(now, 'today', time), true, `${now}: ${time}`);
            }
        }
    }
});

test('Вчера и суббота в понедельник: прежние правила сохраняются', () => {
    const monday = new Date(2026, 10, 2, 17, 20);
    assert.equal(accepts(monday, 'yesterday', '08:00'), true);
    assert.equal(accepts(monday, 'dayBeforeYesterday', '11:00'), true);
    assert.equal(accepts(monday, 'dayBeforeYesterday', '08:00'), false);
    const tuesday = new Date(2026, 10, 3, 17, 20);
    assert.equal(accepts(tuesday, 'yesterday', '11:00'), true);
    assert.equal(accepts(tuesday, 'yesterday', '08:00'), false);
    assert.equal(accepts(tuesday, 'dayBeforeYesterday', '20:00'), false);
    assert.equal(accepts(tuesday, 'older', '20:00'), false);
});

test('Границы 06:00 и 18:00, ночь и воскресный вечер не меняются', () => {
    const beforeSix = new Date(2026, 10, 3, 5, 59);
    assert.equal(accepts(beforeSix, 'today', '06:00'), false);
    assert.equal(accepts(beforeSix, 'today', '05:00'), true);
    assert.equal(accepts(new Date(2026, 10, 3, 6), 'today', '06:00'), true);
    const evening = new Date(2026, 10, 2, 18);
    assert.equal(accepts(evening, 'today', '16:41'), true);
    assert.equal(accepts(evening, 'today', '08:00'), false);
    assert.equal(accepts(evening, 'yesterday', '20:00'), false);
    const sunday = new Date(2026, 10, 1, 18);
    assert.equal(accepts(sunday, 'today', '08:00'), true);
    assert.equal(accepts(sunday, 'yesterday', '20:00'), true);
});
