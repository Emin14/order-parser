import { BrowserContext, Page } from 'playwright';
import { OrderResult, MessageItem } from '../types';
import { parseVkDate, getBannerDateCategory, isMessageActual } from '../utils/date';

/**
 * Извлечение сырых элементов (баннеров и сообщений) из открытого диалога ВКонтакте
 */
function extractVkElementsFromDom(): any[] {
    // Ограничиваем область активным окном чата (чтобы не захватывать элементы левой боковой панели диалогов)
    const chatRoot = document.querySelector('.ConvoMain, [class*="ConvoMain"], .ConvoHistory, [class*="ConvoHistory"], .im-page--chat-body') 
        || document.querySelector('[class*="ConvoMessage"]')?.closest('[data-scrollbar="scrollable"]')
        || document.querySelector('.ConvoHeader')?.parentElement
        || document;

    // Собираем сами сообщения как верхние контейнеры сообщений (чтобы не было вложенных дубликатов)
    const messageWrappers = Array.from(chatRoot.querySelectorAll(
        '[class*="ConvoMessage"][class*="wrapper"], [class*="ConvoMessageWithoutBubble"], [class*="ConvoMessageWithBubble"], [class*="ConvoMessage"]'
    )).filter((el, idx, arr) => {
        if (el.closest('[class*="pinned"], [class*="Pinned"], [class*="pin"], .ui_scroll_fixed')) return false;
        return el.querySelector('.MessageText, [class*="Message__text"]') !== null &&
               !el.parentElement?.closest('[class*="ConvoMessage"]');
    });

    const dateSeparators = Array.from(chatRoot.querySelectorAll(
        '.DateSeparator, [class*="DateSeparator"]'
    )).filter(el => !el.className.includes('StickyDate') && !el.className.includes('sticky-date'));

    const domItems: { el: HTMLElement; isBanner: boolean }[] = [];
    
    for (const sep of dateSeparators) {
        domItems.push({ el: sep as HTMLElement, isBanner: true });
    }
    
    // Текстовые блоки с названиями дат ("вчера", "сегодня", "22 сентября")
    const bannerCandidates = Array.from(chatRoot.querySelectorAll('div, span, time')).filter(el => {
        if (el.closest('.StickyDateSeparator, [class*="StickyDate"], [class*="sticky-date"]')) return false;

        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (txt.length > 25) return false;
        
        return /^(сегодня|вчера|\d{1,2}\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря))(\s+\d{4})?$/i.test(txt);
    });
    for (const tn of bannerCandidates) {
        if (!dateSeparators.some(d => d.contains(tn))) {
            domItems.push({ el: tn as HTMLElement, isBanner: true });
        }
    }

    for (const msg of messageWrappers) {
        domItems.push({ el: msg as HTMLElement, isBanner: false });
    }

    // Сортируем элементы строго по их расположению в документе сверху вниз
    domItems.sort((a, b) => {
        const pos = a.el.compareDocumentPosition(b.el);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
    });

    // Пытаемся найти плавающую дату (StickyDate), которая всегда видна сверху
    // Мы не используем её как defaultBanner для сообщений, чтобы не 'загрязнить' их ложной датой до того, как появится реальный разделитель.
    // Но мы можем использовать её для раннего выхода из цикла скролла.

    const results: any[] = [];
    let currentBanner = '';

    for (const item of domItems) {
        if (item.isBanner) {
            const rawText = item.el.getAttribute('aria-label') || item.el.innerText || item.el.textContent || '';
            const trimmed = rawText.trim();
            if (trimmed) {
                currentBanner = trimmed;
                const last = results[results.length - 1];
                if (!last || last.type !== 'banner' || last.text !== trimmed) {
                    results.push({
                        type: 'banner',
                        text: trimmed
                    });
                }
            }
        } else {
            const el = item.el;
            const authorEl = el.querySelector('.PeerTitle__title, .ConvoMessageHeader__authorLink, [class*="authorLink"]');
            const textEl = el.querySelector('.MessageText, [class*="Message__text"]');
            const timeEl = el.querySelector('.ConvoMessageInfoWithoutBubbles__date, [class*="date"], [class*="time"], [class*="Time"], time');

            let cleanText = '';
            let replyTo: any = undefined;

            const replyNode = el.querySelector('.Reply, [data-testid="vkme_replied_message"], [class*="reply"], .ConvoMessageWithoutBubble__reply');
            if (replyNode) {
                const replyTitle = replyNode.querySelector('.Reply__author, [class*="author"], .PeerTitle__title');
                const replySubtitle = replyNode.querySelector('.Reply__content, .MessagePreview, [class*="content"]');
                
                const rSender = replyTitle ? (replyTitle.textContent || '').trim() : '';
                const rText = replySubtitle ? (replySubtitle.textContent || '').trim() : '';
                
                if (rSender || rText) {
                    replyTo = {
                        sender: rSender,
                        phone: '',
                        text: rText
                    };
                }
            }

            const textNodes = Array.from(el.querySelectorAll('.MessageText, [class*="Message__text"]'));
            if (textNodes.length > 0) {
                let combinedText = '';
                for (const tNode of textNodes) {
                    const clone = tNode.cloneNode(true) as HTMLElement;
                    const reply = clone.querySelector('[class*="Reply"], [class*="quote"]');
                    if (reply) reply.remove();
                    
                    clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
                    const txt = (clone.innerText || clone.textContent || '').trim();
                    if (txt) {
                        combinedText += (combinedText ? '\n---\n' : '') + txt;
                    }
                }
                cleanText = combinedText;
            }

            // Пытаемся вытащить точную дату из всплывающих подсказок (title, aria-label) самого сообщения
            let explicitBannerDate = '';
            const dateAttrs = Array.from(el.querySelectorAll('[aria-label], [title], [data-time]'));
            for (const dEl of [el, ...dateAttrs]) {
                const title = dEl.getAttribute('title') || '';
                const aria = dEl.getAttribute('aria-label') || '';
                const txt = (title + ' ' + aria).toLowerCase();
                
                if (txt.includes('сегодня')) { explicitBannerDate = 'сегодня'; break; }
                if (txt.includes('вчера')) { explicitBannerDate = 'вчера'; break; }
                const m = txt.match(/(\d{1,2}\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря))/);
                if (m) { explicitBannerDate = m[1]; break; }
            }

            let timeStr = timeEl ? (timeEl.textContent || '').trim() : '';
            if (!timeStr) {
                const timeMatch = (el.innerText || el.textContent || '').match(/\b(\d{1,2}:\d{2})\b/);
                if (timeMatch) timeStr = timeMatch[1];
            }

            if (cleanText.trim()) {
                const msgObj: any = {
                    type: 'message',
                    sender: authorEl ? (authorEl.textContent || '').trim() : '',
                    time: timeStr,
                    text: cleanText.trim(),
                    bannerDate: explicitBannerDate || currentBanner
                };
                if (replyTo) {
                    msgObj.replyTo = replyTo;
                }
                results.push(msgObj);
            }
        }
    }
    return results;
}

