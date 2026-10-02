import { BrowserContext } from 'playwright';
import { OrderResult, MessageItem } from '../types';
import { checkOrderDate, getBannerDateCategory, isMessageActual } from '../utils/date';

function processRawItems(items: any[]): any[] {
    let lastSender = "";
    let lastPhone = "";

    const cleanStr = (s: string) => (s || '').replace(/[\u200E\u200F\u200B-\u200D\uFEFF]/g, '').trim();
    const isPhoneNum = (s: string) => {
        const digits = (s || '').replace(/\D/g, '');
        const hasLetters = /[a-zA-Zа-яА-ЯёЁ]/.test(s || '');
        return digits.length >= 7 && !hasLetters;
    };

    const processed: any[] = [];

    for (const item of items) {
        if (item.type === 'banner') {
            lastSender = "";
            lastPhone = "";
            processed.push({ type: 'banner', text: item.text });
            continue;
        }

        let time = "";
        let strPreText = "";
        let explicitDateCat: string | undefined = undefined;

        if (item.prePlainText) {
            const match = item.prePlainText.match(/\[(.*?)\]\s*(.*?):/);
            if (match) {
                const dateTime = match[1];
                const timeMatch = dateTime.match(/\d{2}:\d{2}/);
                if (timeMatch) time = timeMatch[0];
                strPreText = match[2].replace(/^~/, '');
                
                const now = new Date();
                const d = now.getDate().toString().padStart(2, '0');
                const m = (now.getMonth() + 1).toString().padStart(2, '0');
                const todayStr = `${d}.${m}`;
                
                const yesterday = new Date(now);
                yesterday.setDate(yesterday.getDate() - 1);
                const yd = yesterday.getDate().toString().padStart(2, '0');
                const ym = (yesterday.getMonth() + 1).toString().padStart(2, '0');
                const yesterdayStr = `${yd}.${ym}`;

                if (dateTime.includes(todayStr) || dateTime.toLowerCase().includes('сегодня') || dateTime.toLowerCase().includes('today')) {
                    explicitDateCat = 'today';
                } else if (dateTime.includes(yesterdayStr) || dateTime.toLowerCase().includes('вчера') || dateTime.toLowerCase().includes('yesterday')) {
                    explicitDateCat = 'yesterday';
                }
            }
        }

        let text = item.copyableText || item.rawText || '';
        if (!time) {
            const timeMatch = (item.rawText || '').match(/\d{2}:\d{2}/g);
            if (timeMatch) time = timeMatch[timeMatch.length - 1];
        }

        let strAuthor = (item.authorText || '').replace(/^~/, '');
        let strAria = (item.authorAria || '').replace(/^Возможно,\s*/i, '');

        let currentPhone = "";
        let currentSender = "";

        const c1 = cleanStr(strAuthor);
        const c2 = cleanStr(strPreText);
        const c3 = cleanStr(strAria);

        const candidates = [c1, c2, c3].filter(Boolean);

        if (candidates.length > 0) {
            for (const c of candidates) {
                if (isPhoneNum(c)) {
                    currentPhone = c;
                } else {
                    currentSender = c;
                }
            }
            lastPhone = currentPhone;
            lastSender = currentSender;
        } else {
            currentPhone = lastPhone;
            currentSender = lastSender;
        }

        processed.push({
            type: 'message',
            time: time,
            explicitDateCat: explicitDateCat,
            sender: currentSender,
            phone: currentPhone,
            text: text.trim(),
            replyTo: item.replyTo
        });
    }

    return processed;
}

