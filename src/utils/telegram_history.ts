interface HistoryItem {
    type: string;
    text: string;
    sender?: string;
    time?: string;
    messageId?: string;
}

function sameHistoryItem(left: HistoryItem, right: HistoryItem): boolean {
    if (left.type !== right.type) return false;
    if (left.type === 'banner') return left.text === right.text;
    if (left.messageId && right.messageId) return left.messageId === right.messageId;
    // Без ID сравниваем полный текст; одинаковое начало не означает дубль.
    return left.sender === right.sender && left.time === right.time && left.text === right.text;
}

/**
 * Сопоставляет снимки как упорядоченные последовательности (LCS).
 * Каждое найденное сообщение участвует в сопоставлении только один раз:
 * повторные «Мад» не могут ссылаться на один и тот же якорь.
 */
export function mergeTelegramHistory<T extends HistoryItem>(history: T[], snapshot: T[]): void {
    const lengths = Array.from({ length: history.length + 1 }, () => new Uint32Array(snapshot.length + 1));
    for (let i = 1; i <= history.length; i++) {
        for (let j = 1; j <= snapshot.length; j++) {
            lengths[i][j] = sameHistoryItem(history[i - 1], snapshot[j - 1])
                ? lengths[i - 1][j - 1] + 1
                : Math.max(lengths[i - 1][j], lengths[i][j - 1]);
        }
    }

    const reversed: T[] = [];
    let i = history.length;
    let j = snapshot.length;
    // Идём от конца: перекрытие с уже собранными новыми сообщениями
    // сохраняется даже при одинаковых коротких сообщениях раньше в снимке.
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && sameHistoryItem(history[i - 1], snapshot[j - 1])) {
            reversed.push(history[--i]);
            j--;
        } else if (i > 0 && (j === 0 || lengths[i - 1][j] >= lengths[i][j - 1])) {
            reversed.push(history[--i]);
        } else {
            reversed.push(snapshot[--j]);
        }
    }
    history.splice(0, history.length, ...reversed.reverse());
}
