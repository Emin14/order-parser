const { test } = require('node:test');
const assert = require('node:assert/strict');
require('tsx/cjs');
const { mergeTelegramHistory: merge } = require('../src/utils/telegram_history.ts');
const message = (messageId, text, sender = 'Асиман', time = '22:59') =>
    ({ type: 'message', messageId, text, sender, time });
const banner = text => ({ type: 'banner', text });

test('Два одинаковых «Мад» не переставляют «Листья лайма» в начало', () => {
    const mad1 = message('113971', 'Мад');
    const leaves = message('113972', 'Листья лайма 1\nЛук зелёный 300 грм', '弗拉基米尔');
    const mad2 = message('113973', 'Мад');
    const potatoes = message('113974', 'Кортофель 15 килограмм', '弗拉基米尔');
    const earlier = message('113970', 'Мещерякова Марина');
    const history = [];
    merge(history, [banner('November 1'), mad2, potatoes]);
    merge(history, [banner('November 1'), earlier, mad1, leaves, mad2, potatoes]);
    assert.deepEqual(history, [banner('November 1'), earlier, mad1, leaves, mad2, potatoes]);
});

test('Два «Мад» без ID: новые ранние заказы вставляются перед правильным совпадением', () => {
    const mad1 = message(undefined, 'Мад');
    const leaves = message(undefined, 'Листья лайма 1\nЛук зелёный 300 грм', '弗拉基米尔');
    const mad2 = message(undefined, 'Мад');
    const potatoes = message(undefined, 'Кортофель 15 килограмм', '弗拉基米尔');
    const earlier = message(undefined, 'Мещерякова Марина');
    const full = [banner('November 1'), earlier, mad1, leaves, mad2, potatoes];
    const history = [];
    merge(history, [banner('November 1'), mad2, potatoes]);
    merge(history, full);
    merge(history, full);
    assert.deepEqual(history, full);
    assert.equal(history.filter(item => item.text === 'Мад').length, 2);
});

test('Совпадение первых 30 символов без ID не удаляет разные заказы', () => {
    const prefix = 'Одинаковая начальная строка заказа: ';
    const full = [message(undefined, prefix + '1 кг'), message(undefined, prefix + '2 кг')];
    const history = [];
    merge(history, full);
    merge(history, full);
    assert.deepEqual(history, full);
});

test('Несколько одинаковых подряд сообщений без ID сохраняют количество', () => {
    const full = [message(undefined, 'Да'), message(undefined, 'Да'), message(undefined, 'Да')];
    const history = [];
    merge(history, full);
    merge(history, full);
    assert.deepEqual(history, full);
});

test('Снимок без перекрытия добавляется перед ранее собранной новой частью', () => {
    const older = message(undefined, 'Ранний', 'Автор', '20:00');
    const newer = message(undefined, 'Поздний', 'Автор', '21:00');
    const history = [newer];
    merge(history, [older]);
    assert.deepEqual(history, [older, newer]);
});

test('Один ID не дублируется при изменении отображаемого времени или отправителя', () => {
    const first = message('10', 'Заказ', '', '22:58');
    const history = [];
    merge(history, [first]);
    merge(history, [message('10', 'Заказ', 'Асиман', '22:59')]);
    assert.deepEqual(history, [first]);
});

test('Разные ID с одинаковым текстом, временем и автором сохраняются', () => {
    const snapshot = [message('1', 'Мад'), message('2', 'Мад')];
    const history = [];
    merge(history, snapshot);
    merge(history, snapshot);
    assert.deepEqual(history, snapshot);
});

test('Без ID остаётся прежнее сопоставление при перекрывающейся прокрутке', () => {
    const old = message(undefined, 'Ранний заказ');
    const next = message(undefined, 'Поздний заказ');
    const history = [];
    merge(history, [banner('Today'), next]);
    merge(history, [banner('Today'), old, next]);
    merge(history, [banner('Today'), old, next]);
    assert.deepEqual(history, [banner('Today'), old, next]);
});

test('Сообщения с ID и без ID совместимы в одном снимке', () => {
    const snapshot = [banner('Today'), message('1', 'Один'), message(undefined, 'Два'), message('3', 'Три')];
    const history = [];
    merge(history, snapshot);
    merge(history, snapshot);
    assert.deepEqual(history, snapshot);
});

test('Разделители разных дней и сообщения вокруг них сохраняют порядок', () => {
    const older = message('1', 'Ранний');
    const newer = message('2', 'Поздний');
    const history = [];
    merge(history, [banner('Today'), newer]);
    merge(history, [banner('Yesterday'), older, banner('Today'), newer]);
    assert.deepEqual(history, [banner('Yesterday'), older, banner('Today'), newer]);
});