/**
 * Сортировка сырых сообщений по хронологии: старшие даты -> вчера -> сегодня, внутри дня по времени
 */
function sortMessagesChronologically(messages: any[], fallbackCategory: string = 'today'): any[] {
    return messages.filter(m => m.type === 'message');
}

/**
 * Фильтрация сообщений по правилам смены
 */
function filterActualVkMessages(items: any[], chatName: string, chatDateFallback: string = ''): MessageItem[] {
    let validMessages: MessageItem[] = [];
    
    // Определяем начальную категорию даты на случай, если первое сообщение выше первого баннера
    let fallbackCategory: 'today' | 'yesterday' | 'older' = 'today';
    if (chatDateFallback) {
        const parsed = parseVkDate(chatDateFallback);
        if (parsed.reason.includes('сегодня') || parsed.reason.includes('Только что') || parsed.reason.includes('минуты')) {
            fallbackCategory = 'today';
        } else if (parsed.reason.includes('Вчера') || parsed.reason.includes('вчера')) {
            fallbackCategory = 'yesterday';
        }
    }

    let lastSender = "";

    for (const item of items) {
        if (item.type !== 'message') continue;
        if (!item.text) continue;

        if (item.sender) {
            lastSender = item.sender;
        }

        let msgCategory = item.bannerDate ? getBannerDateCategory(item.bannerDate) : fallbackCategory;

        const isActual = isMessageActual(msgCategory, item.time, item.text);
        console.log(`   🔎 [VK-FILTER] [${chatName}] time=${item.time}, text="${item.text.slice(0, 15)}...", bannerDate=${item.bannerDate}, cat=${msgCategory} -> isActual=${isActual}`);

        if (isActual) {
            const msgObj: any = {
                sender: item.sender || lastSender || chatName,
                phone: '',
                time: item.time || '',
                text: item.text.trim()
            };
            if (item.replyTo) {
                msgObj.replyTo = item.replyTo;
            }
            validMessages.push(msgObj);
        }
    }

    return validMessages;
}

