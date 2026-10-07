import { BrowserContext, Page } from 'playwright';
import { OrderResult, MessageItem } from '../types';
import { parseVkDate, getBannerDateCategory, isMessageActual } from '../utils/date';

// Временная диагностика: только читает DOM, ничего не нажимает и не скрывает.
async function logVkSpy(page: Page, stage: string): Promise<void> {
    console.log(`🕵️ [VK spy] ${stage}`);
    try {
        const state = await page.evaluate(() => {
            const selectors = [
                'section[data-testid="me_convo_list"]',
                'button[data-testid="vkme_convo_list_item"]',
                '[data-testid^="me_folder_tab_"]',
                '.FriendsBirthdayBanner__container',
                '.ConvoMain', '.ConvoHistory', '.ConvoHeader',
                '[class*="ConvoMessage"]', '.MessageText', '.DateSeparator',
            ];
            const folders = Array.from(document.querySelectorAll('[data-testid^="me_folder_tab_"], .OrganiserViewHorizontal__item, .ConvoListFolders__item'));
            const oldMatches = Array.from(document.querySelectorAll('.OrganiserViewHorizontal__item, [data-testid^="me_folder_tab_"], .ConvoListFolders__item, [class*="Folder"], [class*="folder"]'))
                .filter(el => (el.textContent || '').includes('Заказы'));
            const scrollBoxes = Array.from(document.querySelectorAll('[data-scrollbar="scrollable"]')).map(el => ({
                class: el.className, top: el.scrollTop, height: el.clientHeight, totalHeight: el.scrollHeight,
            }));
            return {
                counts: Object.fromEntries(selectors.map(selector => [selector, document.querySelectorAll(selector).length])),
                folders: folders.slice(0, 15).map(el => ({
                    label: (el.querySelector('.vkuiTabsItem__label')?.textContent || el.getAttribute('aria-label') || '').trim(),
                    testid: el.getAttribute('data-testid'), selected: el.getAttribute('aria-selected'),
                    class: el.className, visible: (el as HTMLElement).getClientRects().length > 0,
                })),
                firstOldMatch: oldMatches[0] ? {
                    tag: oldMatches[0].tagName, class: oldMatches[0].className,
                    testid: oldMatches[0].getAttribute('data-testid'),
                    selected: oldMatches[0].getAttribute('aria-selected'),
                    matchCount: oldMatches.length,
                } : null,
                scrollBoxes,
            };
        });
        console.log(`   URL: ${page.url()}; closed=${page.isClosed()}; now=${new Date().toString()}`);
        console.log('   DOM:', JSON.stringify(state));
    } catch (error) {
        console.log('   Диагностика недоступна:', error instanceof Error ? error.message : String(error));
    }
}

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

    console.log(`🕵️ [VK spy] Фильтрация [${chatName}]: вход=${items.length}, принято=${validMessages.length}, отброшено=${items.length - validMessages.length}, дата чата=${JSON.stringify(chatDateFallback)}, fallback=${fallbackCategory}`);
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
    await logVkSpy(page, `диалог открыт: ${chatName}`);
    // Ждем появления хотя бы одного сообщения в открытом чате
    await page.locator('[class*="ConvoMessage"], .MessageText').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

    // Наводим курсор на открытый чат
    const firstMsgLoc = page.locator('.ConvoMain [class*="ConvoMessage"], .ConvoHistory [class*="ConvoMessage"], [class*="ConvoMessage"], .MessageText').first();
    try { 
        const view = page.viewportSize(); 
        if (view) await page.mouse.move(view.width / 2, view.height / 2); 
        await page.evaluate(() => {
            const scroller = document.querySelector('.ConvoHistory__scroll, .ConvoMain, .im-page--history, [class*="history"], [class*="Scroller"]');
            if (scroller) scroller.scrollBy(0, -18000);
        });
    } catch (e) {}

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

        console.log(`🕵️ [VK spy] История [${chatName}], вверх ${step}: DOM=${currentElements.length}, сообщений=${currentElements.filter(item => item.type === 'message').length}, накоплено=${masterList.length}`);

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
            const scroller = document.querySelector('.ConvoHistory__scroll, .ConvoMain, .im-page--history, [class*="history"], [class*="Scroller"]');
            if (scroller) scroller.scrollBy(0, -400);
            else window.scrollBy(0, -400);
        });
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
        await page.evaluate(() => {
            const scroller = document.querySelector('.ConvoHistory__scroll, .ConvoMain, .im-page--history, [class*="history"], [class*="Scroller"]');
            if (scroller) {
                scroller.scrollBy(0, 800);
                scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
            } else {
                window.scrollBy(0, 800);
            }
        }).catch(() => {});

        await page.waitForTimeout(500);

        const currentElements = await page.evaluate(extractVkElementsFromDom);
        registerItems(currentElements);

        const messages = currentElements.filter(item => item.type === 'message');
        console.log(`🕵️ [VK spy] История [${chatName}], вниз ${step}: DOM=${currentElements.length}, сообщений=${messages.length}, накоплено=${masterList.length}`);
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
    console.log(`🕵️ [VK spy] Извлечено [${chatName}]: сырых=${rawItems.length}, перед фильтрацией=${sortedRawItems.length}, даты=${JSON.stringify([...new Set(sortedRawItems.map(item => item.bannerDate || '(нет даты)'))].slice(0, 10))}`);
    return filterActualVkMessages(sortedRawItems, chatName, chatDateStr);
}

