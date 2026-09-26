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
        .replace(/заказы|заказ|закупка|овощи\/фрукты|овощи и фрукты|овощи|фрукты|5 база/gi, '')
        .replace(/🍅|🍊|🧀/g, '') // Убираем эмодзи
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Удаляет приветствия из текста, чтобы они не попадали в заголовки.
 */
function stripGreetings(text: string): string {
    const greetingsRegex = /(?:^|\n)\s*(здравствуйте|добры[йя]\s*[,]?[ \s]*(день|вечер|ночь|утро)|доброе\s+утро|доброй\s+ночи|приветствую|привет)[!,.\s]*/gi;
    return text.replace(greetingsRegex, '\n').trim();
}

/**
 * Проверка: является ли строка перечислением товара
 * Если первая строка начинается с цифр и кг/г/шт, это товар, а не название точки.
 */
function isProductLine(line: string): boolean {
    return /^\s*\d+[\s\,\.]*(кг|г|гр|шт|уп|ящ|вед|л|пач)/i.test(line) || /добав/i.test(line) || /^\s*(укроп|петрушка|кинза|лук|чеснок|помидор|огурец|гриб|перец|порей|шампиньон|кабач|баклажан|карто|морко|капуст|салат|руккола|шпинат|яблок|апельсин|мандарин|лимон|банан|ягод|черри|томат|айсберг|романо|вешенк|сельдерей|редис|авокадо|ананас|манго|киви|грейпфрут|мята|базилик|розмарин|тимьян|кинза|микс|ростки|корн)/i.test(line);
}

