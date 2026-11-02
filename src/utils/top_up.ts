interface MessageTimestamp {
    date?: string;
    time?: string;
}

function parseClock(value: string | undefined): [number, number] | undefined {
    const match = (value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return undefined;
    return [Number(match[1]), Number(match[2])];
}

/** Начало добора — последнее наступившее HH:MM, включая сегодняшнюю полночь. */
export function getTopUpStart(fromTime: string | undefined, now = new Date()): Date | undefined {
    if (!fromTime) return undefined;
    const clock = parseClock(fromTime);
    if (!clock) throw new Error(`Некорректное время добора ${JSON.stringify(fromTime)}. Укажите HH:MM от 00:00 до 23:59.`);
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), ...clock);
    if (start > now) start.setDate(start.getDate() - 1);
    return start;
}

function parseDate(value: string, now: Date): Date | undefined {
    const match = value.trim().match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}|\d{2}))?$/);
    if (!match) return undefined;
    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const explicitYear = match[3];
    const year = explicitYear ? Number(explicitYear.length === 2 ? `20${explicitYear}` : explicitYear) : now.getFullYear();
    const date = new Date(year, month, day);
    if (!explicitYear && date > now) date.setFullYear(date.getFullYear() - 1);
    return date.getDate() === day && date.getMonth() === month ? date : undefined;
}

/** Отбор выполняется после сбора, до объединения заказов; исходный JSON не меняется. */
export function isMessageInTopUp(message: MessageTimestamp, start: Date | undefined, now = new Date()): boolean {
    if (!start) return true;
    const clock = parseClock(message.time);
    const date = message.date ? parseDate(message.date, now) : undefined;
    if (date) {
        if (!clock) {
            // Время неизвестно: сохраняем прежнее поведение внутри подходящего
            // дня, но заведомо более старые даты больше не пропускаем.
            const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            return date >= startDay && date <= today;
        }
        date.setHours(...clock, 0, 0);
        return date >= start && date <= now;
    }
    // Совместимость со старыми данными без распознанной даты: только здесь
    // остаётся прежнее предположение о последних 24 часах.
    if (!clock) return true;
    const inferred = new Date(now.getFullYear(), now.getMonth(), now.getDate(), ...clock);
    if (inferred > now) inferred.setDate(inferred.getDate() - 1);
    return inferred >= start && inferred <= now;
}