export async function parseVk(context: BrowserContext): Promise<OrderResult[]> {
    try {
        return await collectVkOrders(context);
    } catch (error) {
        console.error('🕵️ [VK spy] Сбор прерван:', error instanceof Error ? error.stack : String(error));
        try {
            const page = context.pages().find(p => /vk\.(com|me|ru)/.test(p.url()));
            if (page) await logVkSpy(page, 'состояние перед закрытием браузера из-за ошибки');
        } catch {
            // Ошибка диагностики не должна подменять исходную ошибку парсера.
        }
        throw error;
    }
}

async function collectVkOrders(context: BrowserContext): Promise<OrderResult[]> {
    console.log('🔍 [VK] Ищем вкладку ВКонтакте...');
    await new Promise(r => setTimeout(r, 1000));

    async function activateTab(p: any) {
        try {
            const client = await context.newCDPSession(p);
            const { targetInfo } = await client.send('Target.getTargetInfo');
            await client.send('Target.activateTarget', { targetId: targetInfo.targetId });
        } catch (e) {
            p.bringToFront().catch(() => {});
        }
    }

    let page = context.pages().find(p => p.url().includes('vk.com') || p.url().includes('vk.me') || p.url().includes('vk.ru'));
    if (page) {
        await activateTab(page);
        if (!page.url().includes('/im') && !page.url().includes('web.vk.')) {
            await page.goto('https://vk.ru/im', { waitUntil: 'domcontentloaded' });
        }
    } else {
        page = await context.newPage();
        await page.goto('https://vk.ru/im', { waitUntil: 'domcontentloaded' });
        await activateTab(page);
    }

    // При первом запуске VK может показать QR-код. Даём время завершить вход,
    // иначе парсер закроет профиль раньше, чем cookies успеют сохраниться.
    if (!page.url().includes('/im') && !page.url().includes('web.vk.')) {
        console.log('🔐 [VK] Требуется вход. Ожидаем авторизацию по QR-коду до 1 минуты...');
        try {
            await page.waitForURL(/\/im(?:[/?#]|$)/, { timeout: 60000, waitUntil: 'domcontentloaded' });
            console.log('✅ [VK] Авторизация завершена, продолжаем сбор.');
        } catch {
            throw new Error('VK не завершил авторизацию за 1 минуту. Оставьте окно VK открытым и повторите npm start.');
        }
    }
    
    // Закрываем открытый чат, если мы уже находимся внутри него
    // (иначе интерфейс может скрывать вкладки с папками)
    await logVkSpy(page, 'до закрытия текущего диалога');
    await closeActiveVkChat(page);
    await logVkSpy(page, 'перед выбором папки «Заказы»');

    console.log('⚙️ [VK] Переключаемся на папку "Заказы"...');
    // Обновленные селекторы: ищем вкладку более широко (и точные классы из HTML, и универсальные)
    let ordersTab = page.locator('.OrganiserViewHorizontal__item, [data-testid^="me_folder_tab_"], .ConvoListFolders__item, [class*="Folder"], [class*="folder"]').filter({ hasText: 'Заказы' }).first();
    
    try {
        await ordersTab.waitFor({ state: 'attached', timeout: 15000 });
    } catch (e) {
        console.error('❌ [VK] Не удалось найти папку "Заказы". Возможно, ВК обновил дизайн или папка скрыта.');
        // Резервный поиск
        ordersTab = page.locator('text="Заказы"').first();
        if (!(await ordersTab.isVisible({ timeout: 5000 }))) {
            throw new Error("Не удалось найти папку 'Заказы' ни одним из селекторов.");
        }
        console.log('⚠️ [VK] Нашли папку через резервный поиск!');
    }

    // Кликаем и проверяем что вкладка действительно стала активной (до 3 попыток)
    let tabActive = false;
    for (let attempt = 0; attempt < 3; attempt++) {
        await ordersTab.click({ force: true });
        await page.waitForTimeout(2000);

        // Проверяем: вкладка стала активной если у неё есть класс selected/active или aria-selected="true"
        tabActive = await ordersTab.evaluate((el: HTMLElement) => {
            return el.getAttribute('aria-selected') === 'true'
                || el.classList.contains('OrganiserViewHorizontal__item--selected')
                || el.classList.contains('active')
                || el.classList.toString().toLowerCase().includes('select');
        }).catch(() => false);

        console.log(`🕵️ [VK spy] Выбор папки: попытка=${attempt + 1}, active=${tabActive}`);

        if (tabActive) {
            console.log(`✅ [VK] Папка "Заказы" активна (попытка ${attempt + 1})`);
            break;
        }
        console.log(`⚠️ [VK] Вкладка "Заказы" не активна, повторяем... (попытка ${attempt + 1})`);
        await page.waitForTimeout(1000);
    }

    if (!tabActive) {
        console.warn('⚠️ [VK] Не удалось убедиться что вкладка "Заказы" активна — продолжаем на свой риск');
    }

    // Если был открыт какой-то чат — закрываем его
    await closeActiveVkChat(page);
    await logVkSpy(page, 'после выбора папки и закрытия диалога');

    const chatItems = page.locator('button[data-testid="vkme_convo_list_item"]');
    console.log(`🕵️ [VK spy] Чатов по прежнему селектору: ${await chatItems.count()}`);
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

        console.log(`🕵️ [VK spy] Нижний чат: count=${count}, date=${JSON.stringify(dateText)}, actual=${check.isActual}, reason=${check.reason}`);

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

            console.log(`🕵️ [VK spy] Проверка чата [${chatName}]: date=${JSON.stringify(dateText)}, actual=${check.isActual}, reason=${check.reason}, processed=${uniqueOrders.has(chatName)}`);
            
            // Пропускаем старые
            if (!check.isActual) continue;

            // Нашли необработанный актуальный чат
            if (!uniqueOrders.has(chatName)) {
                console.log(`\n[${chatName}] | Дата: ${check.dateStr} | Статус: ${check.reason}`);
                console.log(`📥 [VK] Открываем: ${chatName}...`);
                
                await chat.scrollIntoViewIfNeeded().catch(() => {});
                await chat.evaluate((el: HTMLElement) => el.click());
                
                // Ждём перерисовки чата, чтобы случайно не спарсить старый открытый чат
                try {
                    await page.waitForFunction((expectedName) => {
                        const header = document.querySelector('.ConvoHeader, .im-page--title-wrapper, .PeerTitle__title, .ConvoHeader__title, .im-page--header-chat-name');
                        if (!header) return false;
                        const text = header.textContent || '';
                        // Ищем совпадение названия
                        return text.includes(expectedName) || expectedName.includes(text.trim());
                    }, chatName, { timeout: 4000 });
                } catch (e) {
                    console.log(`🕵️ [VK spy] Заголовок [${chatName}] не подтверждён за 4 секунды; используется прежний fallback.`);
                    await page.waitForTimeout(2000); // фоллбэк если заголовок не найден
                }

                const order = await extractMessagesFromOpenChat(page, chatName, check.dateStr);
                console.log(`🕵️ [VK spy] Результат [${chatName}]: сообщений=${order.length}`);
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
    console.log(`🕵️ [VK spy] Итог: обработано чатов=${uniqueOrders.size}, без сообщений=${[...uniqueOrders.values()].filter(o => o.messages.length === 0).length}, заказов=${orders.length}`);
    console.log(`\n✅ [VK] Сбор завершен. Получено заказов: ${orders.length}\n`);
    return orders;
}
