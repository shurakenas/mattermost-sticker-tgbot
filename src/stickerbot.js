// Load .env file if it exists (for local development)
require('dotenv').config();

const TelegramAPI = require('./telegram-api');
const WebPicker = require('../web-ui/web-picker');
const WebmHandler = require('./handler_webm');
const TgsHandler = require('./handler_tgs');
const CacheManager = require('./cache_manager');

class StickerBot {
    constructor(config) {
        this.serverUrl = config.serverUrl;
        this.botToken = config.botToken;

        // Initialize Telegram API
        this.telegram = new TelegramAPI(process.env.TELEGRAM_BOT_TOKEN);

        // Initialize converters
        this.webmHandler = new WebmHandler();
        this.tgsHandler = new TgsHandler();

        // Initialize web picker with both handlers
        this.webPicker = new WebPicker(this, this.telegram, process.env.ASS_PORT || 3333, this.webmHandler, this.tgsHandler);
        this.webPicker.start();

        // Initialize and start cache manager
        this.cacheManager = new CacheManager();
        this.cacheManager.start();
    }

    async connect() {
        try {
            console.log('✅ Sticker Bot initialized');
            console.log(`🌐 Web picker: http://localhost:${process.env.ASS_PORT || 3333}`);
            console.log(`🔗 Slash command: /sticker [help|ass]`);
            return true;
        } catch (error) {
            console.error('Failed to connect:', error);
            return false;
        }
    }

    // Метод для отправки сообщений (нужен для веб-интерфейса)
    async sendMessage(channelId, message) {
        const axios = require('axios');
        try {
            const response = await axios.post(`${this.serverUrl}/api/v4/posts`, {
                channel_id: channelId,
                message: message
            }, {
                headers: {
                    'Authorization': `Bearer ${this.botToken}`
                }
            });
            console.log(`Message sent to channel ${channelId}`);
            return response.data;
        } catch (error) {
            console.error('Failed to send message:', error.response?.data || error.message);
        }
    }

    // Метод для отправки эфемерных сообщений
    async sendEphemeralPost(userId, channelId, message) {
        const axios = require('axios');
        try {
            const response = await axios.post(`${this.serverUrl}/api/v4/posts/ephemeral`, {
                user_id: userId,
                channel_id: channelId,
                post: {
                    channel_id: channelId,
                    message: message
                }
            }, {
                headers: {
                    'Authorization': `Bearer ${this.botToken}`
                }
            });
            console.log(`Ephemeral message sent to user ${userId} in channel ${channelId}`);
            return response.data;
        } catch (error) {
            console.error('Failed to send ephemeral message:', error.response?.data || error.message);
        }
    }

    // Метод для получения информации о пользователе
    async getUserInfo(userId) {
        const axios = require('axios');
        try {
            const response = await axios.get(`${this.serverUrl}/api/v4/users/${userId}`, {
                headers: {
                    'Authorization': `Bearer ${this.botToken}`
                }
            });
            if (response.status === 200) {
                return response.data;
            }
        } catch (error) {
            console.error('Failed to get user info:', error.response?.data || error.message);
        }
        return null;
    }
}

// Configuration
const config = {
    serverUrl: process.env.MM_SERVER_URL || 'http://localhost:8065',
    botToken: process.env.MM_BOT_TOKEN
};

// Check if bot token is provided
if (!config.botToken) {
    console.error('❌ Please set MM_BOT_TOKEN environment variable');
    console.log('\nTo create a bot account:');
    console.log('1. Go to Mattermost > Integrations > Bot Accounts');
    console.log('2. Create a new bot account');
    console.log('3. Copy the access token');
    console.log('4. Run: MM_BOT_TOKEN=<your-token> node stickerbot.js');
    process.exit(1);
}

// Create and start the bot
const bot = new StickerBot(config);

bot.connect().then((success) => {
    if (success) {
        console.log('✅ Sticker Bot is running!');
        console.log('\n📋 Setup slash command in Mattermost:');
        console.log('1. Go to Integrations → Slash Commands → Add Slash Command');
        console.log('2. Set Trigger: "sticker"');
        console.log('3. Set URL: "http://YOUR_SERVER:3333/slash-command"');
        console.log('4. Save and use /sticker help');
    } else {
        console.error('❌ Failed to start bot');
        process.exit(1);
    }
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down bot...');
    if (bot.cacheManager) {
        bot.cacheManager.stop();
    }
    process.exit(0);
});
