export interface MessageItem {
    sender: string;
    phone: string;
    time: string;
    date?: string;
    text: string;
    branchName?: string;
    replyTo?: {
        sender: string;
        phone?: string;
        text: string;
    };
}

export interface OrderResult {
    messenger: 'WhatsApp' | 'Telegram' | 'VK';
    chatName: string;
    messages: MessageItem[];
}
