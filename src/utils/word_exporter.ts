import * as fs from 'fs';
import * as path from 'path';
import { Document, Paragraph, TextRun, Packer } from 'docx';
import { OrderResult, MessageItem } from '../types';

/**
 * Вспомогательная функция очистки названия от служебных слов
 * Убирает "заказы", "овощи", "фрукты" и т.д.
 */
function cleanBrandName(rawName: string): string {
    return rawName
        // Удаляем артефакты Telegram (одиночная буква аватарки перед переносом строки, например "П\nПремьер" или "→ В\nВиктория")
        .replace(/(?:^|→\s*)[А-ЯЁA-Z]\n/gi, (match) => match.includes('→') ? '→ ' : '')
        .replace(/заказы|заказ|закупка|овощи\/фрукты|овощи и фрукты|овощи|фрукты|5 база/gi, '')
        .replace(/🍅|🍊|🧀|🍓/g, '') // Убираем эмодзи
        .replace(/[\(\[\{].*?[\)\]\}]/g, '') // Убираем скобки
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Удаляет приветствия из текста, чтобы они не попадали в заголовки.
 */
function stripGreetings(text: string): string {
    let cleaned = text;
    
    // 1. Убираем базовые приветствия ТОЛЬКО в начале сообщения
    const greetingsRegex = /^\s*(здравствуйте|добры[йя]\s*[,]?[ \s]*(день|вечер|ночь|утро)|доброе\s*(утро)?|доброй\s*(ночи)?|приветствую|привет)[!,.\s:;]*/i;
    
    // 2. Убираем вводные фразы типа "примите заказ" ТОЛЬКО в начале сообщения
    const orderIntroRegex = /^\s*(?:прошу\s+принять\s+(?:заказ|заявку)|прими(?:те)?\s+(?:заказ|заявку)|пожалуйста|заказ|заявка)[!,.\s:;]*/i;
    
    // Прогоняем несколько раз, чтобы удалить цепочки (например, "Здравствуйте! примите заказ пожалуйста на сегодня")
    let prev = '';
    while (cleaned !== prev) {
        prev = cleaned;
        cleaned = cleaned.replace(greetingsRegex, '');
        cleaned = cleaned.replace(orderIntroRegex, '');
    }
    
    return cleaned.trim();
}

/**
 * Удаляет из текста фразу "на завтра" (и её вариации с двоеточием)
 * если заказ написан после 15:00.
 */
function stripTomorrowPhrase(text: string, time: string | undefined): string {
    if (!time) return text;
    const [hStr] = time.split(':');
    if (!hStr) return text;
    const h = parseInt(hStr, 10);
    
    // Если заказ написан после 15:00 (т.е. 15:00 - 23:59)
    if (h >= 15) {
        // Определяем целевую дату заказа
        const now = new Date();
        const targetDate = new Date(now);
        // Если скрипт работает днём/вечером (>= 12:00), собираем на следующий день
        if (now.getHours() >= 12) {
            targetDate.setDate(targetDate.getDate() + 1);
        }

        const d = targetDate.getDate();
        const dStr = String(d).padStart(2, '0');
        const m = targetDate.getMonth() + 1;
        const mStr = String(m).padStart(2, '0');

        // Генерируем паттерн для даты (например: 1.10, 01.10, 1.10.24, 01.10.2024)
        const datePattern = `(?:${d}|${dStr})\\.(?:${m}|${mStr})(?:\\.(?:\\d{2}|\\d{4}))?`;

        // Убираем вариации "на завтра", "на 1.10", "заказ на завтра", "заказ на 1.10" и т.д. ТОЛЬКО в начале сообщения
        const regexPattern = `^\\s*(?:(?:заказ(?:ы)?|заявка|закупка)\\s+)?на\\s+(?:завтра(?:\\s+${datePattern})?|${datePattern})\\s*[:.,;]?`;
        const regex = new RegExp(regexPattern, 'i');

        return text.replace(regex, '').trim();
    }
    return text;
}

/**
 * Проверка: является ли строка перечислением товара.
 * Используется, чтобы случайно не сделать товар заголовком, если настоящий заголовок был удален фильтрами.
 */
function isProductLine(line: string): boolean {
    const clean = line.trim().toLowerCase();
    // Ищем числа с явными единицами измерения товара (2кг, 15 шт, 0.5л, 10 гр, 2уп) где угодно в строке
    if (/(?:\d+[,.]?\d*)\s*(кг|г|гр|шт|л|мл|уп|пачк[иа]|сетк[иа]|ведр[оа]|пучк[иа]|пучок|ящик|кор|короб|лоток)(?:[^а-яёa-z]|$)/i.test(clean)) {
        return true;
    }
    return false;
}

export async function exportToWord(orders: OrderResult[], outputPath: string, fromTime?: string) {
    const configPath = path.resolve(process.cwd(), 'cafes_config.json');
    if (!fs.existsSync(configPath)) {
        console.error('Конфиг cafes_config.json не найден!');
        return;
    }

    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    function findChatConfig(chatName: string): any {
        for (const platform of Object.values(configData)) {
            const found = (platform as any).chats?.find((c: any) => c.name === chatName);
            if (found) return found;
        }
        return {};
    }

    function isExplicitVenueHeader(header: string, chatConfig: any): boolean {
        const clean = header.replace(/[:,]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!clean) return false;

        for (const branch of chatConfig.branches || []) {
            const names = [branch.name, ...(branch.aliases || [])].filter(Boolean);
            if (names.some((name: string) => clean.includes(String(name).toLowerCase()))) return true;
        }
        // Для всех общих чатов без совпадения в branches строка остаётся
        // резервным текстом и не объявляется филиалом по цифрам или товарам.
        return false;
    }

    // --- Фильтр «добора»: оставляем только сообщения после fromTime ---
    function isAfterFrom(msgTime: string | undefined): boolean {
        if (!fromTime) return true;  // режим не задан — берём все
        if (!msgTime) return true;   // нет времени — не отсекаем

        const now = new Date();
        const currentTotal = now.getHours() * 60 + now.getMinutes();

        // Переводим время HH:MM в "абсолютные минуты" относительно ТЕКУЩЕГО времени.
        // Поскольку парсер собирает заказы за последние ~24 часа:
        // Если время сообщения БОЛЬШЕ текущего (например, сейчас 12:15, а сообщение 20:29),
        // значит это сообщение было ВЧЕРА. Мы вычитаем 24 часа.
        function getAbsoluteMinutes(t: string): number {
            const [h, m] = t.split(':').map(Number);
            let total = h * 60 + m;
            
            // Если время больше текущего — это 100% вчерашний день
            if (total > currentTotal) {
                total -= 24 * 60; 
            }
            return total;
        }

        const msgAbsolute = getAbsoluteMinutes(msgTime);
        const fromAbsolute = getAbsoluteMinutes(fromTime);

        return msgAbsolute >= fromAbsolute;
    }

    interface VirtualOrder {
        header: string;
        text: string;
        time: string;
        sender: string;
        phone: string;
        chatName: string;
        headerSource: 'explicit' | 'chat-fallback';
        hasReply: boolean;
        isBranchHeader: boolean;
        runKey?: string;
    }

    let finalOrders: VirtualOrder[] = [];

    // --- ЭТАП 1: Нарезка и формирование заголовков ---
    for (const orderBlock of orders) {
        const messenger = orderBlock.messenger.toLowerCase();
        const messengerConfig = configData[messenger];
        if (!messengerConfig) continue;

        let chatConfig = messengerConfig.chats.find((c: any) => orderBlock.chatName.includes(c.name) || c.name.includes(orderBlock.chatName));
        if (!chatConfig) {
            chatConfig = { name: orderBlock.chatName, enabled: true, shared_chat: false, branches: [] };
        }

        if (chatConfig.enabled === false) continue;

        // Применяем фильтр добора — отсекаем сообщения вне диапазона
        let messages = [...orderBlock.messages].filter(m => isAfterFrom(m.time));
        if (messages.length === 0) continue;

        const cleanChatName = chatConfig.display_name || cleanBrandName(chatConfig.name);

        // Восстанавливаем точку по цитируемому сообщению (replyTo)
        for (const msg of messages) {
            if (msg.replyTo && msg.replyTo.text) {
                // При любом ответе через кнопку «Ответить» — ищем родительское сообщение
                // и вклеиваем текст ответа туда (добавка к заказу)
                let replySnippet = msg.replyTo.text.replace(/\s+/g, ' ').replace(/\.+$/, '').trim();
                if (replySnippet.length > 40) replySnippet = replySnippet.slice(0, 40);

                // Сначала точное совпадение
                let parentMsg = messages.find(m => m !== msg && m.text.replace(/\s+/g, ' ').includes(replySnippet));

                // Если не нашли — пробуем по первым 15 символам (мессенджеры обрезают превью цитаты)
                if (!parentMsg && replySnippet.length > 15) {
                    const shortSnippet = replySnippet.slice(0, 15);
                    parentMsg = messages.find(m => m !== msg && m.text.replace(/\s+/g, ' ').includes(shortSnippet));
                }

                if (parentMsg) {
                    parentMsg.text += '\n' + msg.text;
                    (parentMsg as any)._hasReplyContinuation = true;
                    msg.text = ''; // Очищаем: текст влился в родителя
                }
            }
        }

        // Если это общий чат (shared_chat), мы восстанавливаем изначальные сообщения VK, разрезая по \n---\n
        if (chatConfig.shared_chat) {
            const splitMessages: MessageItem[] = [];
            for (const msg of messages) {
                const parts = msg.text.split(/(?:\n\s*---\s*\n|---)/);
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i].trim();
                    if (part) {
                        splitMessages.push({ ...msg, text: part });
                    }
                }
            }
            messages = splitMessages;
        } 

        for (const msg of messages) {
            msg.text = stripGreetings(msg.text);
            msg.text = stripTomorrowPhrase(msg.text, msg.time);
            if (!msg.text) continue;

            let rawBlocks = [msg.text];
            
            // Разделяем бар и кухню, если они явно указаны в одном сообщении.
            // Старый формат «Заказ бар: / Заказ кухня:» сохраняется для всех чатов.
            // Флаг split_bar_kitchen добавляет такой режим для обычных заголовков «бар: / кухня:».
            const hasLegacyBarKitchen = msg.text.match(/Заказ бар:/i) && msg.text.match(/Заказ кухня:/i);
            const barKitchenHeader = /^\s*(?:(?:заказ|на)\s+)?(бар|кухня)\s*:?\s*$/gim;
            const headings = [...msg.text.matchAll(barKitchenHeader)];
            if (hasLegacyBarKitchen || (chatConfig.split_bar_kitchen === true && headings.length >= 2)) {
                const barHeading = headings.find(h => h[1].toLowerCase() === 'бар');
                const kitchenHeading = headings.find(h => h[1].toLowerCase() === 'кухня');
                if (barHeading && kitchenHeading && barHeading.index !== undefined && kitchenHeading.index !== undefined) {
                    const firstHeading = barHeading.index < kitchenHeading.index ? barHeading : kitchenHeading;
                    const secondHeading = firstHeading === barHeading ? kitchenHeading : barHeading;
                    const firstBlock = msg.text.slice(firstHeading.index, secondHeading.index).trim();
                    const secondBlock = msg.text.slice(secondHeading.index).trim();
                    rawBlocks = [firstBlock, secondBlock];
                }
            }
            // Разделение по слову "Отдельно" внутри текста (глобально, для всех вхождений)
            const regex = /(\n\s*(?:Отдельной\s+накладной|Отдельным\s+чеком|Отдельно)[^\n]*)/gi;
            const parts = msg.text.split(regex);
            if (parts.length > 1) {
                let tempBlocks = [parts[0].trim()];
                for (let i = 1; i < parts.length; i += 2) {
                    const phrase = parts[i].trim();
                    const content = parts[i + 1] ? parts[i + 1].trim() : '';
                    tempBlocks.push(phrase + "\n" + content);
                }
                rawBlocks = tempBlocks.filter(b => b.length > 0);
            }
            
            // Правило: Разделение по известным адресам филиалов (branches)
            if (chatConfig.branches && chatConfig.branches.length > 0) {
                let newRawBlocks: string[] = [];
                for (const block of rawBlocks) {
                    const lines = block.split('\n');
                    let currentBlock: string[] = [];
                    for (let line of lines) {
                        if (!line.trim()) continue;
                        let isBranchStart = false;
                        let matchedBranchName: string | null = null;
                        const lowLine = line.trim().toLowerCase();
                        for (const branch of chatConfig.branches) {
                            if (branch.aliases.some((a: string) => lowLine.includes(a.toLowerCase()))) {
                                isBranchStart = true;
                                matchedBranchName = branch.name;
                                break;
                            }
                        }
                        if (isBranchStart) {
                            if (currentBlock.length > 0) {
                                newRawBlocks.push(currentBlock.join('\n'));
                                currentBlock = [];
                            }
                            // Если use_branch_name — подставляем официальное название ветки
                            // чтобы заголовки совпадали и объединялись
                            if (chatConfig.use_branch_name && matchedBranchName) {
                                // Сохраняем пометку "Отдельно" если она есть в строке
                                const isOtd = /отдельно|отдельной|отдельным/i.test(line);
                                currentBlock.push(isOtd ? `${matchedBranchName} Отдельно` : matchedBranchName);
                            } else {
                                currentBlock.push(line);
                            }
                        } else {
                            currentBlock.push(line);
                        }
                    }
                    if (currentBlock.length > 0) {
                        newRawBlocks.push(currentBlock.join('\n'));
                    }
                }
                
                // Постобработка: если блок — одна строка-заголовок (без товаров),
                // приклеиваем её к следующему блоку.
                // Пример: "ООО Хорошие руки все вместе:" + "Соборная 15а:\nАвокадо..."
                //      → "ООО Хорошие руки все вместе\nСоборная 15а:\nАвокадо..."
                // Если prefix_brand — режем ЧИСТО по филиалам, без склеивания.
                // Каждый кусок (включая вступительные фразы) получит имя чата как префикс.
                // Если prefix_brand нет — склеиваем одиночные строки с следующим блоком
                // (нужно для чатов типа "Хорошие руки", где первая строка — название организации).
                if (!chatConfig.prefix_brand) {
                    const mergedBlocks: string[] = [];
                    let pendingPrefix = '';
                    for (let i = 0; i < newRawBlocks.length; i++) {
                        const blockLines = newRawBlocks[i].split('\n').map((l: string) => l.trim()).filter((l: string) => l);
                        if (blockLines.length === 1 && i < newRawBlocks.length - 1) {
                            pendingPrefix = blockLines[0].replace(/:$/, '').trim();
                        } else {
                            if (pendingPrefix) {
                                mergedBlocks.push(pendingPrefix + '\n' + newRawBlocks[i]);
                                pendingPrefix = '';
                            } else {
                                mergedBlocks.push(newRawBlocks[i]);
                            }
                        }
                    }
                    if (pendingPrefix) mergedBlocks.push(pendingPrefix);
                    rawBlocks = mergedBlocks;
                } else {
                    // Чистое разрезание — каждый блок идёт как есть
                    rawBlocks = newRawBlocks;
                }
            }
            // Правило: Разделение по суб-заказам (split_sub_orders)
            else if (chatConfig.split_sub_orders) {
                let newRawBlocks: string[] = [];
                for (const block of rawBlocks) {
                    const raw = block.split(/\n\s*\n/).map(s => s.trim()).filter(s => s.length > 0);
                    for (let i = 0; i < raw.length; i++) {
                        if (raw[i].split('\n').length === 1 && raw[i].split(' ').length <= 4 && i < raw.length - 1) {
                            raw[i + 1] = raw[i] + '\n' + raw[i + 1];
                        } else {
                            newRawBlocks.push(raw[i]);
                        }
                    }
                }
                rawBlocks = newRawBlocks;
            }

            let lastHeader = cleanChatName;
            for (const block of rawBlocks) {
                let header = '';
                let textBody = block;
                let headerSource: 'explicit' | 'chat-fallback' = 'chat-fallback';
                let isSeparateBlock = false;
                let separatePhrase = '';

                const lines = block.split('\n').map(l => l.trim()).filter(l => l);
                if (lines.length === 0) continue;

                // Если этот блок был отсечен как "Отдельно"
                const firstLineLower = lines[0].toLowerCase();
                if (firstLineLower.includes('отдельно') || firstLineLower.includes('отдельной') || firstLineLower.includes('отдельным')) {
                    isSeparateBlock = true;
                    separatePhrase = lines.shift()!; // сохраняем фразу
                    textBody = lines.join('\n');
                }

                if (isSeparateBlock) {
                    header = lastHeader;
                } else {
                    // Правило: is_forum (Telegram)
                    if (chatConfig.is_forum && orderBlock.chatName.includes('→')) {
                        const parts = orderBlock.chatName.split('→');
                        let topicName = parts[parts.length - 1].trim().replace(/\n/g, ' ');
                        topicName = topicName.replace(/^В\s+/i, ''); // убираем предлог "В "
                        header = `${cleanChatName} ${topicName}`;
                    } 
                    // Правило: shared_chat или split_sub_orders/branches
                    else if (chatConfig.shared_chat || chatConfig.split_sub_orders || (chatConfig.branches && chatConfig.branches.length > 0)) {
                        let headerParts = [];
                        let textLines = [];
                        
                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i];
                            const cleanForCheck = line.replace(/[:,]/g, '').trim().toLowerCase();
                            
                            if (i === 0) {
                                const blacklist = ['адам', 'сегодняшнюю', 'завтрашнюю', 'спасибо', 'пожалуйста', 'ок', 'хорошо', 'да', 'нет', 'на завтра', 'добавьте', 'добавка', 'дозаказ', 'в плазу', 'ребят', 'ребята', 'девчат', 'девочки', 'коллеги', 'подскажите', 'вопрос', 'внимание'];
                                if (chatConfig.allow_unlisted_headers === true || (!blacklist.includes(cleanForCheck) && !isProductLine(line))) {
                                    let h = line;
                                    if (h.endsWith(':')) h = h.slice(0, -1).trim();
                                    headerParts.push(h);
                                } else {
                                    textLines = lines.slice(i);
                                    break;
                                }
                            } else if (i === 1) {
                                let isEntityOrAddress = false;
                                
                                if (/(^|[^а-яёa-z])(ип|ооо|зао|ао)([^а-яёa-z]|$)/i.test(line)) isEntityOrAddress = true;
                                if (/(^|[^а-яёa-z])(ул\.?|улица|пр\.?|проспект|ш\.?|шоссе|жк|дом|д\.?|пер\.?|переулок)([^а-яёa-z]|$)/i.test(line)) isEntityOrAddress = true;
                                
                                if (!isEntityOrAddress && chatConfig.branches) {
                                    for (const branch of chatConfig.branches) {
                                        if (cleanForCheck.includes(branch.name.toLowerCase())) {
                                            isEntityOrAddress = true; break;
                                        }
                                        for (const alias of branch.aliases || []) {
                                            if (cleanForCheck.includes(alias.toLowerCase())) {
                                                isEntityOrAddress = true; break;
                                            }
                                        }
                                    }
                                }
                                
                                if (isEntityOrAddress) {
                                    let h = line;
                                    if (h.endsWith(':')) h = h.slice(0, -1).trim();
                                    headerParts.push(h);
                                } else {
                                    textLines = lines.slice(i);
                                    break;
                                }
                            } else {
                                textLines = lines.slice(i);
                                break;
                            }
                        }
                        
                        if (headerParts.length > 0) {
                            let rawHeader = headerParts.join(' ').replace(/\n/g, ' ');
                            
                            // Удаляем слова приветствия и вежливости из заголовка
                            const politeWords = /(?:^|\s)(пожалуйста|добрый день|день добрый|здравствуйте|здравствуй|доброе утро|добрый вечер|привет|приветик|доброй ночи)(?:[\s,!.?]|$)/gi;
                            rawHeader = rawHeader.replace(politeWords, ' ');
                            rawHeader = rawHeader.replace(politeWords, ' '); // второй проход на случай подряд идущих слов
                            rawHeader = rawHeader.replace(/^[,.!\s]+|[,.!\s]+$/g, '').replace(/\s{2,}/g, ' ').trim();
                            
                            headerSource = !chatConfig.shared_chat || chatConfig.allow_unlisted_headers === true || isExplicitVenueHeader(rawHeader, chatConfig)
                                ? 'explicit'
                                : 'chat-fallback';
                            if (headerSource === 'chat-fallback') {
                                // Не выдаём случайную первую строку (например, приветствие)
                                // за точку. Для резервного блока сохраняем исходный текст.
                                header = cleanChatName;
                                textBody = lines.join('\n').trim();
                            } else {
                                header = rawHeader;
                                textBody = textLines.join('\n').trim();
                            }
                            
                            if (chatConfig.prefix_brand) {
                                header = `${cleanChatName} ${header}`;
                            }
                        } else {
                            header = cleanChatName;
                            textBody = lines.join('\n').trim();
                        }
                    } 
                    // Правило: Обычный чат
                    else {
                        header = cleanChatName;
                        
                        // Сохранение ТОЛЬКО явно указанных подзаголовков (Белый список)
                        if (lines.length > 1) {
                            let firstLine = lines[0];
                            const cleanForCheck = firstLine.replace(/[:,]/g, '').trim().toLowerCase();
                            
                            if (/^(на )?(бар|кухня|кухню|отдельно)$/.test(cleanForCheck)) {
                                if (firstLine.endsWith(':')) firstLine = firstLine.slice(0, -1).trim();
                                header = `${header} ${firstLine}`;
                                textBody = lines.slice(1).join('\n').trim();
                            }
                        }
                    }
                    lastHeader = header;
                }

                if (isSeparateBlock) {
                    header = `${header} ${separatePhrase}`;
                }

                finalOrders.push({
                    header: header,
                    text: textBody,
                    time: msg.time,
                    sender: msg.sender,
                    phone: msg.phone || '',
                    chatName: orderBlock.chatName,
                    headerSource,
                    hasReply: Boolean(msg.replyTo || (msg as any)._hasReplyContinuation),
                    isBranchHeader: Boolean(
                        isSeparateBlock ||
                        /\b(бар|кухн(?:я|ю)|отдельно)\b/i.test(header) ||
                        headerSource === 'explicit' ||
                        ((chatConfig.branches || []).length > 0 && isExplicitVenueHeader(header, chatConfig))
                    )
                });
            }
        }
    }

    // --- ЭТАП 2: Добавки без цитирования (привязка по автору) ---
    const linkedOrders: VirtualOrder[] = [];
    for (const vo of finalOrders) {
        const isAddition = vo.text.toLowerCase().includes('добав') || vo.text.toLowerCase().includes('дозаказ');
        const isProductOnly = false;
        const isDefaultHeader = vo.header === cleanBrandName(vo.chatName);
        
        // isReply обрабатывается в Phase 1 — здесь только явные слова-маркеры
        if (isAddition || (isProductOnly && isDefaultHeader)) {
            // Ищем последний заказ этого же автора В ЭТОМ ЖЕ ЧАТЕ
            for (let i = linkedOrders.length - 1; i >= 0; i--) {
                if (linkedOrders[i].sender === vo.sender && linkedOrders[i].chatName === vo.chatName) {
                    vo.header = linkedOrders[i].header;
                    break;
                }
            }
        }

        linkedOrders.push(vo);
    }

    // Объединяем только соседние сообщения одного отправителя.
    // Явно названные точки, бар/кухня, «Отдельно» и цитаты разрывают серию.
    let runCounter = 0;
    let previousRunOrder: VirtualOrder | undefined;
    for (const vo of linkedOrders) {
        const voChatConfig = findChatConfig(vo.chatName);
        const senderKey = (vo.phone || vo.sender).trim().toLowerCase();
        const previousSenderKey = previousRunOrder ? (previousRunOrder.phone || previousRunOrder.sender).trim().toLowerCase() : '';
        const canContinue = Boolean(
            voChatConfig.allow_unlisted_headers !== true &&
            !vo.isBranchHeader &&
            !vo.hasReply &&
            previousRunOrder &&
            previousRunOrder.chatName === vo.chatName &&
            !previousRunOrder.isBranchHeader &&
            !previousRunOrder.hasReply &&
            senderKey &&
            senderKey === previousSenderKey &&
            previousRunOrder.runKey
        );
        vo.runKey = canContinue ? previousRunOrder!.runKey : `fallback-run-${runCounter++}`;
        previousRunOrder = vo;
    }

    // --- ЭТАП 3: Группировка (merge_same_spot) ---
    interface GroupedOrder {
        header: string;
        chatName: string;
        sender: string;
        phone: string;
        blocks: { time: string, text: string }[];
        runKey?: string;
    }
    const groupedOrders: GroupedOrder[] = [];
    
    for (const vo of linkedOrders) {
        let mergeSetting = true; // По умолчанию сливаем
        
        const isSeparate = vo.header.toLowerCase().includes('отдельно') || vo.text.toLowerCase().includes('отдельной накладной');
        
        const chatConfig = findChatConfig(vo.chatName);
        
        if (chatConfig.merge_same_spot === false) {
            mergeSetting = false;
        }

        let existing = null;
        if (!isSeparate) {
            if (vo.runKey && !vo.isBranchHeader && !vo.hasReply) {
                existing = groupedOrders.find(g => g.runKey === vo.runKey && g.chatName === vo.chatName);
            } else if (chatConfig.shared_chat === true) {
                if (vo.headerSource === 'explicit' && !vo.hasReply && mergeSetting) {
                    existing = groupedOrders.find(g => g.header === vo.header && g.chatName === vo.chatName);
                } else if (vo.headerSource === 'chat-fallback' && !vo.hasReply && vo.runKey) {
                    existing = groupedOrders.find(g => g.runKey === vo.runKey && g.chatName === vo.chatName);
                }
            } else if (chatConfig.merge_by_sender) {
                // Объединяем по отправителю: один человек — один блок, разные люди — разные блоки
                existing = groupedOrders.find(g => g.sender === vo.sender && g.chatName === vo.chatName);
            } else if (mergeSetting) {
                // Стандартное объединение: одинаковый заголовок → один блок
                existing = groupedOrders.find(g => g.header === vo.header && g.chatName === vo.chatName);
            }
        }

        if (existing) {
            existing.blocks.push({ time: vo.time, text: vo.text });
        } else {
            groupedOrders.push({
                header: vo.header,
                chatName: vo.chatName,
                sender: vo.sender,
                phone: vo.phone,
                blocks: [{ time: vo.time, text: vo.text }],
                runKey: vo.runKey
            });
        }
    }

    // Применяем двоеточия ко всем заголовкам в конце
    for (const go of groupedOrders) {
        if (!go.header.endsWith(':')) go.header += ':';
    }


    // --- ЭТАП 4: Генерация Word документа ---
    const children: Paragraph[] = [];
    let prevChatName = '';

    for (const order of groupedOrders) {
        const isNewChat = order.chatName !== prevChatName;
        prevChatName = order.chatName;

        // Заголовок заказа (Жирный, Calibri 16)
        // Первый заголовок нового чата — первая буква красная + больше отступов сверху
        // Последующие заголовки внутри того же чата — чёрный + обычный отступ
        children.push(new Paragraph({
            children: isNewChat && order.header.length > 0
                ? [
                    new TextRun({
                        text: order.header[0],
                        bold: true,
                        font: "Calibri",
                        size: 32,
                        color: "FF0000" // первая буква — красная
                    }),
                    new TextRun({
                        text: order.header.slice(1),
                        bold: true,
                        font: "Calibri",
                        size: 32,
                        color: "000000" // остальной текст — чёрный
                    })
                ]
                : [
                    new TextRun({
                        text: order.header,
                        bold: true,
                        font: "Calibri",
                        size: 32,
                        color: "000000"
                    })
                ],
            spacing: {
                before: isNewChat ? 1200 : 240,
                after: 120
            }
        }));

        // Текст заказа (Обычный, Calibri 16)
        // Проверяем, есть ли утренние сообщения.
        // Время скрывается только если сам заказ написан в воскресенье.
        // "Воскресные заказы" мы собираем либо в понедельник до 18:00 (дневной сбор), либо в воскресенье после 18:00 (вечерний сбор).
        const now = new Date();
        const day = now.getDay();
        const hour = now.getHours();
        const isSundayBatch = (day === 1 && hour < 18) || (day === 0 && hour >= 18);
        
        const hasMorning = !isSundayBatch && order.blocks.some(b => {
            if (!b.time) return false;
            const [hr] = b.time.split(':');
            return hr && parseInt(hr, 10) < 15;
        });

        const finalTextBlocks: string[] = [];
        let printedAfternoon = false;

        for (const b of order.blocks) {
            if (!hasMorning || !b.time) {
                finalTextBlocks.push(b.text);
                continue;
            }

            const [hr] = b.time.split(':');
            if (hr && parseInt(hr, 10) < 15) {
                finalTextBlocks.push(`(${b.time})\n${b.text}`);
            } else {
                if (!printedAfternoon) {
                    printedAfternoon = true;
                    finalTextBlocks.push(`(${b.time})\n${b.text}`);
                } else {
                    finalTextBlocks.push(b.text);
                }
            }
        }

        const fullText = finalTextBlocks.join('\n\n');

        const lines = fullText.split('\n');
        for (const line of lines) {
            children.push(new Paragraph({
                children: [
                    new TextRun({
                        text: line.trim(),
                        font: "Calibri",
                        size: 32
                    })
                ]
            }));
        }
    }

    const doc = new Document({
        sections: [{
            properties: {},
            children: children
        }]
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(outputPath, buffer);
    console.log(`✅ Файл Word успешно создан: ${outputPath}`);
}
