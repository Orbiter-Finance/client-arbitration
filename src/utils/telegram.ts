import { arbitrationConfig } from './config';

export interface TelegramOption {
    chatId: string;
    disableNotification?: boolean,
    parseMode?: string,
    host?: string,
    token: string;
}

import axios from 'axios';

class Telegram {
    constructor(private readonly opts?: TelegramOption) {
    }

    async sendMessage(messageText: string) {
        if (!arbitrationConfig.telegramToken || !arbitrationConfig.telegramChatId) {
            return;
        }
        const requestData = {
            chat_id: this.opts?.chatId,
            text: messageText,
            disable_notification: this.opts?.disableNotification || false,
            parse_mode: this.opts?.parseMode || '',
        };
        try {
            const url = `${this.opts?.host || 'https://api.telegram.org'}/bot${this.opts?.token}/sendMessage`;
            return await axios.post(url, requestData);
        } catch (error) {
            console.error('Error sending to Telegram', error);
            throw error;
        }
    }
}

export const telegramBot = new Telegram({
    token: String(arbitrationConfig.telegramToken),
    chatId: String(arbitrationConfig.telegramChatId),
});
