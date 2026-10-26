export interface CheckOrderResult {
    isActual: boolean;
    dateStr: string;
    reason: string;
}

import { getCollectionContext, isMessageInCollection, type MessageCategory, type ShiftMode } from './collection';
export type { ShiftMode } from './collection';

const DAYS_EN = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAYS_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const MONTHS = [
    { en: 'january', enShort: 'jan', ru: 'январ', ruShort: 'янв' },
    { en: 'february', enShort: 'feb', ru: 'феврал', ruShort: 'фев' },
    { en: 'march', enShort: 'mar', ru: 'март', ruShort: 'мар' },
    { en: 'april', enShort: 'apr', ru: 'апрел', ruShort: 'апр' },
    { en: 'may', enShort: 'may', ru: 'май', ruShort: 'май' },
    { en: 'june', enShort: 'jun', ru: 'июн', ruShort: 'июн' },
    { en: 'july', enShort: 'jul', ru: 'июл', ruShort: 'июл' },
    { en: 'august', enShort: 'aug', ru: 'август', ruShort: 'авг' },
    { en: 'september', enShort: 'sep', ru: 'сентябр', ruShort: 'сен' },
    { en: 'october', enShort: 'oct', ru: 'октябр', ruShort: 'окт' },
    { en: 'november', enShort: 'nov', ru: 'ноябр', ruShort: 'ноя' },
    { en: 'december', enShort: 'dec', ru: 'декабр', ruShort: 'дек' },
] as const;
const MONTH_TOKENS = MONTHS.flatMap(month => [month.en, month.enShort, month.ru, month.ruShort]).join('|');

/**
 * Определение текущего режима сбора
 */
export function getShiftMode(now: Date = new Date()): { mode: ShiftMode; baseDate: Date } {
    const collection = getCollectionContext(now);
    return { mode: collection.mode, baseDate: collection.shiftStart };
}

