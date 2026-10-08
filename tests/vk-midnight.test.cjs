const { test } = require('node:test');
const assert = require('node:assert/strict');
require('tsx/cjs');
const { parseVkDate, isMessageActual } = require('../src/utils/date.ts');

function at(year, month, day, hour, minute, fn) {
    const RealDate = global.Date;
    const instant = new RealDate(year, month - 1, day, hour, minute);
    global.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [instant.getTime()])); }
        static now() { return instant.getTime(); }
    };
    try { fn(); } finally { global.Date = RealDate; }
}

test('VK: вечерние чаты остаются актуальными после полуночи (лог 09.10.2026)', () => {
    at(2026, 10, 9, 0, 29, () => {
        for (const label of ['· 34м', '· 1ч', '· 2ч', '· 4ч', '· 9ч']) {
            const result = parseVkDate(label);
            assert.equal(result.isActual, true, label);
            assert.match(result.reason, /вчера/i);
        }
        assert.equal(parseVkDate('· 10м').isActual, true);
        assert.equal(parseVkDate('· 1д').isActual, false);
        assert.equal(isMessageActual('yesterday', '22:02', 'Заказ'), true);
    });
});

test('VK: вечерняя граница и старые дни не расширяются', () => {
    at(2026, 10, 9, 20, 0, () => {
        assert.equal(parseVkDate('· 2ч').isActual, true);
        assert.equal(parseVkDate('· 23ч').isActual, false);
    });
    at(2026, 10, 9, 12, 0, () => {
        assert.equal(parseVkDate('· 20ч').isActual, true);
        assert.equal(parseVkDate('· 3д').isActual, false);
    });
});