function filterActualMessages(items: any[], chatDateFallback: string = ''): MessageItem[] {
    let validMessages: MessageItem[] = [];
    
    // Определяем начальную категорию по дате из списка чатов, если нет баннеров
    let fallbackCategory: 'today' | 'yesterday' | 'dayBeforeYesterday' | 'older' = 'today';
    if (chatDateFallback) {
        const cat = getBannerDateCategory(chatDateFallback);
        if (cat !== 'older') {
            fallbackCategory = cat;
        }
    }
    
    let currentCategory = fallbackCategory;
    const firstBannerIndex = items.findIndex(item => item.type === 'banner');
    
    if (firstBannerIndex !== -1) {
        // Если в чате есть баннеры, то сообщения ДО первого баннера 
        // гарантированно старше, чем дата первого баннера.
        const firstBannerCat = getBannerDateCategory(items[firstBannerIndex].text);
        if (firstBannerCat === 'today') currentCategory = 'yesterday';
        else if (firstBannerCat === 'yesterday') currentCategory = 'dayBeforeYesterday';
        else currentCategory = 'older';
    }

    for (let item of items) {
        if (item.type === 'banner') {
            currentCategory = getBannerDateCategory(item.text);
            continue; 
        }
        
        if (item.type === 'message') {
            if (!item.text) continue;
            
            const effCategory = item.explicitDateCat || currentCategory;
            
            // Проверяем актуальность с учетом категории даты, времени и текста ("на завтра")
            if (isMessageActual(effCategory, item.time, item.text)) {
                validMessages.push({
                    sender: item.sender || '',
                    phone: item.phone || '',
                    time: item.time || '',
                    text: item.text.trim(),
                    ...(item.replyTo ? { replyTo: item.replyTo } : {})
                });
            }
        }
    }
    
    return validMessages;
}

