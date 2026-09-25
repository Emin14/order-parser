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
        return el.querySelector('.MessageText, [class*="Message__text"]') !== null &&
               !el.parentElement?.closest('[class*="ConvoMessage"]');
    });

    const dateSeparators = Array.from(chatRoot.querySelectorAll(
        '.StickyDateSeparator, .DateSeparator, [class*="DateSeparator"], [class*="StickyDate"]'
    ));

    const domItems: { el: HTMLElement; isBanner: boolean }[] = [];
    
    for (const sep of dateSeparators) {
        domItems.push({ el: sep as HTMLElement, isBanner: true });
    }
    
    // Текстовые блоки с названиями дат ("вчера", "сегодня", "22 сентября")
    const bannerCandidates = Array.from(chatRoot.querySelectorAll('div, span, time')).filter(el => {
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
            if (textEl) {
                const clone = textEl.cloneNode(true) as HTMLElement;
                const reply = clone.querySelector('[class*="Reply"], [class*="quote"]');
                if (reply) reply.remove();
                
                clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
                cleanText = clone.innerText || clone.textContent || '';
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
                results.push({
                    type: 'message',
                    sender: authorEl ? (authorEl.textContent || '').trim() : '',
                    time: timeStr,
                    text: cleanText.trim(),
                    bannerDate: explicitBannerDate || currentBanner
                });
            }
        }
    }
    return results;
}

/**
 * Сортировка сырых сообщений по хронологии: старшие даты -> вчера -> сегодня, внутри дня по времени
 */
