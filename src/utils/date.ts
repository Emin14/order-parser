export interface CheckOrderResult {
    isActual: boolean;
    dateStr: string;
    reason: string;
}

export type ShiftMode = 'DAY' | 'EVENING_NIGHT';

const DAYS_EN = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAYS_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTHS_RU = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];

/**
 * Определение текущего режима сбора
 */
export function getShiftMode(now: Date = new Date()): { mode: ShiftMode; baseDate: Date } {
    const hour = now.getHours();
    if (hour >= 18) {
        // Вечерний сбор (18:00 - 23:59)
        return { mode: 'EVENING_NIGHT', baseDate: now };
    } else if (hour < 6) {
        // Ночной сбор (00:00 - 05:59): смена продолжается от вчера
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        return { mode: 'EVENING_NIGHT', baseDate: yesterday };
    } else {
        // Дневной сбор (06:00 - 17:59): от вчера до сегодня 15:00
        return { mode: 'DAY', baseDate: now };
    }
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
        const sameDay = messageAt.toDateString() === now.toDateString();
        const messageHour = messageAt.getHours();

        if (sameDay) {
            if (mode === 'EVENING_NIGHT' && now.getHours() >= 18 && messageHour < 6) {
                return { isActual: false, dateStr: text, reason: `Относительная дата VK (${text}), сегодня до 06:00` };
            }
            return { isActual: true, dateStr: text, reason: `Относительная дата VK (${text}), сегодня` };
        }

        if (mode === 'DAY' && messageHour >= 6) {
            return { isActual: true, dateStr: text, reason: `Относительная дата VK (${text}), вчера после 06:00` };
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
        if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}\s+[а-я]+|\d{2}\.\d{2})/i.test(line)) {
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
        const isMondayAndSaturday = dayOfWeek === 1 && mode === 'DAY' && (dl.startsWith('sat') || dl.startsWith('сб') || dl.startsWith('суббота'));

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
        const mEn = MONTHS_EN[monthIdx];
        const mRu = MONTHS_RU[monthIdx];

        const dayRegex = new RegExp(`(?:^|\\D)0?${day}(?:\\D|$)`);
        if (!dayRegex.test(clean)) return false;

        if (clean.includes(mEn) || clean.includes(mRu)) return true;
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
    category: 'today' | 'yesterday' | 'dayBeforeYesterday' | 'older', 
    timeStr: string, 
    messageText: string = ''
): boolean {
    if (category === 'older') return false;

    const now = new Date();
    const { mode } = getShiftMode(now);
    const dayOfWeek = now.getDay(); // 0 = вс, 1 = пн

    let h = 0;
    let m = 0;
    if (timeStr) {
        const match = timeStr.match(/(\d{1,2}):(\d{2})/);
        if (match) {
            h = parseInt(match[1], 10);
            m = parseInt(match[2], 10);
        }
    }

    // Вспомогательная функция для проверки времени (новое правило: >= 11:00 берем все, 09:00-10:59 с пометкой)
    const checkTargetTime = (hour: number, text: string, refDate: Date) => {
        if (hour >= 11) return true;
        if (hour >= 9 && hour < 11) {
            const hasAnyDay = /(?:^|[^а-яa-z0-9])на\s+(пн|понедельник|вт|вторник|ср|среду|чт|четверг|пт|пятницу|сб|субботу|вс|воскресенье|воскресенья)(?:[^а-яa-z0-9]|$)/i.test(text);
            return isForTomorrow(text, refDate) || hasAnyDay;
        }
        return false;
    };

    // ==========================================
    // РЕЖИМ 1: ВЕЧЕРНЕ-НОЧНОЙ СБОР (18:00 - 06:00)
    // ==========================================
    if (mode === 'EVENING_NIGHT') {
        if (now.getHours() >= 18) {
            // Обычный вечерний сбор забирает ТОЛЬКО сегодня
            if (category === 'today') {
                if (dayOfWeek === 0) return true;
                return checkTargetTime(h, messageText, now);
            }
            // В Воскресенье вечером разрешаем собирать еще и субботу (вчера)
            if (category === 'yesterday' && dayOfWeek === 0) {
                const yesterday = new Date(now);
                yesterday.setDate(yesterday.getDate() - 1);
                return checkTargetTime(h, messageText, yesterday);
            }
            return false;
        } else {
            // Ночь (00:00 - 05:59): смена продолжается от вчера
            if (category === 'today') {
                if (h >= 12) {
                    const yesterday = new Date(now);
                    yesterday.setDate(yesterday.getDate() - 1);
                    return checkTargetTime(h, messageText, yesterday);
                }
                return h < 6;
            }

            if (category === 'yesterday') {
                const yesterday = new Date(now);
                yesterday.setDate(yesterday.getDate() - 1);
                return checkTargetTime(h, messageText, yesterday);
            }

            return false;
        }
    }

    // ==========================================
    // РЕЖИМ 2: ДНЕВНОЙ СБОР (06:00 - 18:00)
    // ==========================================
    if (mode === 'DAY') {
        // ПОЗАВЧЕРА (dayBeforeYesterday)
        // В понедельник мы собираем субботу (dayBeforeYesterday)
        if (category === 'dayBeforeYesterday') {
            if (dayOfWeek === 1) {
                const dayBeforeYesterday = new Date(now);
                dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);
                return checkTargetTime(h, messageText, dayBeforeYesterday);
            }
            return false;
        }

        // ВЧЕРА (yesterday):
        if (category === 'yesterday') {
            // Если сегодня понедельник, то вчера - это воскресенье. Забираем ВСЁ за воскресенье!
            if (dayOfWeek === 1) {
                return true;
            }
            
            // В остальные дни работает новое правило 11:00/12:00
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            return checkTargetTime(h, messageText, yesterday);
        }

        // СЕГОДНЯ (today):
        if (category === 'today') {
            // Если сегодня воскресенье, то мы собираем ВСЕ заказы за сегодня (с 00:00 до 23:59)
            if (dayOfWeek === 0) {
                return true;
            }
            
            // Обычные дни:
            if (now.getHours() < 15) {
                return true;
            } else {
                return h < 15 || (h === 15 && m === 0);
            }
        }

        return false;
    }

    return false;
}
