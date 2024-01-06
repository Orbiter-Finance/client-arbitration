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
    constructor() {
    }

    async sendMessage(messageText: string) {
        if (!arbitrationConfig.telegramToken || !arbitrationConfig.telegramChatId) {
            return;
        }
        const requestData = {
            chat_id: arbitrationConfig.telegramChatId,
            text: messageText,
            disable_notification: false,
            parse_mode: '',
        };
        try {
            const url = `https://api.telegram.org/bot${arbitrationConfig.telegramToken}/sendMessage`;
            return await axios.post(url, requestData);
        } catch (error) {
            console.error('Error sending to Telegram', error);
            throw error;
        }
    }
}

export const telegramBot = new Telegram();
