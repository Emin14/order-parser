export type ShiftMode = 'DAY' | 'EVENING_NIGHT';
export type MessageCategory = 'today' | 'yesterday' | 'dayBeforeYesterday' | 'older';

export interface CollectionContext {
    mode: ShiftMode;
    deliveryDate: Date;
    shiftStart: Date;
    shiftEnd: Date;
    includesSunday: boolean;
}

export interface CollectionTextBlock {
    time: string;
    date?: string;
    text: string;
}

export function getCollectionContext(now: Date = new Date()): CollectionContext {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const hour = now.getHours();
    const mode: ShiftMode = hour >= 18 || hour < 6 ? 'EVENING_NIGHT' : 'DAY';
    const deliveryDate = new Date(day);
    if (hour >= 12) deliveryDate.setDate(deliveryDate.getDate() + 1);
    const shiftStart = new Date(day);
    if (hour < 6) shiftStart.setDate(shiftStart.getDate() - 1);
    shiftStart.setHours(hour >= 18 || hour < 6 ? 18 : 6, 0, 0, 0);
    const shiftEnd = new Date(day);
    if (mode === 'DAY') {
        shiftEnd.setHours(18, 0, 0, 0);
    } else if (hour >= 18) {
        shiftEnd.setDate(shiftEnd.getDate() + 1);
        shiftEnd.setHours(6, 0, 0, 0);
    } else {
        shiftEnd.setHours(6, 0, 0, 0);
    }
    return { mode, deliveryDate, shiftStart, shiftEnd, includesSunday: day.getDay() === 1 };
}

export function isMessageInCollection(
    category: MessageCategory,
    timeStr: string,
    messageText: string,
    isForTomorrow: (text: string, referenceDate: Date) => boolean,
    now: Date = new Date()
): boolean {
    if (category === 'older') return false;
    const context = getCollectionContext(now);
    const dayOfWeek = now.getDay();
    const match = (timeStr || '').match(/(\d{1,2}):(\d{2})/);
    const hour = match ? parseInt(match[1], 10) : 0;
    const minute = match ? parseInt(match[2], 10) : 0;
    const checkTargetTime = (h: number, text: string, referenceDate: Date): boolean => {
        if (h >= 11) return true;
        if (h >= 9 && h < 11) {
            const hasAnyDay = /(?:^|[^а-яa-z0-9])на\s+(пн|понедельник|вт|вторник|ср|среду|чт|четверг|пт|пятницу|сб|субботу|вс|воскресенье|воскресенья)(?:[^а-яa-z0-9]|$)/i.test(text);
            return isForTomorrow(text, referenceDate) || hasAnyDay;
        }
        return false;
    };
    if (context.mode === 'EVENING_NIGHT') {
        if (now.getHours() >= 18) {
            if (category === 'today') return dayOfWeek === 0 || checkTargetTime(hour, messageText, now);
            if (category === 'yesterday' && dayOfWeek === 0) {
                const reference = new Date(now); reference.setDate(reference.getDate() - 1);
                return checkTargetTime(hour, messageText, reference);
            }
            return false;
        }
        if (category === 'today') {
            if (hour >= 12) {
                const reference = new Date(now); reference.setDate(reference.getDate() - 1);
                return checkTargetTime(hour, messageText, reference);
            }
            return hour < 6;
        }
        if (category === 'yesterday') {
            const reference = new Date(now); reference.setDate(reference.getDate() - 1);
            return checkTargetTime(hour, messageText, reference);
        }
        return false;
    }
    if (category === 'dayBeforeYesterday') {
        if (dayOfWeek !== 1) return false;
        const reference = new Date(now); reference.setDate(reference.getDate() - 2);
        return checkTargetTime(hour, messageText, reference);
    }
    if (category === 'yesterday') {
        if (dayOfWeek === 1) return true;
        const reference = new Date(now); reference.setDate(reference.getDate() - 1);
        return checkTargetTime(hour, messageText, reference);
    }
    if (category === 'today') {
        if (dayOfWeek === 0 || now.getHours() < 15) return true;
        return hour < 15 || (hour === 15 && minute === 0);
    }
    return false;
}

/** Формирует текст блоков с едиными правилами показа даты и времени. */
export function formatCollectionBlocks(
    blocks: CollectionTextBlock[],
    printedDates: Set<string>,
    now: Date = new Date()
): string {
    const context = getCollectionContext(now);
    const hasMorning = blocks.some(block => {
        const hour = Number.parseInt((block.time || '').split(':')[0], 10);
        return Number.isFinite(hour) && hour >= 6 && hour < 15;
    });
    const result: string[] = [];
    let printedMorning = false;
    let printedAfternoon = false;

    for (const block of blocks) {
        if (!block.date || !block.time) {
            if (!hasMorning || !block.time) {
                result.push(block.text);
                continue;
            }
            const hour = Number.parseInt(block.time.split(':')[0], 10);
            if (hour >= 6 && hour < 15) {
                if (!printedMorning) {
                    printedMorning = true;
                    result.push(`(${block.time})\n${block.text}`);
                } else result.push(block.text);
            } else if (!printedAfternoon) {
                printedAfternoon = true;
                result.push(`(${block.time})\n${block.text}`);
            } else result.push(block.text);
            continue;
        }

        const [day, month] = block.date.split('.').map(Number);
        const messageDate = new Date(now.getFullYear(), month - 1, day);
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (messageDate > today) messageDate.setFullYear(messageDate.getFullYear() - 1);
        const ageDays = Math.floor((today.getTime() - messageDate.getTime()) / 86400000);
        const oldDateThreshold = context.includesSunday && now.getHours() < 18 ? 3 : 2;

        if (ageDays >= oldDateThreshold) {
            if (!printedDates.has(block.date)) {
                printedDates.add(block.date);
                result.push(`(${block.date} ${block.time})\n${block.text}`);
            } else result.push(block.text);
            continue;
        }

        const hour = Number.parseInt(block.time.split(':')[0], 10);
        if (!hasMorning || hour < 6 || hour >= 15) result.push(block.text);
        else if (!printedMorning) {
            printedMorning = true;
            result.push(`(${block.time})\n${block.text}`);
        } else result.push(block.text);
    }

    return result.join('\n\n');
}
