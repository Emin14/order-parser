/** Общие календарные данные для срока поставки и его отображения. */
export const DELIVERY_RULES = {
    boundaryHour: 15,
    collectionChangeHour: 18,
    introLineLimit: 3,
    nonWorkingDays: [0] as readonly number[],
    weekdays: [
        { short: 'вс', aliases: ['вс', 'воскресенье', 'воскресенья'] },
        { short: 'пн', aliases: ['пн', 'понедельник'] },
        { short: 'вт', aliases: ['вт', 'вторник'] },
        { short: 'ср', aliases: ['ср', 'среду'] },
        { short: 'чт', aliases: ['чт', 'четверг'] },
        { short: 'пт', aliases: ['пт', 'пятницу'] },
        { short: 'сб', aliases: ['сб', 'субботу'] }
    ],
    months: [
        { en: 'january', enShort: 'jan', ru: 'январ', ruShort: 'янв', dateName: 'января' },
        { en: 'february', enShort: 'feb', ru: 'феврал', ruShort: 'фев', dateName: 'февраля' },
        { en: 'march', enShort: 'mar', ru: 'март', ruShort: 'мар', dateName: 'марта' },
        { en: 'april', enShort: 'apr', ru: 'апрел', ruShort: 'апр', dateName: 'апреля' },
        { en: 'may', enShort: 'may', ru: 'май', ruShort: 'май', dateName: 'мая' },
        { en: 'june', enShort: 'jun', ru: 'июн', ruShort: 'июн', dateName: 'июня' },
        { en: 'july', enShort: 'jul', ru: 'июл', ruShort: 'июл', dateName: 'июля' },
        { en: 'august', enShort: 'aug', ru: 'август', ruShort: 'авг', dateName: 'августа' },
        { en: 'september', enShort: 'sep', ru: 'сентябр', ruShort: 'сен', dateName: 'сентября' },
        { en: 'october', enShort: 'oct', ru: 'октябр', ruShort: 'окт', dateName: 'октября' },
        { en: 'november', enShort: 'nov', ru: 'ноябр', ruShort: 'ноя', dateName: 'ноября' },
        { en: 'december', enShort: 'dec', ru: 'декабр', ruShort: 'дек', dateName: 'декабря' }
    ]
} as const;

function nextWorkingDate(date: Date): Date {
    const result = new Date(date);
    while (DELIVERY_RULES.nonWorkingDays.includes(result.getDay())) result.setDate(result.getDate() + 1);
    return result;
}

/** Окно срока заказа для очистки: предыдущий рабочий день 15:00 — поставка 15:00. */
export function getDeliveryPeriod(now: Date) {
    let deliveryDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // Дата поставки определяется режимом запуска, а не часом окончания
    // приёма сообщений: между 15:00 и 18:00 ещё обрабатывается дневной сбор.
    if (now.getHours() >= DELIVERY_RULES.collectionChangeHour) deliveryDate.setDate(deliveryDate.getDate() + 1);
    deliveryDate = nextWorkingDate(deliveryDate);
    const end = new Date(deliveryDate);
    end.setHours(DELIVERY_RULES.boundaryHour);
    const start = new Date(deliveryDate);
    do { start.setDate(start.getDate() - 1); }
    while (DELIVERY_RULES.nonWorkingDays.includes(start.getDay()));
    start.setHours(DELIVERY_RULES.boundaryHour);
    return { deliveryDate, start, end };
}

function messageDateTime(date: string | undefined, time: string, now: Date): Date | undefined {
    const clock = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!clock || Number(clock[1]) > 23 || Number(clock[2]) > 59) return undefined;
    const result = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (date) {
        const parts = date.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/);
        if (!parts) return undefined;
        const day = Number(parts[1]);
        const month = Number(parts[2]) - 1;
        result.setFullYear(parts[3] ? Number(parts[3]) : now.getFullYear(), month, day);
        if (!parts[3] && result > now) result.setFullYear(result.getFullYear() - 1);
        if (result.getDate() !== day || result.getMonth() !== month) return undefined;
    }
    result.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
    return result;
}

