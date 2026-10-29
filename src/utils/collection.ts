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

/** Диагностика отбора сообщений; не влияет на результат проверки. */
export function collectionSpy(entry: Record<string, unknown>): void {
    try {
        const fs = require('fs') as typeof import('fs');
        const path = require('path') as typeof import('path');
        fs.appendFileSync(
            path.resolve(process.cwd(), 'collection_spy.log'),
            `[${new Date().toISOString()}] ${JSON.stringify(entry)}\n`
        );
    } catch {
        // Диагностика не должна прерывать сбор заказов.
    }
}

type CollectionPart = 'previous-period' | 'non-working-day' | 'current-period';
type BlockDisplayPart = CollectionPart | 'previous-day-time' | 'previous-day-none';

function getCollectionPart(messageDate: Date, now: Date): CollectionPart {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const messageDay = messageDate.getDay();
    const todayDay = today.getDay();

    // Воскресенье не является рабочим днём. В воскресенье вечером и
    // в понедельник воскресные сообщения входят в сбор, но не получают
    // отметку времени.
    if (messageDay === 0 && (todayDay === 0 || todayDay === 1)) {
        return 'non-working-day';
    }
    if (messageDate.getTime() < today.getTime()) return 'previous-period';
    return 'current-period';
}

/**
 * Классифицирует отображение сообщения по календарной дате и времени.
 * Отбор сообщений этим правилом не меняется.
 */
function getBlockDisplayPart(messageDate: Date, time: string, now: Date): BlockDisplayPart {
    const collectionPart = getCollectionPart(messageDate, now);
    if (collectionPart !== 'previous-period') return collectionPart;

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const messageDay = new Date(messageDate.getFullYear(), messageDate.getMonth(), messageDate.getDate());
    const dayDistance = Math.round((today.getTime() - messageDay.getTime()) / 86400000);
    if (dayDistance === 1) {
        const hour = Number.parseInt((time || '').split(':')[0], 10);
        return Number.isFinite(hour) && hour >= 15 ? 'previous-day-none' : 'previous-day-time';
    }
    return 'previous-period';
}

function getBlockDate(block: CollectionTextBlock, now: Date): Date | undefined {
    if (!block.date) return undefined;
    const [day, month] = block.date.split('.').map(Number);
    const messageDate = new Date(now.getFullYear(), month - 1, day);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (messageDate > today) messageDate.setFullYear(messageDate.getFullYear() - 1);
    return messageDate;
}

function hasEarlierTimestampBoundary(
    blocks: CollectionTextBlock[],
    blockIndex: number,
    now: Date
): boolean {
    return blocks.slice(0, blockIndex).some(previous => {
        if (!previous.time) return false;
        const previousHour = Number.parseInt(previous.time.split(':')[0], 10);
        if (Number.isFinite(previousHour) && previousHour >= 6 && previousHour < 15) return true;
        const previousDate = getBlockDate(previous, now);
        return Boolean(previousDate && getBlockDisplayPart(previousDate, previous.time, now) === 'previous-period');
    });
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
    if (category === 'older') {
        collectionSpy({ stage: 'common-filter', category, timeStr, result: false, reason: 'older' });
        return false;
    }
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
    const finish = (result: boolean, reason: string): boolean => {
        collectionSpy({
            stage: 'common-filter', category, timeStr,
            messageText: (messageText || '').slice(0, 180),
            now: now.toISOString(), mode: context.mode, dayOfWeek, result, reason
        });
        return result;
    };
    if (context.mode === 'EVENING_NIGHT') {
        if (now.getHours() >= 18) {
            if (category === 'today') return finish(dayOfWeek === 0 || checkTargetTime(hour, messageText, now), 'evening today');
            if (category === 'yesterday' && dayOfWeek === 0) {
                const reference = new Date(now); reference.setDate(reference.getDate() - 1);
                return finish(checkTargetTime(hour, messageText, reference), 'sunday evening yesterday');
            }
            return finish(false, 'evening category outside period');
        }
        if (category === 'today') {
            if (hour >= 12) {
                const reference = new Date(now); reference.setDate(reference.getDate() - 1);
                return finish(checkTargetTime(hour, messageText, reference), 'night today after noon');
            }
            return finish(hour < 6, 'night today before 06:00');
        }
        if (category === 'yesterday') {
            const reference = new Date(now); reference.setDate(reference.getDate() - 1);
            return finish(checkTargetTime(hour, messageText, reference), 'night yesterday');
        }
        return finish(false, 'night category outside period');
    }
    if (category === 'dayBeforeYesterday') {
        if (dayOfWeek !== 1) return finish(false, 'dayBeforeYesterday outside Monday');
        const reference = new Date(now); reference.setDate(reference.getDate() - 2);
        return finish(checkTargetTime(hour, messageText, reference), 'Monday dayBeforeYesterday');
    }
    if (category === 'yesterday') {
        if (dayOfWeek === 1) return finish(true, 'Monday yesterday');
        const reference = new Date(now); reference.setDate(reference.getDate() - 1);
        return finish(checkTargetTime(hour, messageText, reference), 'yesterday');
    }
    if (category === 'today') {
        if (dayOfWeek === 0 || now.getHours() < 15) return finish(true, 'today Sunday/day');
        return finish(hour < 15 || (hour === 15 && minute === 0), 'today after 15:00');
    }
    return finish(false, 'unhandled category');
}