/** Возвращает календарную дату категории в формате DD.MM для диагностики и экспорта. */
export function getCategoryDate(category: MessageCategory, now: Date = new Date()): string | undefined {
    if (category === 'older') return undefined;
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (category === 'yesterday') date.setDate(date.getDate() - 1);
    if (category === 'dayBeforeYesterday') date.setDate(date.getDate() - 2);
    return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Проверка, является ли утреннее сообщение заказом на завтра
 */
export function isForTomorrow(text: string, referenceDate: Date): boolean {
    const clean = (text || '').toLowerCase();

    // 1. Прямая проверка фраз со словом "на завтра"
    if (clean.includes('на завтра') || clean.includes('заказ на завтра') || clean.includes('заказы на завтра')) {
        return true;
    }

    // 2. Проверка завтрашнего дня недели (например, в пятницу утром пишут "на субботу")
    const tomorrow = new Date(referenceDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDay = tomorrow.getDay(); // 0 = вс, 1 = пн, ..., 6 = сб

    const dayPatterns: Record<number, RegExp> = {
        0: /(?:^|[^а-яa-z0-9])на\s+(вс|воскресенье|воскресенья)(?:[^а-яa-z0-9]|$)/i,
        1: /(?:^|[^а-яa-z0-9])на\s+(пн|понедельник)(?:[^а-яa-z0-9]|$)/i,
        2: /(?:^|[^а-яa-z0-9])на\s+(вт|вторник)(?:[^а-яa-z0-9]|$)/i,
        3: /(?:^|[^а-яa-z0-9])на\s+(ср|среду)(?:[^а-яa-z0-9]|$)/i,
        4: /(?:^|[^а-яa-z0-9])на\s+(чт|четверг)(?:[^а-яa-z0-9]|$)/i,
        5: /(?:^|[^а-яa-z0-9])на\s+(пт|пятницу)(?:[^а-яa-z0-9]|$)/i,
        6: /(?:^|[^а-яa-z0-9])на\s+(сб|субботу)(?:[^а-яa-z0-9]|$)/i,
    };

    const targetRegex = dayPatterns[tomorrowDay];
    if (targetRegex && targetRegex.test(clean)) {
        return true;
    }

    return false;
}

/**
 * Разбор текстовых дат ВКонтакте (например: "сегодня в 00:01", "вчера в 23:40", "14 минут назад", "21 сентября в 21:53")
 */
export function parseVkDate(dateRaw: string): CheckOrderResult {
    // В новом интерфейсе VK даты в списке чатов имеют вид «· 8м», «· 5ч», «· 3д».
    // Убираем декоративную точку и считаем относительное время от текущего момента.
    const text = (dateRaw || '').replace(/^\s*[·•]\s*/, '').trim().toLowerCase();
    const now = new Date();
    const { mode } = getShiftMode(now);
    const dayOfWeek = now.getDay(); // 0 = вс, 1 = пн

    // VK сокращает относительные даты в списке чатов: «8м», «5ч», «3д».
    const relativeShort = text.match(/^(\d+)\s*([мчд])$/i);
    if (relativeShort) {
        const amount = Number(relativeShort[1]);
        const unit = relativeShort[2].toLowerCase();
        const elapsedMinutes = unit === 'м' ? amount : unit === 'ч' ? amount * 60 : amount * 24 * 60;
        const messageAt = new Date(now.getTime() - elapsedMinutes * 60 * 1000);
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const time = `${String(messageAt.getHours()).padStart(2, '0')}:${String(messageAt.getMinutes()).padStart(2, '0')}`;
        // Используем те же правила смены, что и для полных дат VK.
        // В частности, после полуночи вчерашний вечер всё ещё входит в смену.
        const dayLabel = messageAt.toDateString() === now.toDateString() ? 'сегодня'
            : messageAt.toDateString() === yesterday.toDateString() ? 'вчера' : null;
        if (dayLabel) {
            const result = parseVkDate(`${dayLabel} в ${time}`);
            return { ...result, dateStr: text, reason: `Относительная дата VK (${text}): ${result.reason}` };
        }
        return { isActual: false, dateStr: text, reason: `Относительная дата VK (${text}), вне текущей смены` };
    }

    // 0. "11:38" (сегодняшнее время)
    if (/^\d{1,2}:\d{2}$/.test(text)) {
        return checkOrderDate(text);
    }

    // 1. "14 минут назад", "только что"
    if (text.includes('минут') || text.includes('только что') || text.includes('секунд')) {
        return { isActual: true, dateStr: text, reason: "Только что / минуты назад (сегодня)" };
    }

    // 2. "час назад", "2 часа назад", "11 часов назад"
    if (text.includes('час')) {
        return { isActual: true, dateStr: text, reason: "Несколько часов назад (сегодня)" };
    }

    // 3. "сегодня в 00:01", "сегодня"
    if (text.includes('сегодня')) {
        const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch) {
            const h = parseInt(timeMatch[1], 10);
            if (mode === 'EVENING_NIGHT' && now.getHours() >= 18) {
                if (h >= 6) {
                    return { isActual: true, dateStr: text, reason: `Сегодня в ${timeMatch[0]} (после 06:00)` };
                } else {
                    return { isActual: false, dateStr: text, reason: `Сегодня до 06:00 (${timeMatch[0]})` };
                }
            } else {
                return { isActual: true, dateStr: text, reason: `Сегодня в ${timeMatch[0]} (входит в рабочий интервал)` };
            }
        }
        return { isActual: true, dateStr: text, reason: "Сегодняшний чат" };
    }

    // 4. "вчера в 23:40", "вчера в 13:25"
    if (text.includes('вчера')) {
        const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
        const timeStr = timeMatch ? timeMatch[0] : '';
        
        if (mode === 'EVENING_NIGHT' && now.getHours() >= 18) {
            // Вечерний сбор
            // В воскресенье мы собираем субботу с 11:00!
            if (dayOfWeek === 0) {
                if (timeMatch) {
                    const h = parseInt(timeMatch[1], 10);
                    if (h >= 13) {
                        return { isActual: true, dateStr: text, reason: `Вчера (суббота) с 11:00` };
                    }
                }
            }
            return { isActual: false, dateStr: text, reason: "Вчерашний чат (вечерний сбор только за сегодня)" };
        } else {
            // Дневной сбор
            if (timeMatch) {
                const h = parseInt(timeMatch[1], 10);
                
                // Если сегодня понедельник, то вчера (воскресенье) мы берем ЦЕЛИКОМ (h >= 0).
                if (dayOfWeek === 1) {
                    return { isActual: true, dateStr: text, reason: `Вчера в ${timeStr} (воскресенье)` };
                }
                
                // Если сегодня воскресенье, то вчера (суббота) берем с 11:00
                if (dayOfWeek === 0) {
                    if (h >= 13) {
                        return { isActual: true, dateStr: text, reason: `Вчера (суббота) с 11:00` };
                    } else {
                        return { isActual: false, dateStr: text, reason: `Вчера до 11:00 (${timeStr})` };
                    }
                }
                
                // Обычный день: вчера берем с 06:00
                if (h >= 6) {
                    return { isActual: true, dateStr: text, reason: `Вчера в ${timeStr} (входит в рабочий интервал)` };
                } else {
                    return { isActual: false, dateStr: text, reason: `Вчера до 06:00 утра (${timeStr})` };
                }
            }
            return { isActual: true, dateStr: text, reason: "Вчерашний чат" };
        }
    }

    // 5. Конкретная дата (например "21 сентября в 21:53")
    const category = getBannerDateCategory(text);
    if (category === 'today') {
        return { isActual: true, dateStr: text, reason: `Календарная дата (сегодня)` };
    }
    if (category === 'yesterday') {
        // Если дневной сбор или ночной сбор (до 06:00)
        if (mode === 'DAY' || now.getHours() < 6) {
            return { isActual: true, dateStr: text, reason: `Календарная дата (вчера)` };
        }
        // В воскресенье берем субботу (вчера) с 11:00!
        if (dayOfWeek === 0) {
            const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
            if (timeMatch && parseInt(timeMatch[1], 10) >= 11) {
                 return { isActual: true, dateStr: text, reason: `Календарная дата (суббота с 11:00)` };
            }
        }
    }
    if (category === 'dayBeforeYesterday') {
        // Если сегодня понедельник (до 18:00), то позавчера (суббота) берется с 11:00
        if (dayOfWeek === 1 && mode === 'DAY') {
            const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
            if (!timeMatch) {
                return { isActual: true, dateStr: text, reason: `Календарная дата (суббота, время проверит общий фильтр)` };
            }
            if (timeMatch && parseInt(timeMatch[1], 10) >= 11) {
                 return { isActual: true, dateStr: text, reason: `Календарная дата (позавчера суббота с 11:00)` };
            }
        }
    }

    return { isActual: false, dateStr: text, reason: `Старая дата (${text})` };
}

/**
 * Проверка чата в боковой панели WhatsApp и Telegram
 */
export function checkOrderDate(chatText: string): CheckOrderResult {
    const lines = chatText.split('\n');
    let dateStr = "Не найдено";
    
    // Если передана одна строка (например, время) - проверяем сразу с нулевого индекса
    const startIndex = lines.length === 1 ? 0 : 1;
    for (let i = startIndex; i < Math.min(lines.length, 5); i++) {
        const line = lines[i].trim();
        const lineLower = line.toLowerCase();
        
        if (/^\d{2}:\d{2}$/.test(line)) {
            dateStr = line;
            break;
        }
        if (lineLower === 'вчера' || lineLower === 'yesterday') {
            dateStr = line;
            break;
        }
        if (/^(mon|tue|wed|thu|fri|sat|sun|пн|вт|ср|чт|пт|сб|вс|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)/i.test(line)) {
            dateStr = line;
            break;
        }
        if (new RegExp(`^(?:${MONTH_TOKENS}|\\d{1,2}\\s+(?:${MONTH_TOKENS})|\\d{2}\\.\\d{2})`, 'i').test(line)) {
            dateStr = line;
            break;
        }
    }
    
    if (dateStr === "Не найдено") {
        return { isActual: false, dateStr, reason: "Не смог найти дату в тексте" };
    }

    const now = new Date();
    const { mode } = getShiftMode(now);
    const dl = dateStr.toLowerCase();

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yDayIdx = yesterday.getDay();
    const yDayEn = DAYS_EN[yDayIdx];
    const yDayRu = DAYS_RU[yDayIdx];

    // 1. Время HH:MM (сегодняшние чаты)
    if (/^\d{2}:\d{2}$/.test(dateStr)) {
        const [h] = dateStr.split(':').map(Number);
        if (mode === 'EVENING_NIGHT') {
            if (now.getHours() >= 18) {
                if (h >= 6) {
                    return { isActual: true, dateStr, reason: "Сегодняшний чат (после 06:00)" };
                } else {
                    return { isActual: false, dateStr, reason: "Сегодняшний чат до 06:00" };
                }
            } else {
                return { isActual: true, dateStr, reason: "Свежий ночной чат" };
            }
        } else {
            return { isActual: true, dateStr, reason: "Сегодняшний дневной чат" };
        }
    }

    const dayOfWeek = now.getDay();

    // 2. Вчера / Yesterday (WhatsApp)
    if (dl === 'вчера' || dl === 'yesterday') {
        if (mode === 'EVENING_NIGHT' && now.getHours() >= 18) {
            // В воскресенье мы разрешаем субботу (вчера) всегда
            if (dayOfWeek === 0) {
                return { isActual: true, dateStr, reason: "Вчерашний чат (суббота, воскресный сбор)" };
            }
            return { isActual: false, dateStr, reason: "Вчерашний чат (вечерний сбор только за сегодня)" };
        } else {
            return { isActual: true, dateStr, reason: "Вчерашний чат (входит в рабочий интервал)" };
        }
    }

    // 3. День недели (в Telegram вчера пишется днем недели)
    const isDayOfWeek = /^(mon|tue|wed|thu|fri|sat|sun|пн|вт|ср|чт|пт|сб|вс)/i.test(dl);
    if (isDayOfWeek) {
        const matchesYesterday = dl.startsWith(yDayEn) || dl.startsWith(yDayRu);
        
        // В понедельник дневной сбор: разрешаем и субботу (позавчера)
        const isMondayAndSaturday = dayOfWeek === 1 && (mode === 'DAY' || mode === 'EVENING_NIGHT') && (dl.startsWith('sat') || dl.startsWith('сб') || dl.startsWith('суббота'));

        if (matchesYesterday || isMondayAndSaturday) {
            if (mode === 'EVENING_NIGHT' && now.getHours() >= 18) {
                // В воскресенье (вечер) разрешаем вчера (субботу)
                if (dayOfWeek === 0) {
                    return { isActual: true, dateStr, reason: `Вчерашний день (${dateStr}), воскресный сбор` };
                }
                return { isActual: false, dateStr, reason: `Вчерашний день (${dateStr}), вечерний сбор только за сегодня` };
            } else {
                return { isActual: true, dateStr, reason: `Вчерашний или позавчерашний день (${dateStr}), входит в интервал` };
            }
        } else {
            return { isActual: false, dateStr, reason: `Старый день недели (${dateStr})` };
        }
    }

    // Полные даты в списке Telegram: «October 25», «25 октября».
    // Используем тот же разбор календарных дат, что и для баннеров внутри чата.
    const calendarCategory = getBannerDateCategory(dateStr);
    if (calendarCategory === 'today') {
        return { isActual: true, dateStr, reason: `Календарная дата сегодня (${dateStr})` };
    }
    if (calendarCategory === 'yesterday') {
        return { isActual: true, dateStr, reason: `Календарная дата вчера (${dateStr})` };
    }
    if (calendarCategory === 'dayBeforeYesterday' && dayOfWeek === 1) {
        return { isActual: true, dateStr, reason: `Календарная дата субботы в понедельник (${dateStr})` };
    }

    // 4. Старые даты
    return { isActual: false, dateStr, reason: `Старая дата (${dateStr})` };
}

/**
 * Определение категории плашки даты (Today / Yesterday / DayBeforeYesterday / Older)
 */
export function getBannerDateCategory(bannerText: string): 'today' | 'yesterday' | 'dayBeforeYesterday' | 'older' {
    const clean = (bannerText || '').trim().toLowerCase();
    if (!clean) return 'today';

    if (clean.includes('today') || clean.includes('сегодня')) {
        return 'today';
    }
    if (clean.includes('yesterday') || clean.includes('вчера')) {
        return 'yesterday';
    }

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const dayBeforeYesterday = new Date(now);
    dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);

    const matchesCalendarDate = (targetDate: Date) => {
        const day = targetDate.getDate();
        const monthIdx = targetDate.getMonth();
        const month = MONTHS[monthIdx];

        const dayRegex = new RegExp(`(?:^|\\D)0?${day}(?:\\D|$)`);
        if (!dayRegex.test(clean)) return false;

        if (clean.includes(month.en) || clean.includes(month.enShort) || clean.includes(month.ru) || clean.includes(month.ruShort)) return true;
        const padMonth = String(monthIdx + 1).padStart(2, '0');
        if (clean.includes(`${day}.${padMonth}`) || clean.includes(`0${day}.${padMonth}`)) return true;

        return false;
    };

    if (matchesCalendarDate(now)) return 'today';
    if (matchesCalendarDate(yesterday)) return 'yesterday';
    if (matchesCalendarDate(dayBeforeYesterday)) return 'dayBeforeYesterday';

    const isDayOfWeek = /^(mon|tue|wed|thu|fri|sat|sun|пн|вт|ср|чт|пт|сб|вс|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)/i.test(clean);
    if (isDayOfWeek) {
        const matchesDay = (targetDate: Date) => {
            const idx = targetDate.getDay();
            const en = DAYS_EN[idx];
            const ru = DAYS_RU[idx];
            return clean.startsWith(en) || clean.startsWith(ru) || clean.includes(ru);
        };
        
        if (matchesDay(now)) return 'today';
        if (matchesDay(yesterday)) return 'yesterday';
        if (matchesDay(dayBeforeYesterday)) return 'dayBeforeYesterday';
    }

    return 'older';
}

/**
 * Проверка актуальности отдельного сообщения с учетом правил смены
 */
export function isMessageActual(
    category: MessageCategory,
    timeStr: string, 
    messageText: string = ''
): boolean {
    return isMessageInCollection(category, timeStr, messageText, isForTomorrow);
}