/**
 * Закрытие активного диалога по крестику
 */
async function closeActiveVkChat(page: Page) {
    try {
        const closeBtn = page.locator('button[aria-label="Закрыть"].ConvoHeader__back, button.ConvoHeader__back, button[aria-label="Закрыть"].ConvoHeader__action, .ConvoHeader button[aria-label="Закрыть"]').first();
        if (await closeBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
            console.log('   🔙 [VK] Закрываем диалог (нажимаем на крестик)...');
            await closeBtn.evaluate((el: HTMLElement) => el.click());
            await page.waitForTimeout(600);
            return;
        }
    } catch (e) {}

    // Fallback в DOM
    await page.evaluate(() => {
        const btn = document.querySelector('button[aria-label="Закрыть"], button.ConvoHeader__back, button.ConvoHeader__action') as HTMLElement;
        if (btn) btn.click();
    }).catch(() => {});
    await page.waitForTimeout(600);
}

/**
 * Получение центра активного контейнера сообщений для наведения мыши и скролла
 */
async function getChatHistoryScrollBox(page: Page): Promise<{ x: number, y: number } | null> {
    return await page.evaluate(() => {
        const targets = document.querySelectorAll('[class*="ConvoMessage"], [class*="DateSeparator"], .MessageText');
        for (const target of Array.from(targets)) {
            const scrollable = target.closest('[data-scrollbar="scrollable"]') as HTMLElement;
            if (scrollable) {
                const rect = scrollable.getBoundingClientRect();
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }

            let parent = target.parentElement;
            while (parent && parent !== document.body) {
                const style = window.getComputedStyle(parent);
                if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) {
                    const rect = parent.getBoundingClientRect();
                    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                }
                parent = parent.parentElement;
            }

            const fallback = target.closest('.ConvoHistory, [class*="ConvoHistory"], .ConvoMain, [class*="ConvoMain"]') as HTMLElement;
            if (fallback) {
                const rect = fallback.getBoundingClientRect();
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
        }

        return null;
    });
}

/**
 * Сбор сообщений из открытого чата:
 * 1. Наводим мышь на окно сообщений и аккуратно поднимаемся вверх до начала смены.
 *    На КАЖДОМ шаге скролла вверх аккумулируем сообщения в Map, чтобы VirtualScroll ничего не потерял.
 * 2. Затем спускаемся вниз до самого конца диалога, также аккумулируя все сообщения.
 * 3. Сортируем всё хронологически и фильтруем по правилам смены.
 */
