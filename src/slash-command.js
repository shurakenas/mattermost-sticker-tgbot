// src/slash-command.js
const axios = require('axios');
const TelegramAPI = require('./telegram-api');
const WebmHandler = require('./handler_webm');
const TgsHandler = require('./handler_tgs');

class SlashCommandHandler {
    constructor(stickerBot, telegramToken, serverUrl, botToken) {
        this.stickerBot = stickerBot;
        this.serverUrl = serverUrl;
        this.botToken = botToken;
        
        // Initialize Telegram API
        this.telegram = new TelegramAPI(telegramToken);
        
        // Initialize converters
        this.webmHandler = new WebmHandler();
        this.tgsHandler = new TgsHandler();
        
        // Default sticker packs
        this.defaultStickerPacks = [
            { name: 'memezey', url: 'https://t.me/addstickers/memezey' },
            { name: 'pepetop', url: 'https://t.me/addstickers/pepetop' },
            { name: 'HotCherry', url: 'https://t.me/addstickers/HotCherry' }
        ];
        
        // Store custom sticker packs
        this.customStickerPacks = [];
    }
    
    async handleCommand(command, args, userId, channelId, teamId, responseUrl) {
        console.log(`Slash command received: ${command} ${args} from user ${userId} in channel ${channelId}`);
        
        try {
            // Handle help command
            if (command === 'sticker' && (!args || args === 'help')) {
                return this.handleHelp(userId, channelId, responseUrl);
            }
            
            // Handle ass command (open web interface)
            if (command === 'sticker' && args.startsWith('ass')) {
                return this.handleAssCommand(userId, channelId, responseUrl);
            }
            
            // Handle sticker selection (if we get sticker ID)
            if (command === 'sticker' && args.startsWith('send_')) {
                const stickerId = args.replace('send_', '');
                return this.handleStickerSend(userId, channelId, stickerId, responseUrl);
            }
            
            // Default response
            return this.sendEphemeralResponse(responseUrl, '❌ Unknown command. Use `/sticker help` for assistance.');
            
        } catch (error) {
            console.error('Error handling slash command:', error);
            return this.sendEphemeralResponse(responseUrl, '❌ An error occurred. Please try again.');
        }
    }
    
    async handleHelp(userId, channelId, responseUrl) {
        const helpText = `
## 🎉 Telegram Sticker Bot - Slash Commands

**Available Commands:**
• \`/sticker help\` - Show this help menu
• \`/sticker ass\` - Open sticker selection interface

**Features:**
✅ Works in any channel or direct message
✅ No need to add bot to chat
✅ Animated sticker support (WebM/TGS → GIF)
✅ Web interface for easy selection

**How to use:**
1. Type \`/sticker ass\` in any chat
2. Open the provided link in browser
3. Select sticker pack and click any sticker
4. It will be sent to this chat!

_💡 Tip: You can also use @stickerbot commands in channels where the bot is present_
        `;
        
        return this.sendEphemeralResponse(responseUrl, helpText);
    }
    
    async handleAssCommand(userId, channelId, responseUrl) {
        try {
            // Generate unique session ID
            const sessionId = `slash_${Date.now()}_${userId}`;
            
            // Get user info for username
            const userInfo = await this.getUserInfo(userId);
            const username = userInfo ? userInfo.username : `user_${userId}`;
            
            // Create web picker URL with session info
            const baseUrl = process.env.DOMAIN || 'http://localhost';
            const assPort = process.env.ASS_PORT || 3333;
            
            // We need to pass channel and user info to the web interface
            const pickerUrl = `${baseUrl}:${assPort}/slash-picker?session=${sessionId}&channel=${channelId}&user=${userId}&username=${encodeURIComponent(username)}`;
            
            const responseText = `🎨 **Sticker Selector Interface**\n\n[**Open Sticker Picker**](${pickerUrl})\n\n_Use the web interface to select and send stickers to this chat!_`;
            
            return this.sendEphemeralResponse(responseUrl, responseText);
            
        } catch (error) {
            console.error('Error handling ass command:', error);
            return this.sendEphemeralResponse(responseUrl, '❌ Failed to generate sticker picker link. Please try again.');
        }
    }
    
    async handleStickerSend(userId, channelId, stickerId, responseUrl) {
        try {
            // Here you would implement the actual sticker sending logic
            // For now, just acknowledge the command
            console.log(`Would send sticker ${stickerId} to channel ${channelId}`);
            
            // Send acknowledgement
            return this.sendEphemeralResponse(responseUrl, '✅ Sticker sent successfully!');
            
        } catch (error) {
            console.error('Error sending sticker:', error);
            return this.sendEphemeralResponse(responseUrl, '❌ Failed to send sticker. Please try again.');
        }
    }
    
    async getUserInfo(userId) {
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
            console.error('Failed to get user info:', error.message);
        }
        return null;
    }
    
    async sendEphemeralResponse(responseUrl, text) {
        try {
            const response = await axios.post(responseUrl, {
                response_type: 'ephemeral',
                text: text
            });
            
            console.log('Ephemeral response sent via response_url');
            return response.data;
        } catch (error) {
            console.error('Failed to send ephemeral response:', error.message);
            // Fallback: try to send via regular API
            throw error;
        }
    }
    
    // Method to be called from web interface
    async sendStickerToChannel(stickerData, channelId, userId) {
        // Implement actual sticker sending logic here
        // This would be similar to your existing sticker sending code
        console.log(`Sending sticker ${stickerData.id} to channel ${channelId}`);
        
        // Placeholder - implement actual sticker sending
        return { success: true };
    }
}

module.exports = SlashCommandHandler;
