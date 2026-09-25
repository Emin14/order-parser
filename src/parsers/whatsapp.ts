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

        if (item.prePlainText) {
            const match = item.prePlainText.match(/\[(.*?)\]\s*(.*?):/);
            if (match) {
                const timeMatch = match[1].match(/\d{2}:\d{2}/);
                if (timeMatch) time = timeMatch[0];
                strPreText = match[2].replace(/^~/, '');
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
            sender: currentSender,
            phone: currentPhone,
            text: text.trim(),
            replyTo: item.replyTo
        });
    }

    return processed;
}

function filterActualMessages(items: any[]): MessageItem[] {
    let validMessages: MessageItem[] = [];
    let currentCategory: 'today' | 'yesterday' | 'older' = 'today';

    const hasBanners = items.some(item => item.type === 'banner');
    if (hasBanners) {
        currentCategory = 'older'; 
    }

    for (let item of items) {
        if (item.type === 'banner') {
            currentCategory = getBannerDateCategory(item.text);
            continue; 
        }
        
        if (item.type === 'message') {
            if (!item.text) continue;
            
            // Проверяем актуальность с учетом категории даты, времени и текста ("на завтра")
            if (isMessageActual(currentCategory, item.time, item.text)) {
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
    let page = context.pages().find(p => p.url().includes('whatsapp.com'));
    if (page) {
        await page.bringToFront(); 
    } else {
        page = await context.newPage();
        await page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded' });
        await page.bringToFront();
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
            await page.waitForTimeout(1500); 
            
            const rawElementsData = await page.evaluate(() => {
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
                                cleanText = (selectableTextEl as HTMLElement).innerText || '';
                            } else {
                                cleanText = clone.innerText || '';
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
                            
                            cleanText = clone.innerText || '';
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
            
            const structuredItems = processRawItems(rawElementsData);
            const filteredMessages = filterActualMessages(structuredItems);
            
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
