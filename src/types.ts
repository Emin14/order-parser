export interface MessageItem {
    sender: string;
    phone: string;
    time: string;
    date?: string;
    text: string;
    branchName?: string;
    isForwarded?: boolean;
    forwardedFrom?: string;
    forwardedDate?: string;
    forwardedTime?: string;
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