function sortMessagesChronologically(messages: any[], fallbackCategory: string = 'today'): any[] {
    const categoryOrder: Record<string, number> = {
        'older': 0,
        'yesterday': 1,
        'today': 2
    };

    const getMinutes = (timeStr: string): number => {
        const m = (timeStr || '').match(/(\d{1,2}):(\d{2})/);
        if (!m) return 0;
        return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    };

    return messages
        .filter(m => m.type === 'message')
        .sort((a, b) => {
            const catA = a.bannerDate ? getBannerDateCategory(a.bannerDate) : fallbackCategory;
            const catB = b.bannerDate ? getBannerDateCategory(b.bannerDate) : fallbackCategory;
            
            const orderA = categoryOrder[catA] ?? 2;
            const orderB = categoryOrder[catB] ?? 2;
            if (orderA !== orderB) return orderA - orderB;

            return getMinutes(a.time) - getMinutes(b.time);
        });
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

        if (isMessageActual(msgCategory, item.time, item.text)) {
            validMessages.push({
                sender: item.sender || lastSender || chatName,
                phone: '',
                time: item.time || '',
                text: item.text.trim()
            });
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
        const target = document.querySelector('[class*="ConvoMessage"], [class*="DateSeparator"], .MessageText');
        if (!target) return null;

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

    // Общее хранилище всех сырых сообщений и баннеров, встреченных во время скролла
    const allSeenRawItems = new Map<string, any>();
    const registerItems = (items: any[]) => {
        for (const item of items) {
            if (item.type === 'message' && item.text) {
                const key = `${item.sender}_${item.time}_${item.text}`;
                if (!allSeenRawItems.has(key)) {
                    allSeenRawItems.set(key, item);
                } else {
                    const existing = allSeenRawItems.get(key);
                    // Обновляем bannerDate, если раньше он был пустым, а сейчас появился
                    if (!existing.bannerDate && item.bannerDate) {
                        existing.bannerDate = item.bannerDate;
                    }
                }
            } else if (item.type === 'banner' && item.text) {
                const key = `banner_${item.text}`;
                if (!allSeenRawItems.has(key)) {
                    allSeenRawItems.set(key, item);
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
        const stickyOlder = stickyText && getBannerDateCategory(stickyText) === 'older';
        
        const reachedOlderBanner = stickyOlder || currentElements.some(
            item => item.type === 'banner' && item.text && getBannerDateCategory(item.text) === 'older'
        );
        if (reachedOlderBanner) {
            console.log(`   ⏹️ [VK] Достигнута граница старшей даты на шаге скролла вверх (шаг ${step})`);
            break;
        }

        // Проверяем: есть ли сообщения вчера до 06:00 утра?
        const reachedPreMorning = currentElements.some(item => {
            if (item.type !== 'message' || !item.time) return false;
            const cat = item.bannerDate ? getBannerDateCategory(item.bannerDate) : '';
            if (cat === 'yesterday') {
                const m = item.time.match(/(\d{1,2}):(\d{2})/);
                if (m && parseInt(m[1], 10) < 6) return true;
            }
            return false;
        });
        if (reachedPreMorning) {
            console.log(`   ⏹️ [VK] Достигнуты сообщения вчера до 06:00 утра (шаг ${step})`);
            break;
        }

        // Проверяем, не уперлись ли в самый верх истории (текст верхнего сообщения не меняется 2 раза подряд)
        const firstMsg = currentElements.find(item => item.type === 'message');
        const firstMsgKey = firstMsg ? `${firstMsg.sender}_${firstMsg.time}_${firstMsg.text.slice(0, 30)}` : '';
        if (firstMsgKey && firstMsgKey === prevFirstMessageKey) {
            unchangedTopCount++;
            if (unchangedTopCount >= 2) {
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
            const msg = document.querySelector('[class*="ConvoMessage"], .MessageText');
            let cur = msg?.parentElement;
            while (cur && cur !== document.body) {
                const s = window.getComputedStyle(cur);
                if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && cur.scrollHeight > cur.clientHeight) {
                    cur.scrollTop -= 400;
                    cur.dispatchEvent(new Event('scroll', { bubbles: true }));
                    break;
                }
                cur = cur.parentElement;
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
            const msg = document.querySelector('[class*="ConvoMessage"], .MessageText');
            let cur = msg?.parentElement;
            while (cur && cur !== document.body) {
                const s = window.getComputedStyle(cur);
                if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && cur.scrollHeight > cur.clientHeight) {
                    cur.scrollTop += 800;
                    cur.dispatchEvent(new Event('scroll', { bubbles: true }));
                    break;
                }
                cur = cur.parentElement;
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
            if (unchangedBottomCount >= 2) {
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
    const rawItems = Array.from(allSeenRawItems.values());
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
    let previousBottomText = "";
    while (true) {
        let count = await chatItems.count();
        if (count === 0) break;
        let bottomChat = chatItems.nth(count - 1);

        let dateText = await bottomChat.evaluate((el: HTMLElement) => {
            const dateSpan = el.querySelector('.ConvoListItem__date ~ .vkuiVisuallyHidden__host, .ConvoListItem__message > .vkuiVisuallyHidden__host:last-of-type') as HTMLElement;
            const fallbackDateSpan = el.querySelector('.ConvoListItem__date') as HTMLElement;
            return dateSpan ? (dateSpan.innerText || dateSpan.textContent || '').trim() : (fallbackDateSpan ? fallbackDateSpan.innerText.trim() : '');
        }).catch(() => '');

        let check = parseVkDate(dateText);

        if (check.isActual) {
            await bottomChat.hover().catch(() => {});
            await page.mouse.wheel(0, 500);
            await page.waitForTimeout(800);

            let newCount = await chatItems.count();
            let newBottom = chatItems.nth(newCount - 1);
            let newBottomText = await newBottom.innerText().catch(() => '');
            if (newBottomText === previousBottomText) break;
            previousBottomText = newBottomText;
        } else {
            console.log(`⏹️ [VK] Граница диалогов найдена: ${check.dateStr} (${check.reason})`);
            break;
        }
    }

    // 2. Анализируем все загруженные чаты от верхнего к нижнему
    let totalCount = await chatItems.count();
    console.log(`\n📋 [VK] Найдено диалогов в списке: ${totalCount}`);
    console.log('--- [VK] АНАЛИЗ ДИАЛОГОВ ---');

    interface VkChatMeta {
        index: number;
        name: string;
        dateStr: string;
        reason: string;
    }
    const actualChats: VkChatMeta[] = [];

    for (let i = 0; i < totalCount; i++) {
        let chat = chatItems.nth(i);
        const { chatName, dateText } = await chat.evaluate((el: HTMLElement) => {
            const titleEl = el.querySelector('.ConvoTitle__author, .ConvoTitle__title, .PeerTitle__title') as HTMLElement;
            const name = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : '';

            const dateSpan = el.querySelector('.ConvoListItem__date ~ .vkuiVisuallyHidden__host, .ConvoListItem__message > .vkuiVisuallyHidden__host:last-of-type') as HTMLElement;
            const fallbackDateSpan = el.querySelector('.ConvoListItem__date') as HTMLElement;

            const date = dateSpan ? (dateSpan.innerText || dateSpan.textContent || '').trim() : (fallbackDateSpan ? fallbackDateSpan.innerText.trim() : '');
            return { chatName: name || `VK Чат`, dateText: date };
        }).catch(() => ({ chatName: `VK Чат #${i + 1}`, dateText: '' }));

        let check = parseVkDate(dateText);
        console.log(`[${chatName}] | Дата: ${check.dateStr} | Статус: ${check.reason}`);

        if (check.isActual) {
            actualChats.push({
                index: i,
                name: chatName,
                dateStr: check.dateStr,
                reason: check.reason
            });
        } else {
            console.log(`⏹️ [VK] Достигнут неактуальный чат [${chatName}]. Граница зафиксирована.`);
            break;
        }
    }

    let orders: OrderResult[] = [];

    console.log(`\n📋 [VK] Всего актуальных чатов: ${actualChats.length}`);
    console.log(`🚀 [VK] Обрабатываем диалоги от самого первого актуального снизу вверх к новым:`);

    // 3. Проходим от САМОГО ПЕРВОГО АКТУАЛЬНОГО (снизу) ВВЕРХ К НАИБОЛЕЕ НОВЫМ
    for (let k = actualChats.length - 1; k >= 0; k--) {
        const chatMeta = actualChats[k];
        console.log(`\n📥 [VK] (${actualChats.length - k}/${actualChats.length}) Открываем чат: ${chatMeta.name} (${chatMeta.dateStr})...`);

        let chatLocator = chatItems.nth(chatMeta.index);
        await chatLocator.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(300);

        // Кликаем по чату в списке (через DOM el.click())
        await chatLocator.evaluate((el: HTMLElement) => el.click());
        await page.waitForTimeout(1200);

        // Собираем сообщения из открытого чата
        const filteredMessages = await extractMessagesFromOpenChat(page, chatMeta.name, chatMeta.dateStr);

        if (filteredMessages.length > 0) {
            console.log(`   ✅ [VK] Собрано сообщений: ${filteredMessages.length}`);
            orders.push({
                messenger: 'VK',
                chatName: chatMeta.name,
                messages: filteredMessages
            });
        } else {
            console.log(`   ⚠️ [VK] Сообщений по фильтру времени не найдено`);
        }

        // 4. После того как сообщения взяты — закрываем чат по крестику
        await closeActiveVkChat(page);
    }

    console.log(`\n✅ [VK] Сбор завершен. Получено заказов: ${orders.length}\n`);
    return orders;
}