async function extractMessagesFromOpenChat(page: Page, chatName: string, chatDateStr: string): Promise<MessageItem[]> {
    // Ждем появления хотя бы одного сообщения в открытом чате
    await page.locator('[class*="ConvoMessage"], .MessageText').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

    // Наводим курсор на открытый чат
    const firstMsgLoc = page.locator('.ConvoMain [class*="ConvoMessage"], .ConvoHistory [class*="ConvoMessage"], [class*="ConvoMessage"], .MessageText').first();
    await firstMsgLoc.hover({ timeout: 2000 }).catch(async () => {
        const scrollBox = await getChatHistoryScrollBox(page);
        if (scrollBox) await page.mouse.move(scrollBox.x, scrollBox.y);
    });

    console.log(`   📜 [VK] Прокручиваем историю [${chatName}] вверх к началу смены...`);

    // Общее хранилище всех сырых сообщений, строго отсортированных (top-to-bottom)
    const masterList: { key: string; item: any }[] = [];
    const registerItems = (items: any[]) => {
        let anchorIndex = -1; // -1 означает конец списка (самые новые)
        
        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            const key = item.type === 'message' && item.text ? `${item.sender}_${item.time}_${item.text}` : `banner_${item.text}`;
            if (!key) continue;
            
            const existingIdx = masterList.findIndex(x => x.key === key);
            
            if (existingIdx !== -1) {
                if (!masterList[existingIdx].item.bannerDate && item.bannerDate) {
                    masterList[existingIdx].item.bannerDate = item.bannerDate;
                }
                anchorIndex = existingIdx;
            } else {
                const entry = { key, item };
                if (anchorIndex === -1) {
                    masterList.push(entry);
                    anchorIndex = masterList.length - 1;
                } else {
                    masterList.splice(anchorIndex, 0, entry);
                }
            }
        }
    };

    let prevFirstMessageKey = '';
    let unchangedTopCount = 0;

    // 1. Скроллим ВВЕРХ
    for (let step = 1; step <= 40; step++) {
        const currentElements = await page.evaluate(extractVkElementsFromDom);
        registerItems(currentElements);

        // Проверяем: видна ли дата старше вчера?
        const stickyText = await page.evaluate(() => {
            const el = document.querySelector('.StickyDateSeparator, [class*="StickyDate"], [class*="sticky-date"]');
            return el ? (el.textContent || el.getAttribute('aria-label') || '').trim() : '';
        });
        
        // console.log(`   🔎 [VK-DEBUG] Шаг ${step}: stickyText="${stickyText}"`);

        // Проверяем: достигли ли мы границы (старые сообщения или вчера до 06:00)?
        const firstMsgForCheck = currentElements.find(item => item.type === 'message');
        const reachedBoundary = (() => {
            if (!firstMsgForCheck || !firstMsgForCheck.time) return false;
            const cat = firstMsgForCheck.bannerDate ? getBannerDateCategory(firstMsgForCheck.bannerDate) : '';
            if (cat === 'older') return true;
            if (cat === 'yesterday') {
                const m = firstMsgForCheck.time.match(/(\d{1,2}):(\d{2})/);
                if (m && parseInt(m[1], 10) < 6) return true;
            }
            return false;
        })();

        if (firstMsgForCheck) {
            // console.log(`   🔎 [VK-DEBUG] Шаг ${step}: Верхнее сообщение в DOM: time=${firstMsgForCheck.time}, bannerDate=${firstMsgForCheck.bannerDate}, cat=${firstMsgForCheck.bannerDate ? getBannerDateCategory(firstMsgForCheck.bannerDate) : 'none'}`);
        }

        if (reachedBoundary) {
            console.log(`   ⏹️ [VK] Достигнута граница (старше вчера или утро вчера) по сообщениям в DOM (шаг ${step})`);
            break;
        }

        // Проверяем, не уперлись ли в самый верх истории (текст верхнего сообщения не меняется 2 раза подряд)
        const firstMsg = currentElements.find(item => item.type === 'message');
        const firstMsgKey = firstMsg ? `${firstMsg.sender}_${firstMsg.time}_${firstMsg.text.slice(0, 30)}` : '';
        if (firstMsgKey && firstMsgKey === prevFirstMessageKey) {
            unchangedTopCount++;
            if (unchangedTopCount >= 4) {
                console.log(`   ⏹️ [VK] Достигнут самый верх чата (шаг ${step})`);
                break;
            }
        } else {
            unchangedTopCount = 0;
            prevFirstMessageKey = firstMsgKey;
        }

        // Скроллим вверх плавно, чтобы не перепрыгнуть виртуальные элементы
        await page.mouse.wheel(0, -400);
        await page.evaluate(() => {
            const msgs = document.querySelectorAll('[class*="ConvoMessage"], .MessageText');
            for (const msg of Array.from(msgs)) {
                let cur = msg?.parentElement;
                let found = false;
                while (cur && cur !== document.body) {
                    const s = window.getComputedStyle(cur);
                    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && cur.scrollHeight > cur.clientHeight) {
                        cur.scrollTop -= 400;
                        cur.dispatchEvent(new Event('scroll', { bubbles: true }));
                        found = true;
                        break;
                    }
                    cur = cur.parentElement;
                }
                if (found) break;
            }
        }).catch(() => {});

        await page.waitForTimeout(700);
    }

    // 2. Скроллим ВНИЗ до самого конца диалога, фиксируя всё по пути
    console.log(`   📜 [VK] Прокручиваем историю [${chatName}] вниз к свежим сообщениям...`);

    let prevLastMessageKey = '';
    let unchangedBottomCount = 0;

    for (let step = 1; step <= 25; step++) {
        await page.mouse.wheel(0, 800);
        await page.keyboard.press('PageDown').catch(() => {});
        await page.evaluate(() => {
            const msgs = document.querySelectorAll('[class*="ConvoMessage"], .MessageText');
            for (const msg of Array.from(msgs)) {
                let cur = msg?.parentElement;
                let found = false;
                while (cur && cur !== document.body) {
                    const s = window.getComputedStyle(cur);
                    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && cur.scrollHeight > cur.clientHeight) {
                        cur.scrollTop += 800;
                        cur.dispatchEvent(new Event('scroll', { bubbles: true }));
                        found = true;
                        break;
                    }
                    cur = cur.parentElement;
                }
                if (found) break;
            }
        }).catch(() => {});

        await page.waitForTimeout(500);

        const currentElements = await page.evaluate(extractVkElementsFromDom);
        registerItems(currentElements);

        const messages = currentElements.filter(item => item.type === 'message');
        const lastMsg = messages[messages.length - 1];
        const lastMsgKey = lastMsg ? `${lastMsg.sender}_${lastMsg.time}_${lastMsg.text.slice(0, 30)}` : '';
        if (lastMsgKey && lastMsgKey === prevLastMessageKey) {
            unchangedBottomCount++;
            if (unchangedBottomCount >= 4) {
                break;
            }
        } else {
            unchangedBottomCount = 0;
            prevLastMessageKey = lastMsgKey;
        }
    }

    // 3. Сортируем все собранные сообщения хронологически и фильтруем по правилам смены
    let fallbackCategory = 'today';
    if (chatDateStr) {
        const parsed = parseVkDate(chatDateStr);
        if (parsed.reason.includes('Вчера') || parsed.reason.includes('вчера')) {
            fallbackCategory = 'yesterday';
        }
    }
    const rawItems = masterList.map(x => x.item);
    const sortedRawItems = sortMessagesChronologically(rawItems, fallbackCategory);
    return filterActualVkMessages(sortedRawItems, chatName, chatDateStr);
}