export async function exportToWord(orders: OrderResult[], outputPath: string) {
    const configPath = path.resolve(process.cwd(), 'cafes_config.json');
    if (!fs.existsSync(configPath)) {
        console.error('Конфиг cafes_config.json не найден!');
        return;
    }
    
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    interface VirtualOrder {
        header: string;
        text: string;
        time: string;
        sender: string;
        chatName: string;
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

        let messages = [...orderBlock.messages];
        const cleanChatName = cleanBrandName(chatConfig.name);

        // Правило: merge_consecutive_by_author (WhatsApp - склейка подряд идущих сообщений)
        if (chatConfig.merge_consecutive_by_author) {
            const merged: MessageItem[] = [];
            for (const msg of messages) {
                if (merged.length > 0 && merged[merged.length - 1].sender === msg.sender) {
                    merged[merged.length - 1].text += '\n' + msg.text;
                } else {
                    merged.push({ ...msg });
                }
            }
            messages = merged;
        }

        for (const msg of messages) {
            msg.text = stripGreetings(msg.text);
            if (!msg.text) continue;

            // Правило: Разделение по "Отдельно" или по под-точкам
            let rawBlocks = [msg.text];
            
            // Если в тексте прямо сказано "Заказ бар:" и "Заказ кухня:"
            if (msg.text.match(/Заказ бар:/i) && msg.text.match(/Заказ кухня:/i)) {
                // Разделяем по слову "Заказ кухня:"
                const parts = msg.text.split(/Заказ кухня:/i);
                rawBlocks = [parts[0].trim(), "кухня:\n" + parts[1].trim()];
                if (rawBlocks[0].toLowerCase().includes('заказ бар:')) {
                    rawBlocks[0] = rawBlocks[0].replace(/Заказ бар:/i, 'бар:\n');
                }
            }
            // Разделение по слову "Отдельно" внутри текста
            else if (msg.text.match(/\n\s*Отдельно/i)) {
                const parts = msg.text.split(/\n\s*Отдельно/i);
                if (parts.length === 2) {
                    rawBlocks = [parts[0].trim(), "Отдельно\n" + parts[1].trim()];
                }
            } 
            // Правило: Разделение по известным адресам филиалов (branches)
            else if (chatConfig.branches && chatConfig.branches.length > 0) {
                const lines = msg.text.split('\n');
                let currentBlock: string[] = [];
                rawBlocks = [];

                for (let line of lines) {
                    if (!line.trim()) continue;

                    let matchedBranch = null;
                    const lowLine = line.trim().toLowerCase();
                    
                    // Строка может считаться адресом, если она короткая и не является товаром
                    if (lowLine.split(' ').length <= 6 && !isProductLine(line)) {
                        for (const branch of chatConfig.branches) {
                            if (branch.aliases.some((a: string) => lowLine.includes(a.toLowerCase()))) {
                                matchedBranch = branch.name;
                                break;
                            }
                        }
                    }

                    if (matchedBranch) {
                        if (currentBlock.length > 0) {
                            rawBlocks.push(currentBlock.join('\n'));
                            currentBlock = [];
                        }
                        // Заменяем то, что написал клиент, на эталонное название из конфига!
                        currentBlock.push(matchedBranch);
                    } else {
                        currentBlock.push(line);
                    }
                }
                if (currentBlock.length > 0) {
                    rawBlocks.push(currentBlock.join('\n'));
                }
            }
            // Правило: Разделение по суб-заказам (split_sub_orders)
            else if (chatConfig.split_sub_orders) {
                const raw = msg.text.split(/\n\s*\n/).map(s => s.trim()).filter(s => s.length > 0);
                rawBlocks = [];
                for (let i = 0; i < raw.length; i++) {
                    // Если блок состоит из одной короткой строки (похоже на повисшее название точки)
                    if (raw[i].split('\n').length === 1 && raw[i].split(' ').length <= 4 && !isProductLine(raw[i]) && i < raw.length - 1) {
                        raw[i + 1] = raw[i] + '\n' + raw[i + 1];
                    } else {
                        rawBlocks.push(raw[i]);
                    }
                }
            }

            for (const block of rawBlocks) {
                let header = '';
                let textBody = block;
                let isSeparateBlock = false;

                const lines = block.split('\n').map(l => l.trim()).filter(l => l);
                if (lines.length === 0) continue;

                // Если этот блок был отсечен как "Отдельно"
                if (lines[0].toLowerCase().includes('отдельно')) {
                    isSeparateBlock = true;
                    lines.shift(); // убираем слово Отдельно из списка
                    textBody = lines.join('\n');
                }

                // Правило: is_forum (Telegram)
                if (chatConfig.is_forum && orderBlock.chatName.includes('→')) {
                    const parts = orderBlock.chatName.split('→');
                    let topicName = parts[parts.length - 1].trim().replace(/\n/g, ' ');
                    topicName = topicName.replace(/^В\s+/i, ''); // убираем предлог "В "
                    header = `${cleanChatName} ${topicName}`;
                } 
                // Правило: shared_chat или split_sub_orders/branches
                else if (chatConfig.shared_chat || chatConfig.split_sub_orders || (chatConfig.branches && chatConfig.branches.length > 0)) {
                    let firstLine = lines[0];
                    
                    // Fallback: Если первая строка - товар, значит точку забыли указать
                    if (isProductLine(firstLine)) {
                        header = cleanChatName;
                    } else if (lines.length === 1) {
                        // Если в блоке всего одна строка
                        header = cleanChatName;
                        textBody = lines[0];
                    } else {
                        if (firstLine.endsWith(':')) firstLine = firstLine.slice(0, -1).trim();
                        
                        const cleanForCheck = firstLine.replace(/[:,]/g, '').trim().toLowerCase();
                        const blacklist = ['адам', 'сегодняшнюю', 'завтрашнюю', 'спасибо', 'пожалуйста', 'ок', 'хорошо', 'да', 'нет', 'на завтра', 'добавьте', 'добавка', 'дозаказ', 'в плазу', 'ребят', 'ребята', 'девчат', 'девочки', 'коллеги', 'подскажите', 'вопрос', 'внимание'];
                        
                        if (blacklist.includes(cleanForCheck)) {
                            header = cleanChatName;
                        } else {
                            header = firstLine.replace(/\n/g, ' ');
                            textBody = lines.slice(1).join('\n').trim();
                            if (chatConfig.prefix_brand) {
                                header = `${cleanChatName} ${header}`;
                            }
                        }
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

                if (isSeparateBlock) {
                    header = `${header} Отдельно`;
                }

                finalOrders.push({
                    header: header,
                    text: textBody,
                    time: msg.time,
                    sender: msg.sender,
                    chatName: orderBlock.chatName
                });
            }
        }
    }

    // --- ЭТАП 2: Добавки без цитирования (привязка по автору) ---
    const linkedOrders: VirtualOrder[] = [];
    for (const vo of finalOrders) {
        const isAddition = vo.text.toLowerCase().includes('добав') || vo.text.toLowerCase().includes('дозаказ');
        const isProductOnly = isProductLine(vo.text.split('\n')[0]);
        const isDefaultHeader = vo.header === cleanBrandName(vo.chatName);
        
        if (isAddition || (isProductOnly && isDefaultHeader)) {
            // Ищем последний заказ этого же автора
            for (let i = linkedOrders.length - 1; i >= 0; i--) {
                if (linkedOrders[i].sender === vo.sender) {
                    vo.header = linkedOrders[i].header;
                    break;
                }
            }
        }

        linkedOrders.push(vo);
    }

    // --- ЭТАП 3: Группировка (merge_same_spot) ---
    interface GroupedOrder {
        header: string;
        blocks: { time: string, text: string }[];
    }
    const groupedOrders: GroupedOrder[] = [];
    
    for (const vo of linkedOrders) {
        let mergeSetting = true; // По умолчанию сливаем
        
        const isSeparate = vo.header.toLowerCase().includes('отдельно') || vo.text.toLowerCase().includes('отдельной накладной');
        
        let chatConfig: any = {};
        for (const platform of Object.values(configData)) {
            if ((platform as any).chats) {
                const f = (platform as any).chats.find((c: any) => c.name === vo.chatName);
                if (f) {
                    chatConfig = f;
                    break;
                }
            }
        }
        
        if (chatConfig.merge_same_spot === false) {
            mergeSetting = false;
        }

        let existing = null;
        if (mergeSetting && !isSeparate) {
            existing = groupedOrders.find(g => g.header === vo.header);
        }

        if (existing) {
            existing.blocks.push({ time: vo.time, text: vo.text });
        } else {
            groupedOrders.push({
                header: vo.header,
                blocks: [{ time: vo.time, text: vo.text }]
            });
        }
    }

    // Применяем двоеточия ко всем заголовкам в конце
    for (const go of groupedOrders) {
        if (!go.header.endsWith(':')) go.header += ':';
    }


    // --- ЭТАП 4: Генерация Word документа ---
    const children: Paragraph[] = [];

    for (const order of groupedOrders) {
        // Заголовок заказа (Жирный, Calibri 16)
        children.push(new Paragraph({
            children: [
                new TextRun({
                    text: order.header,
                    bold: true,
                    font: "Calibri",
                    size: 32 // Размер указывается в полу-пунктах (16 pt = 32)
                })
            ],
            spacing: { before: 240, after: 120 } // Отступы до и после
        }));

        // Текст заказа (Обычный, Calibri 16)
        // Проверяем, есть ли утренние сообщения
        const hasMorning = order.blocks.some(b => {
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