/** Формирует текст блоков с едиными правилами показа даты и времени. */
export function formatCollectionBlocks(
    blocks: CollectionTextBlock[],
    printedDates: Set<string>,
    now: Date = new Date()
): string {
    const hasMorning = blocks.some(block => {
        const hour = Number.parseInt((block.time || '').split(':')[0], 10);
        if (!Number.isFinite(hour) || hour < 6 || hour >= 15) return false;
        const messageDate = getBlockDate(block, now);
        if (!messageDate) return true;
        const displayPart = getBlockDisplayPart(messageDate, block.time, now);
        return displayPart === 'current-period' || displayPart === 'previous-day-time';
    });
    const result: string[] = [];
    let printedMorning = false;
    let printedAfternoon = false;

    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        const block = blocks[blockIndex];
        if (!block.date || !block.time) {
            const hour = Number.parseInt((block.time || '').split(':')[0], 10);
            const hasEarlierTimestamp = hasEarlierTimestampBoundary(blocks, blockIndex, now);
            if (hasEarlierTimestamp && hour >= 15 && !printedAfternoon) {
                printedAfternoon = true;
                result.push(`(${block.time})\n${block.text}`);
                continue;
            }
            if (!hasMorning || !block.time) {
                result.push(block.text);
                continue;
            }
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

        const messageDate = getBlockDate(block, now)!;

        const displayPart = getBlockDisplayPart(messageDate, block.time, now);
        const hour = Number.parseInt(block.time.split(':')[0], 10);
        const hasEarlierTimestamp = hasEarlierTimestampBoundary(blocks, blockIndex, now);
        if (hasEarlierTimestamp && hour >= 15 && displayPart !== 'previous-period' && displayPart !== 'non-working-day' && !printedAfternoon) {
            printedAfternoon = true;
            result.push(`(${block.time})\n${block.text}`);
            continue;
        }
        if (displayPart === 'previous-day-none') {
            result.push(block.text);
            continue;
        }
        if (displayPart === 'previous-day-time') {
            if (!hasMorning || hour < 6 || hour >= 15) result.push(block.text);
            else if (!printedMorning) {
                printedMorning = true;
                result.push(`(${block.time})\n${block.text}`);
            } else result.push(block.text);
            continue;
        }
        if (displayPart === 'previous-period') {
            if (!printedDates.has(block.date)) {
                printedDates.add(block.date);
                result.push(`(${block.date} ${block.time})\n${block.text}`);
            } else result.push(block.text);
            continue;
        }
        if (displayPart === 'non-working-day') {
            result.push(block.text);
            continue;
        }

        if (!hasMorning || hour < 6 || hour >= 15) result.push(block.text);
        else if (!printedMorning) {
            printedMorning = true;
            result.push(`(${block.time})\n${block.text}`);
        } else result.push(block.text);
    }

    return result.join('\n\n');
}
