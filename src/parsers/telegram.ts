import { BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { OrderResult, MessageItem } from '../types';
import { checkOrderDate, getBannerDateCategory, isMessageActual } from '../utils/date';

const TELEGRAM_SPY_LOG = path.resolve(process.cwd(), 'telegram_spy.log');
function telegramSpy(message: string): void {
    try {
        fs.appendFileSync(TELEGRAM_SPY_LOG, `[${new Date().toISOString()}] ${message}\n`);
    } catch (error) {
        console.warn('[Telegram spy] Не удалось записать лог:', error);
    }
}

function filterActualTelegramMessages(items: any[], chatName: string, chatDateFallback: string = ''): MessageItem[] {
    let validMessages: MessageItem[] = [];
    
    let fallbackCategory: 'today' | 'yesterday' | 'dayBeforeYesterday' | 'older' = 'today';
    if (chatDateFallback) {
        const cat = getBannerDateCategory(chatDateFallback);
        if (cat !== 'older') {
            fallbackCategory = cat;
        }
    }
    
    let currentCategory = fallbackCategory;
    let lastSender = "";

    const hasBanners = items.some(item => item.type === 'banner');
    if (hasBanners) {
        currentCategory = fallbackCategory; 
    }

    for (const item of items) {
        if (item.type === 'banner') {
            currentCategory = getBannerDateCategory(item.text);
            telegramSpy(`FILTER_DATE chat=${JSON.stringify(chatName)} text=${JSON.stringify(item.text)} category=${currentCategory}`);
            lastSender = "";
            continue;
        }

        if (item.type === 'message') {
            if (!item.text) {
                continue;
            }
            
            if (item.sender) {
                lastSender = item.sender;
            }
            
            const messageCategory = item.dateText
                ? getBannerDateCategory(item.dateText)
                : currentCategory;
            const isActual = isMessageActual(messageCategory, item.time, item.text);
            telegramSpy(`FILTER chat=${JSON.stringify(chatName)} accepted=${isActual} category=${messageCategory} time=${JSON.stringify(item.time)} preview=${JSON.stringify(item.text.slice(0, 180))}`);
            
            if (isActual) {
                const msg: any = {
                    sender: item.sender || lastSender || chatName,
                    phone: '',
                    time: item.time || '',
                    text: item.text.trim()
                };
                if (item.replyTo) {
                    msg.replyTo = item.replyTo;
                }
                validMessages.push(msg);
            }
        }
    }
    
    console.log(`Итого актуальных сообщений в чате: ${validMessages.length}\n=========================================\n`);
    return validMessages;
}

// Извлечение сообщений из активного окна чата или темы
async function extractActiveChatMessages(page: Page, fullChatName: string, chatDateStr: string = ''): Promise<OrderResult | null> {
    await page.waitForTimeout(1500);

    console.log(`   📜 [Telegram] Прокручиваем историю [${fullChatName}] вверх...`);
    telegramSpy(`START chat=${JSON.stringify(fullChatName)} listDate=${JSON.stringify(chatDateStr)}`);
    try { const view = page.viewportSize(); if (view) await page.mouse.move(view.width / 2, view.height / 2); } catch (e) {}

    let rawElementsData: any[] = [];
    let prevFirstText = '';
    let unchangedTop = 0;
    let topStalls = 0;

    for (let step = 1; step <= 40; step++) {
        const cur = await page.evaluate(() => {
            const container = document.querySelector('.bubbles, .messages-layout, #column-center') || document;
            const bubbles = Array.from(container.querySelectorAll('.bubble'));
            const results: any[] = [];
            let currentDateText = '';

            for (const bubble of bubbles) {
                if (bubble.classList.contains('is-date')) {
                    const svc = bubble.querySelector('.service-msg');
                    if (svc) {
                        currentDateText = (svc as HTMLElement).innerText ? (svc as HTMLElement).innerText.trim() : '';
                        results.push({
                            type: 'banner',
                            text: (svc as HTMLElement).innerText ? (svc as HTMLElement).innerText.trim() : ''
                        });
                    }
                } else if (bubble.classList.contains('service')) {
                    continue;
                } else {
                    const el = bubble.querySelector('.bubble-content');
                    if (!el) continue;

                    const nameEl = el.querySelector('.name .peer-title, .colored-name .peer-title');
                    const msgEl = el.querySelector('.message');
                    
                    let extractedTime = '';
                    const timeNodes = Array.from(el.querySelectorAll('.time, .time-inner, .message-time, .i18n'));
                    for (const node of timeNodes) {
                        const m = (node.textContent || '').trim().match(/(\d{1,2}:\d{2})/);
                        if (m) { extractedTime = m[1]; break; }
                    }
                    if (!extractedTime) {
                        const fallback = el.querySelector('.time .i18n, .time-inner');
                        extractedTime = fallback ? (fallback.textContent || '').trim() : '';
                    }

                    let text = '';
                    let replyTo: any = undefined;

                    const replyNode = el.querySelector('.reply, .bubble-reply, blockquote.blockquote');
                    if (replyNode) {
                        const rSender = (replyNode.querySelector('.reply-title, .peer-title')?.textContent || '').trim();
                        const rText = (replyNode.querySelector('.reply-subtitle, .translatable-message')?.textContent || '').trim();
                        if (rSender || rText) replyTo = { sender: rSender, phone: '', text: rText };
                    }

                    if (msgEl) {
                        const clone = msgEl.cloneNode(true) as HTMLElement;
                        clone.querySelector('.time')?.remove();
                        clone.querySelector('.reply, .bubble-reply, .reply-content, blockquote.blockquote')?.remove();



                        // Если внутри есть <p> или <li> (RichMessage / InstantView / нумерованный список) —
                        // innerText на клонированном узле склеивает их без переносов.
                        // Поэтому извлекаем текст из каждого блочного элемента вручную.
                        const blockEls = Array.from(clone.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6'));
                        if (blockEls.length > 0) {
                            text = blockEls
                                .map((el: Element) => (el.textContent || '').trim())
                                .filter((t: string) => t)
                                .join('\n');
                        } else {
                            text = clone.innerText || clone.textContent || '';
                        }
                    } else {
                        const allTrans = Array.from(el.querySelectorAll('.translatable-message'));
                        if (allTrans.length > 0) {
                            const clone = allTrans[allTrans.length - 1].cloneNode(true) as HTMLElement;
                            clone.querySelector('.reply, .bubble-reply, .reply-content, blockquote.blockquote')?.remove();
                            const blockEls = Array.from(clone.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6'));
                            if (blockEls.length > 0) {
                                text = blockEls
                                    .map((el: Element) => (el.textContent || '').trim())
                                    .filter((t: string) => t)
                                    .join('\n');
                            } else {
                                text = clone.innerText || clone.textContent || '';
                            }
                        }
                    }

                    const msgObj: any = { type: 'message', sender: nameEl ? (nameEl.textContent || '').trim() : '', time: extractedTime, text: text.trim(), dateText: currentDateText };
                    if (replyTo) msgObj.replyTo = replyTo;
                    results.push(msgObj);
                }
            }
            return results;
        });

        telegramSpy(`SNAPSHOT chat=${JSON.stringify(fullChatName)} step=${step} items=${JSON.stringify(cur.map((item: any) => ({ type: item.type, time: item.time, sender: item.sender, preview: item.text.slice(0, 180) })))}`);
        // Слияние сверху-вниз
        let anchor = -1;
        for (let i = cur.length - 1; i >= 0; i--) {
            const item = cur[i];
            const key = item.type === 'banner' ? 'b_'+item.text : item.sender+'_'+item.time+'_'+item.text.slice(0, 30);
            const existIdx = rawElementsData.findIndex(x => (x.type === 'banner' ? 'b_'+x.text : x.sender+'_'+x.time+'_'+x.text.slice(0, 30)) === key);
            if (existIdx !== -1) {
                anchor = existIdx;
            } else {
                const entry = item;
                if (anchor === -1) {
                    rawElementsData.push(entry);
                    anchor = rawElementsData.length - 1;
                } else {
                    rawElementsData.splice(anchor, 0, entry);
                }
            }
        }

        const first = cur.find((x: any) => x.type === 'message');
        const firstText = first ? first.time + first.text.slice(0, 30) : '';
        if (firstText && firstText === prevFirstText) {
            unchangedTop++;
        } else {
            unchangedTop = 0;
            prevFirstText = firstText;
        }

        const banners = cur.filter((x: any) => x.type === 'banner');
        telegramSpy(`STEP chat=${JSON.stringify(fullChatName)} step=${step} items=${cur.length} first=${JSON.stringify(firstText)} banners=${JSON.stringify(banners.map((b: any) => ({ text: b.text, category: getBannerDateCategory(b.text) })))} unchangedTop=${unchangedTop}`);
        let reachedBoundary = false;
        for (const b of banners) {
            if (getBannerDateCategory(b.text) === 'older') reachedBoundary = true;
        }
        console.log(`   🔎 [Telegram-DEBUG] Шаг ${step}: Найдено сообщений на экране: ${cur.length}, Первое сообщение: ${firstText}`);
        if (reachedBoundary) {
            telegramSpy(`STOP chat=${JSON.stringify(fullChatName)} reason=older-banner step=${step}`);
            console.log(`   ⏹️ [Telegram] Достигнута граница даты (шаг ${step})`);
            break;
        }

        const scrollDiagnostic = await page.evaluate(() => {
            const msgs = document.querySelectorAll('.bubble-content, .message');
            let foundScroll = false;
            let diagnostic: any = null;
            for (const msg of Array.from(msgs)) {
                let p = msg.parentElement;
                while (p && p !== document.body) {
                    const style = window.getComputedStyle(p);
                    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && p.scrollHeight > p.clientHeight) {
                        diagnostic = { tag: p.tagName, className: p.className, before: p.scrollTop, height: p.clientHeight, total: p.scrollHeight };
                        p.scrollBy(0, -800);
                        diagnostic.after = p.scrollTop;
                        p.dispatchEvent(new Event('scroll', { bubbles: true }));
                        foundScroll = true;
                        break;
                    }
                    p = p.parentElement;
                }
                if (foundScroll) break;
            }
            if (!foundScroll) window.scrollBy(0, -800);
            return {
                foundScroll,
                diagnostic,
                atTop: Boolean(diagnostic && diagnostic.after <= 2),
                moved: Boolean(diagnostic && diagnostic.after < diagnostic.before),
            };
        });
        telegramSpy(`SCROLL chat=${JSON.stringify(fullChatName)} step=${step} state=${JSON.stringify(scrollDiagnostic)} wheel=-800`);
        await page.mouse.wheel(0, -800);
        await page.waitForTimeout(scrollDiagnostic.atTop ? 1800 : 600);
        if (!scrollDiagnostic.foundScroll || (scrollDiagnostic.diagnostic && !scrollDiagnostic.moved)) {
            telegramSpy(`STOP chat=${JSON.stringify(fullChatName)} reason=scroll-boundary step=${step} state=${JSON.stringify(scrollDiagnostic)}`);
            break;
        }
        if (scrollDiagnostic.atTop) {
            topStalls++;
            telegramSpy(`TOP_WAIT chat=${JSON.stringify(fullChatName)} step=${step} attempt=${topStalls}`);
            if (topStalls >= 5) {
                telegramSpy(`STOP chat=${JSON.stringify(fullChatName)} reason=top-load-stalled step=${step}`);
                break;
            }
        } else {
            topStalls = 0;
        }
        if (step === 40) telegramSpy(`STOP chat=${JSON.stringify(fullChatName)} reason=step-limit step=40`);
    }

    const filteredMessages = filterActualTelegramMessages(rawElementsData, fullChatName, chatDateStr);
    telegramSpy(`END chat=${JSON.stringify(fullChatName)} collected=${rawElementsData.length} accepted=${filteredMessages.length}`);
    if (filteredMessages.length > 0) {
        return {
            messenger: 'Telegram',
            chatName: fullChatName,
            messages: filteredMessages
        };
    }
    return null;
}

export async function parseTelegram(context: BrowserContext): Promise<OrderResult[]> {
    telegramSpy(`RUN localTime=${new Date().toString()}`);
    console.log(`🕵️ Диагностика Telegram: ${TELEGRAM_SPY_LOG}`);
    console.log('🔍 [Telegram] Ищем вкладку Telegram Web K...');
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

    let page = context.pages().find(p => p.url().includes('web.telegram.org'));
    if (page) {
        await activateTab(page);
        if (!page.url().includes('/k/')) {
            await page.goto('https://web.telegram.org/k/', { waitUntil: 'domcontentloaded' });
        }
    } else {
        page = await context.newPage();
        await page.goto('https://web.telegram.org/k/', { waitUntil: 'domcontentloaded' });
        await activateTab(page);
    }

    console.log('⚙️ [Telegram] Переключаемся на папку "Заказы"...');
    const ordersTab = page.locator('.menu-horizontal-div-item').filter({ hasText: 'Заказы' });
    await ordersTab.waitFor({ state: 'visible', timeout: 15000 });
    await ordersTab.click();
    await page.waitForTimeout(2000);

    const chatItems = page.locator('a.chatlist-chat');
    await chatItems.first().waitFor({ state: 'visible', timeout: 10000 });

    console.log('\n--- [Telegram] ЭТАП 1: СКРОЛЛ ВНИЗ ДО ГРАНИЦЫ ---');
    let previousBottomText = "";
    while (true) {
        let count = await chatItems.count();
        if (count === 0) break;
        
        let bottomChat = chatItems.nth(count - 1);
        let bottomText = await bottomChat.innerText().catch(() => "");
        
        let check = checkOrderDate(bottomText);
        if (check.isActual) {
            console.log(`⬇️ [Telegram] Нижний чат актуален (${check.dateStr} - ${check.reason}). Скроллим вниз...`);
            await bottomChat.hover();
            await page.mouse.wheel(0, 600); 
            await page.waitForTimeout(1500); 
            
            let newBottomText = await chatItems.last().innerText().catch(() => "");
            if (newBottomText === previousBottomText) break; 
            previousBottomText = newBottomText;
        } else {
            console.log(`⏹️ [Telegram] Граница найдена на нижнем чате: ${check.dateStr} (${check.reason})`);
            break; 
        }
    }

    console.log('\n--- [Telegram] ЭТАП 2: СБОР ЧАТОВ СНИЗУ ВВЕРХ ---');
    
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

            let chatText = await chat.innerText().catch(() => "");
            if (!chatText) continue;
            
            const titleEl = chat.locator('.peer-title').first();
            let chatName = (await titleEl.count()) > 0 
                ? (await titleEl.innerText()).trim() 
                : chatText.split('\n')[0].trim();

            let check = checkOrderDate(chatText);
            
            // Если дата старая, просто пропускаем (ведь мы идем снизу вверх)
            if (!check.isActual) continue;

            // Нашли необработанный актуальный чат!
            if (!uniqueOrders.has(chatName)) {
                console.log(`[${chatName}] | Дата: ${check.dateStr} | Статус: ${check.reason}`);
                console.log(`📥 [Telegram] Открываем: ${chatName}...`);
                await chat.click();
                await page.waitForTimeout(1200); 

                const topicsContainer = page.locator('.topics-container.active, .topics-container.is-visible');
                const isTopicForum = (await topicsContainer.count()) > 0 && (await topicsContainer.first().isVisible());

                if (isTopicForum) {
                    console.log(`📁 [Telegram] [${chatName}] — группа с темами (подчатами). Сканируем темы...`);
                    const activeContainer = topicsContainer.first();
                    const topicItems = activeContainer.locator('a.chatlist-chat');
                    const topicCount = await topicItems.count();

                    // Темы тоже читаем снизу вверх
                    for (let t = topicCount - 1; t >= 0; t--) {
                        const topic = topicItems.nth(t);
                        const topicText = await topic.innerText().catch(() => "");
                        if (!topicText) continue;
                        
                        const topicTitleEl = topic.locator('.peer-title-inner, .peer-title').first();
                        let topicTitle = (await topicTitleEl.count()) > 0 
                            ? (await topicTitleEl.innerText()).trim() 
                            : topicText.split('\n')[0].trim();
                        // Убираем артефакты-аватарки типа "П\nПремьер"
                        topicTitle = topicTitle.replace(/^[А-ЯЁA-Z]\n/i, '');

                        const checkTopic = checkOrderDate(topicText);
                        console.log(`   ├─ Тема [${topicTitle}] | Дата: ${checkTopic.dateStr} | Статус: ${checkTopic.reason}`);

                        if (checkTopic.isActual) {
                            const fullChatName = `${chatName} → ${topicTitle}`;
                            if (!uniqueOrders.has(fullChatName)) {
                                console.log(`   📥 Заходим в тему [${topicTitle}]...`);
                                await topic.click();
                                
                                // Ждём перерисовки интерфейса (чтобы не прочитать старую тему)
                                try {
                                    await page.waitForFunction((title) => {
                                        const header = document.querySelector('.chat-info, .header, #column-center');
                                        return header && header.textContent && header.textContent.includes(title);
                                    }, topicTitle, { timeout: 4000 });
                                } catch (e) {
                                    await page.waitForTimeout(2000); // фоллбэк
                                }
                                
                                const order = await extractActiveChatMessages(page, fullChatName, checkTopic.dateStr);
                                if (order) {
                                    uniqueOrders.set(fullChatName, order);
                                } else {
                                    uniqueOrders.set(fullChatName, { messenger: 'Telegram', chatName: fullChatName, messages: [] });
                                }
                            }
                        }
                    }

                    const closeBtn = activeContainer.locator('.sidebar-close-button');
                    if (await closeBtn.isVisible()) {
                        console.log(`   🔙 Закрываем панель тем [${chatName}]`);
                        await closeBtn.click();
                        await page.waitForTimeout(800);
                    }
                    uniqueOrders.set(chatName, { messenger: 'Telegram', chatName, messages: [] });
                } else {
                    const order = await extractActiveChatMessages(page, chatName, check.dateStr);
                    if (order) {
                        uniqueOrders.set(chatName, order);
                    } else {
                        uniqueOrders.set(chatName, { messenger: 'Telegram', chatName, messages: [] });
                    }
                }

                processedAnyInThisScroll = true;
                // Прерываем цикл! Начинаем поиск с самого низа текущего экрана снова (на случай сдвигов)
                break; 
            }
        }

        // Если мы пробежали по всему экрану и не нашли новых чатов, скроллим ВВЕРХ
        if (!processedAnyInThisScroll) {
            let topChat = chatItems.first();
            await topChat.hover();
            console.log(`⬆️ [Telegram] Скроллим вверх...`);
            await page.mouse.wheel(0, -600); 
            await page.waitForTimeout(1500);

            let currentTopText = await chatItems.first().innerText().catch(() => "");
            if (currentTopText === previousTopText) {
                console.log(`⬆️ [Telegram] Достигнут самый верх списка чатов.`);
                reachedTop = true;
            }
            previousTopText = currentTopText;
        }
    }

    // Фильтруем те, где messages.length > 0 
    // Поскольку мы шли строго снизу вверх, массив УЖЕ отсортирован от старых к новым!
    const finalOrders = Array.from(uniqueOrders.values()).filter(o => o.messages.length > 0);

    console.log(`✅ [Telegram] Сбор завершен. Получено уникальных заказов: ${finalOrders.length}\n`);
    return finalOrders;
}