const weekdayNames = DELIVERY_RULES.weekdays.flatMap(day => day.aliases).sort((a, b) => b.length - a.length).join('|');
const monthAliases = DELIVERY_RULES.months.flatMap((month, index) => [month.dateName, month.ruShort]
    .map(alias => ({ alias, month: index + 1 })));
const monthNames = monthAliases.map(item => item.alias).sort((a, b) => b.length - a.length).join('|');
const termBoundary = '(?![\\p{L}\\p{N}]|\\.\\d)';
const horizontalSpace = '[^\\S\\r\\n]';
const explicitDate = new RegExp(`^(?:(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{4}|\\d{2}))?|(\\d{1,2})${horizontalSpace}+(${monthNames})(?:${horizontalSpace}+(\\d{4}|\\d{2}))?)${termBoundary}`, 'iu');
const weekdayTerm = new RegExp(`^(${weekdayNames})${termBoundary}`, 'iu');
const tomorrowTerm = new RegExp(`^завтра${termBoundary}`, 'iu');
// «Овощи» здесь — необязательное уточнение заявки перед сроком.
// Вводная часть удаляется только вместе с подтверждённым сроком поставки.
const intro = new RegExp(`^${horizontalSpace}*(?:(?:заказы?|заявка|закупка)${horizontalSpace}+)?на${horizontalSpace}+(?:овощи${horizontalSpace}+)?`, 'iu');

/** Сопоставляет срок и возвращает длину только подтверждённого совпадения. */
function matchingTermLength(text: string, target: Date, messageAt: Date): number {
    const tomorrow = text.match(tomorrowTerm);
    let offset = 0;
    if (tomorrow) {
        const next = new Date(messageAt.getFullYear(), messageAt.getMonth(), messageAt.getDate() + 1);
        if (nextWorkingDate(next).getTime() !== target.getTime()) return 0;
        offset = tomorrow[0].length;
        const spaces = text.slice(offset).match(/^[^\S\r\n]+/);
        if (spaces) offset += spaces[0].length;
    }
    const date = text.slice(offset).match(explicitDate);
    if (date) {
        const [, numericDay, numericMonth, numericYear, wordDay, monthName, wordYear] = date;
        const month = numericMonth ? Number(numericMonth)
            : monthAliases.find(item => item.alias === monthName.toLocaleLowerCase('ru-RU'))!.month;
        const year = numericYear || wordYear;
        // Не отрезаем название месяца отдельно от некорректного года.
        if (wordDay && !year && /^[^\S\r\n]+\d/u.test(text.slice(offset + date[0].length))) return 0;
        if (Number(numericDay || wordDay) !== target.getDate() || month !== target.getMonth() + 1) return 0;
        if (year && Number(year.length === 2 ? `20${year}` : year) !== target.getFullYear()) return 0;
        return offset + date[0].length;
    }
    if (tomorrow) {
        // Не удаляем только «завтра», оставляя нераспознанную числовую дату.
        return /^\d/u.test(text.slice(offset)) ? 0 : offset;
    }
    const weekday = text.match(weekdayTerm);
    return weekday && DELIVERY_RULES.weekdays[target.getDay()].aliases.some(alias => alias === weekday[1].toLocaleLowerCase('ru-RU'))
        ? weekday[0].length : 0;
}

/** Удаляет вводный срок в первых трёх непустых строках, если он совпадает с поставкой. */
export function stripDeliveryPhrase(text: string, time: string | undefined, date: string | undefined, now = new Date()): string {
    if (!time) return text;
    const messageAt = messageDateTime(date, time, now);
    if (!messageAt) return text;
    const period = getDeliveryPeriod(now);
    if (messageAt < period.start || messageAt >= period.end) return text;
    let checkedLines = 0;
    return text.split('\n').map(line => {
        if (!line.trim()) return line;
        if (++checkedLines > DELIVERY_RULES.introLineLimit) return line;
        const prefix = line.match(intro);
        if (!prefix) return line;
        const termLength = matchingTermLength(line.slice(prefix[0].length), period.deliveryDate, messageAt);
        if (!termLength) return line;
        return line.slice(prefix[0].length + termLength).replace(/^(?:[^\S\r\n]|[:.,;])+/u, '').trim();
    }).join('\n').trim();
}
