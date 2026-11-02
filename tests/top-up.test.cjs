const { test } = require('node:test');
const assert = require('node:assert/strict');
require('tsx/cjs');
const { getTopUpStart, isMessageInTopUp } = require('../src/utils/top_up.ts');

test('00:00 означает сегодняшнюю полночь, а не часы любого подходящего дня', () => {
    const now = new Date(2026, 10, 2, 16, 26);
    const start = getTopUpStart('00:00', now);
    assert.equal(start.getTime(), new Date(2026, 10, 2).getTime());
    for (const time of ['00:00', '10:00', '16:00']) {
        assert.equal(isMessageInTopUp({ date: '02.11', time }, start, now), true);
        assert.equal(isMessageInTopUp({ date: '01.11', time }, start, now), false);
        assert.equal(isMessageInTopUp({ date: '31.10', time }, start, now), false);
    }
});

test('Прошедшее сегодня время не включает вчерашние сообщения с таким же часом', () => {
    const now = new Date(2026, 10, 2, 16);
    const start = getTopUpStart('10:00', now);
    assert.equal(isMessageInTopUp({ date: '02.11', time: '09:59' }, start, now), false);
    assert.equal(isMessageInTopUp({ date: '02.11', time: '10:00' }, start, now), true);
    assert.equal(isMessageInTopUp({ date: '01.11', time: '12:00' }, start, now), false);
});

test('23:00 при утреннем запуске по-прежнему означает вчера с 23:00', () => {
    const now = new Date(2026, 10, 2, 10);
    const start = getTopUpStart('23:00', now);
    assert.equal(start.getTime(), new Date(2026, 10, 1, 23).getTime());
    assert.equal(isMessageInTopUp({ date: '01.11', time: '22:59' }, start, now), false);
    assert.equal(isMessageInTopUp({ date: '01.11', time: '23:00' }, start, now), true);
    assert.equal(isMessageInTopUp({ date: '02.11', time: '09:59' }, start, now), true);
    assert.equal(isMessageInTopUp({ date: '31.10', time: '23:30' }, start, now), false);
});

test('Полночь и переход месяца/года не смешивают календарные дни', () => {
    for (const now of [new Date(2026, 10, 1, 0, 5), new Date(2027, 0, 1, 0, 5)]) {
        const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayLabel = `${yesterday.getDate()}.${yesterday.getMonth() + 1}`;
        assert.equal(isMessageInTopUp({ date: yesterdayLabel, time: '23:59' }, getTopUpStart('00:00', now), now), false);
        assert.equal(isMessageInTopUp({ date: yesterdayLabel, time: '23:59' }, getTopUpStart('23:00', now), now), true);
    }
    const now = new Date(2027, 0, 1, 0, 5);
    assert.equal(isMessageInTopUp({ date: '01.01.2026', time: '00:01' }, getTopUpStart('00:00', now), now), false);
});

test('Известная дата приоритетнее предположения по часам; будущее не включается', () => {
    const now = new Date(2026, 10, 2, 16);
    const start = getTopUpStart('00:00', now);
    assert.equal(isMessageInTopUp({ date: '02.11', time: '20:00' }, start, now), false);
    assert.equal(isMessageInTopUp({ date: '03.11.2026', time: '10:00' }, start, now), false);
});

test('Без FROM_TIME дополнительной фильтрации нет', () => {
    const now = new Date(2026, 10, 2, 16);
    for (const from of [undefined, '']) {
        const start = getTopUpStart(from, now);
        assert.equal(start, undefined);
        assert.equal(isMessageInTopUp({ date: '31.10', time: '11:00' }, start, now), true);
        assert.equal(isMessageInTopUp({}, start, now), true);
    }
});

test('Данные без даты используют прежнее предположение; без времени старые дни исключаются', () => {
    const now = new Date(2026, 10, 2, 16);
    const start = getTopUpStart('00:00', now);
    assert.equal(isMessageInTopUp({ time: '10:00' }, start, now), true);
    assert.equal(isMessageInTopUp({ time: '20:00' }, start, now), false);
    assert.equal(isMessageInTopUp({ date: '01.11', time: '' }, start, now), false);
    assert.equal(isMessageInTopUp({ date: '02.11', time: '' }, start, now), true);
});

test('Некорректное время добора даёт понятную ошибку', () => {
    for (const from of ['24:00', '12:60', 'неизвестно', '00:00:00']) {
        assert.throws(() => getTopUpStart(from), /Некорректное время добора/);
    }
});

test('Матрица года: вчерашнее утро не проходит FROM_TIME=00:00 ни в один день', () => {
    for (let offset = 0; offset < 365; offset++) {
        const now = new Date(2026, 0, 1 + offset, 16);
        const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
        const start = getTopUpStart('00:00', now);
        assert.equal(isMessageInTopUp({ date: `${yesterday.getDate()}.${yesterday.getMonth() + 1}`, time: '10:00' }, start, now), false);
        assert.equal(isMessageInTopUp({ date: `${now.getDate()}.${now.getMonth() + 1}`, time: '10:00' }, start, now), true);
    }
});