export async function parseVk(context: BrowserContext): Promise<OrderResult[]> {
    console.log('🔍 [VK] Ищем вкладку ВКонтакте...');
    await new Promise(r => setTimeout(r, 1000));

    let page = context.pages().find(p => p.url().includes('vk.com') || p.url().includes('vk.me'));
    if (page) {
        await page.bringToFront();
        if (!page.url().includes('/im') && !page.url().includes('web.vk.com')) {
            await page.goto('https://vk.com/im', { waitUntil: 'domcontentloaded' });
        }
    } else {
        page = await context.newPage();
        await page.goto('https://vk.com/im', { waitUntil: 'domcontentloaded' });
        await page.bringToFront();
    }

    console.log('⚙️ [VK] Переключаемся на папку "Заказы"...');
    const ordersTab = page.locator('.OrganiserViewHorizontal__item, [data-testid^="me_folder_tab_"]').filter({ hasText: 'Заказы' });
    await ordersTab.waitFor({ state: 'visible', timeout: 15000 });
    await ordersTab.click();
    await page.waitForTimeout(2000);

    // Если был открыт какой-то чат — закрываем его
    await closeActiveVkChat(page);

    const chatItems = page.locator('button[data-testid="vkme_convo_list_item"]');
    await chatItems.first().waitFor({ state: 'visible', timeout: 10000 });

    // 1. Сканируем список вниз, чтобы найти границу неактуальных диалогов
    console.log('\n--- [VK] ЭТАП 1: СКРОЛЛ ВНИЗ ДО ГРАНИЦЫ ---');
    let previousBottomText = "";
    while (true) {
        let count = await chatItems.count();
        if (count === 0) break;
        let bottomChat = chatItems.nth(count - 1);
        
        const dateText = await bottomChat.evaluate((el: HTMLElement) => {
            const dateSpan = el.querySelector('.ConvoListItem__date ~ .vkuiVisuallyHidden__host, .ConvoListItem__message > .vkuiVisuallyHidden__host:last-of-type') as HTMLElement;
            const fallbackDateSpan = el.querySelector('.ConvoListItem__date') as HTMLElement;
            return dateSpan ? (dateSpan.innerText || dateSpan.textContent || '').trim() : (fallbackDateSpan ? fallbackDateSpan.innerText.trim() : '');
        }).catch(() => '');

        let check = parseVkDate(dateText);

        if (check.isActual) {
            console.log(`⬇️ [VK] Нижний чат актуален (${check.dateStr} - ${check.reason}). Скроллим вниз...`);
            await bottomChat.hover().catch(() => {});
            await page.mouse.wheel(0, 500);
            await page.waitForTimeout(1000);

            let newCount = await chatItems.count();
            let newBottom = chatItems.nth(newCount - 1);
            let newBottomText = await newBottom.innerText().catch(() => '');
            if (newBottomText === previousBottomText) break;
            previousBottomText = newBottomText;
        } else {
            console.log(`⏹️ [VK] Граница найдена на нижнем чате: ${check.dateStr} (${check.reason})`);
            break;
        }
    }

    console.log('\n--- [VK] ЭТАП 2: СБОР ЧАТОВ СНИЗУ ВВЕРХ ---');
    
    let previousTopText = "";
    let reachedTop = false;
    const uniqueOrders = new Map<string, OrderResult>();

    while (!reachedTop) {
        let count = await chatItems.count();
        if (count === 0) break;

        let processedAnyInThisScroll = false;

        // Идем СНИЗУ ВВЕРХ (от старых к новым)
        for (let i = count - 1; i >= 0; i--) {
            let chat = chatItems.nth(i);
            
            const isVisible = await chat.isVisible().catch(() => false);
            if (!isVisible) continue;

            const { chatName, dateText } = await chat.evaluate((el: HTMLElement) => {
                const titleEl = el.querySelector('.ConvoTitle__author, .ConvoTitle__title, .PeerTitle__title') as HTMLElement;
                const name = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : '';

                const dateSpan = el.querySelector('.ConvoListItem__date ~ .vkuiVisuallyHidden__host, .ConvoListItem__message > .vkuiVisuallyHidden__host:last-of-type') as HTMLElement;
                const fallbackDateSpan = el.querySelector('.ConvoListItem__date') as HTMLElement;

                const date = dateSpan ? (dateSpan.innerText || dateSpan.textContent || '').trim() : (fallbackDateSpan ? fallbackDateSpan.innerText.trim() : '');
                return { chatName: name || `VK Чат`, dateText: date };
            }).catch(() => ({ chatName: `VK Чат`, dateText: '' }));

            let check = parseVkDate(dateText);
            
            // Пропускаем старые
            if (!check.isActual) continue;

            // Нашли необработанный актуальный чат
            if (!uniqueOrders.has(chatName)) {
                console.log(`\n[${chatName}] | Дата: ${check.dateStr} | Статус: ${check.reason}`);
                console.log(`📥 [VK] Открываем: ${chatName}...`);
                
                await chat.scrollIntoViewIfNeeded().catch(() => {});
                await chat.evaluate((el: HTMLElement) => el.click());
                await page.waitForTimeout(1200); 

                const order = await extractMessagesFromOpenChat(page, chatName, check.dateStr);
                if (order && order.length > 0) {
                    uniqueOrders.set(chatName, { messenger: 'VK', chatName, messages: order });
                } else {
                    uniqueOrders.set(chatName, { messenger: 'VK', chatName, messages: [] });
                }

                await closeActiveVkChat(page);

                processedAnyInThisScroll = true;
                // Прерываем цикл, чтобы начать с самого низа текущего DOM на случай сдвигов
                break; 
            }
        }

        // Если не нашли новых чатов, скроллим вверх
        if (!processedAnyInThisScroll) {
            let topChat = chatItems.first();
            await topChat.hover().catch(() => {});
            console.log(`⬆️ [VK] Скроллим вверх...`);
            await page.mouse.wheel(0, -600); 
            await page.waitForTimeout(1500);

            const { dateText: currentTopText } = await chatItems.first().evaluate((el: HTMLElement) => {
                const titleEl = el.querySelector('.ConvoTitle__author, .ConvoTitle__title, .PeerTitle__title') as HTMLElement;
                return { dateText: titleEl ? titleEl.innerText : '' };
            }).catch(() => ({ dateText: '' }));

            if (currentTopText === previousTopText) {
                console.log(`⬆️ [VK] Достигнут самый верх списка чатов.`);
                reachedTop = true;
            }
            previousTopText = currentTopText;
        }
    }

    const orders = Array.from(uniqueOrders.values()).filter(o => o.messages.length > 0);
    console.log(`\n✅ [VK] Сбор завершен. Получено заказов: ${orders.length}\n`);
    return orders;
}