export async function parseWhatsApp(context: BrowserContext): Promise<OrderResult[]> {
    console.log('🔍 [WhatsApp] Ищем вкладку WhatsApp...');
    await new Promise(r => setTimeout(r, 2000));
    async function activateTab(p: any) {
        try {
            const client = await context.newCDPSession(p);
            const { targetInfo } = await client.send('Target.getTargetInfo');
            await client.send('Target.activateTarget', { targetId: targetInfo.targetId });
        } catch (e) {
            p.bringToFront().catch(() => {});
        }
    }

    let page = context.pages().find(p => p.url().includes('whatsapp.com'));
    if (page) {
        await activateTab(page);
    } else {
        page = await context.newPage();
        await page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded' });
        await activateTab(page);
    }

    console.log('⚙️ [WhatsApp] Применяем фильтр "Заказы"...');
    await page.locator('#additional-filters').click();
    await page.getByRole('menuitemcheckbox', { name: 'Заказы' }).click();
    await page.waitForTimeout(2000); 
    
    const allVisibleChats = page.locator('[data-testid^="list-item-"]');
    await allVisibleChats.first().waitFor({ state: 'visible' });

    let previousBottomText = "";
    while (true) {
        let count = await allVisibleChats.count();
        let bottomChat = allVisibleChats.nth(count - 1);
        let bottomText = await bottomChat.innerText();
        
        let check = checkOrderDate(bottomText);
        if (check.isActual) {
            console.log(`⬇️ [WhatsApp] Нижний чат актуален (${check.dateStr} - ${check.reason}). Скроллим вниз...`);
            await bottomChat.hover();
            await page.mouse.wheel(0, 800); 
            await page.waitForTimeout(1500); 
            
            let newBottomText = await allVisibleChats.last().innerText();
            if (newBottomText === previousBottomText) break; 
            previousBottomText = newBottomText;
        } else {
            console.log(`⏹️ [WhatsApp] Граница найдена на чате со временем: ${check.dateStr} (${check.reason})`);
            break; 
        }
    }

    let orders: OrderResult[] = []; 
    let count = await allVisibleChats.count();
    
    console.log('\n--- [WhatsApp] АНАЛИЗ ЧАТОВ НА ЭКРАНЕ ---');
    for (let i = count - 1; i >= 0; i--) {
        let chatLocator = allVisibleChats.nth(i);
        let chatText = await chatLocator.innerText();
        
        // Пытаемся достать точное название из атрибута title или игнорируем строку с "непрочитан"
        let chatName = "";
        const titleLocator = chatLocator.locator('[data-testid="cell-frame-title"] span[title]').first();
        if (await titleLocator.count() > 0) {
            chatName = (await titleLocator.getAttribute('title')) || (await titleLocator.innerText());
        }
        if (!chatName) {
            const lines = chatText.split('\n').map(l => l.trim()).filter(Boolean);
            chatName = lines.find(l => !l.toLowerCase().includes('непрочитан')) || lines[0] || '';
        }
        chatName = chatName.trim();
        
        let check = checkOrderDate(chatText);
        console.log(`[${chatName}] | Дата: ${check.dateStr} | Статус: ${check.reason}`);
        
        if (check.isActual) {
            console.log(`📥 [WhatsApp] Копируем и структурируем сообщения из: ${chatName}...`);
            await chatLocator.click();
            
            // Ждём перерисовки чата (смены заголовка) чтобы не собрать старый открытый чат
            try {
                await page.waitForFunction((expectedName) => {
                    const header = document.querySelector('#main header, [data-testid="conversation-info-header"]');
                    if (!header) return false;
                    const text = header.textContent || '';
                    return text.includes(expectedName) || expectedName.includes(text.trim());
                }, chatName, { timeout: 4000 });
            } catch (e) {
                await page.waitForTimeout(2000); // фоллбэк
            }
            
            // Функция извлечения видимых элементов
            const extractCurrentView = async () => {
                return await page.evaluate(() => {
                    const main = document.querySelector('#main');
                    if (!main) return [];
                    
                    const elements = Array.from(main.querySelectorAll('[role="row"], span[dir="auto"]'));
                    const results: any[] = [];
                    
                    for (const el of elements) {
                        if (el.getAttribute('role') === 'row') {
                            const authorEl = el.querySelector('[data-testid="author"]');
                            const copyableEl = el.querySelector('.copyable-text[data-pre-plain-text]');
                            
                            let cleanText = '';
                            let replyToObj: any = null;

                            if (copyableEl) {
                                const clone = copyableEl.cloneNode(true) as HTMLElement;
                                
                                const quotedMsg = clone.querySelector('[data-testid="quoted-message"], [aria-label="Процитированное сообщение"]');
                                if (quotedMsg) {
                                    let rSender = '';
                                    let rPhone = '';
                                    const authorEls = Array.from(quotedMsg.querySelectorAll('[data-testid="author"]'));
                                    if (authorEls.length > 0) {
                                        const texts = authorEls.map(e => (e as HTMLElement).innerText.trim()).filter(Boolean);
                                        texts.forEach(t => {
                                            const digits = t.replace(/\D/g, '');
                                            if (digits.length >= 7 && !/[a-zA-Zа-яА-ЯёЁ]/.test(t)) {
                                                rPhone = t;
                                            } else {
                                                rSender += (rSender ? ' ' : '') + t;
                                            }
                                        });
                                    }
                                    
                                    let rText = '';
                                    const textEl = quotedMsg.querySelector('[data-testid="selectable-text"], .quoted-mention');
                                    if (textEl) {
                                        rText = (textEl as HTMLElement).innerText || '';
                                    } else {
                                        const qClone = quotedMsg.cloneNode(true) as HTMLElement;
                                        Array.from(qClone.querySelectorAll('[data-testid="author"]')).forEach(e => e.remove());
                                        rText = qClone.innerText.trim();
                                    }
                                    
                                    if (rSender || rPhone || rText) {
                                        replyToObj = {
                                            sender: rSender,
                                            ...(rPhone ? { phone: rPhone } : {}),
                                            text: rText.trim()
                                        };
                                    }
                                    quotedMsg.remove();
                                }
                                
                                const selectableTextEl = clone.querySelector('[data-testid="selectable-text"]');
                                if (selectableTextEl) {
                                    cleanText = (selectableTextEl as HTMLElement).innerText || selectableTextEl.textContent || '';
                                } else {
                                    cleanText = clone.innerText || clone.textContent || '';
                                }
                            } else {
                                const clone = el.cloneNode(true) as HTMLElement;
                                
                                const quotedMsg = clone.querySelector('[data-testid="quoted-message"], [aria-label="Процитированное сообщение"]');
                                if (quotedMsg) {
                                    let rSender = '';
                                    let rPhone = '';
                                    const authorEls = Array.from(quotedMsg.querySelectorAll('[data-testid="author"]'));
                                    if (authorEls.length > 0) {
                                        const texts = authorEls.map(e => (e as HTMLElement).innerText.trim()).filter(Boolean);
                                        texts.forEach(t => {
                                            const digits = t.replace(/\D/g, '');
                                            if (digits.length >= 7 && !/[a-zA-Zа-яА-ЯёЁ]/.test(t)) {
                                                rPhone = t;
                                            } else {
                                                rSender += (rSender ? ' ' : '') + t;
                                            }
                                        });
                                    }
                                    
                                    let rText = '';
                                    const textEl = quotedMsg.querySelector('[data-testid="selectable-text"], .quoted-mention');
                                    if (textEl) {
                                        rText = (textEl as HTMLElement).innerText || '';
                                    } else {
                                        const qClone = quotedMsg.cloneNode(true) as HTMLElement;
                                        Array.from(qClone.querySelectorAll('[data-testid="author"]')).forEach(e => e.remove());
                                        rText = qClone.innerText.trim();
                                    }
                                    
                                    if (rSender || rPhone || rText) {
                                        replyToObj = {
                                            sender: rSender,
                                            ...(rPhone ? { phone: rPhone } : {}),
                                            text: rText.trim()
                                        };
                                    }
                                    quotedMsg.remove();
                                }
                                
                                cleanText = clone.innerText || clone.textContent || '';
                            }

                            results.push({
                                type: 'message',
                                authorText: authorEl ? (authorEl.textContent || '') : '',
                                authorAria: authorEl ? (authorEl.getAttribute('aria-label') || '') : '',
                                prePlainText: copyableEl ? (copyableEl.getAttribute('data-pre-plain-text') || '') : '',
                                copyableText: cleanText,
                                rawText: cleanText,
                                replyTo: replyToObj
                            });
                        } else {
                            if (!el.closest('[role="row"]')) {
                                results.push({
                                    type: 'banner',
                                    text: (el as HTMLElement).innerText || ''
                                });
                            }
                        }
                    }
                    return results;
                });
            };

            let allRawElements: any[] = [];
            const seenKeys = new Set<string>();

            // 1. Берем текущий вид (низ чата)
            let currentView = await extractCurrentView();
            currentView.forEach(item => {
                const key = item.type === 'banner' ? `banner_${item.text}` : `msg_${item.prePlainText}_${item.rawText}`;
                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    allRawElements.push(item);
                }
            });

            // 2. Скроллим вверх несколько раз
            try {
                const mainEl = page.locator('#main');
                await mainEl.click({ force: true }).catch(() => {});
                
                for (let i = 0; i < 5; i++) {
                    await page.keyboard.press('PageUp');
                    await page.waitForTimeout(1000); // Даем время на рендер
                    
                    let olderView = await extractCurrentView();
                    let newItemsForView: any[] = [];
                    
                    olderView.forEach(item => {
                        const key = item.type === 'banner' ? `banner_${item.text}` : `msg_${item.prePlainText}_${item.rawText}`;
                        if (!seenKeys.has(key)) {
                            seenKeys.add(key);
                            newItemsForView.push(item);
                        }
                    });
                    
                    if (newItemsForView.length === 0) {
                        break; // Достигли начала чата, новых элементов нет
                    }
                    
                    // Добавляем новые элементы В НАЧАЛО общего массива, сохраняя их хронологический порядок
                    allRawElements = [...newItemsForView, ...allRawElements];

                    // Оптимизация: если мы доскроллили до совсем старых дней, прекращаем скролл
                    const hasOldBanner = newItemsForView.some(item => item.type === 'banner' && getBannerDateCategory(item.text) === 'older');
                    if (hasOldBanner) {
                        break;
                    }
                }
            } catch (e) {}

            const rawElementsData = allRawElements;

            const structuredItems = processRawItems(rawElementsData);
            const filteredMessages = filterActualMessages(structuredItems, check.dateStr);
            
            if (filteredMessages.length > 0) {
                orders.push({
                    messenger: 'WhatsApp',
                    chatName: chatName,
                    messages: filteredMessages
                });
            }
        }
    }

    console.log(`✅ [WhatsApp] Сбор завершен. Получено заказов: ${orders.length}\n`);
    return orders;
}
