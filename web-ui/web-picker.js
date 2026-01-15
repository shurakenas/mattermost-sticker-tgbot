const express = require('express');
const path = require('path');
const { uploadFile, sendFileAsPost } = require('./file-upload');

class WebPicker {
    constructor(bot, telegram, port = 3333, webmHandler = null, tgsHandler = null) {
        this.bot = bot;
        this.telegram = telegram;
        this.port = port;
        this.webmHandler = webmHandler;
        this.tgsHandler = tgsHandler;
        this.app = express();
        this.sessions = new Map();
        this.stickerCache = new Map();
        this.setupRoutes();
    }

    setupRoutes() {
        // Middleware для парсинга JSON и form-data
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        this.app.use(express.static(path.join(__dirname)));

        // ========== SLASH COMMAND ENDPOINT ==========
        this.app.post('/slash-command', async (req, res) => {
            console.log('📨 Slash command received:', req.body);
            
            try {
                const { 
                    command,        // "/sticker"
                    text,           // "help" или "ass"
                    user_id, 
                    channel_id,
                    response_url,
                    token
                } = req.body;

                // Проверяем токен если нужно (можно включить позже)
                // if (token !== process.env.SLASH_COMMAND_TOKEN) {
                //     return res.json({
                //         response_type: 'ephemeral',
                //         text: '❌ Invalid token'
                //     });
                // }

                // Обрабатываем команду
                if (!text || text === 'help') {
                    return res.json({
                        response_type: 'ephemeral',
                        text: this.getHelpText()
                    });
                }

                if (text === 'ass') {
                    // Генерируем ссылку на веб-интерфейс
                    const pickerUrl = await this.generateSlashPickerLink(channel_id, user_id);
                    return res.json({
                        response_type: 'ephemeral',
                        text: `🎨 **Система для выбора стикеров**\n\n[**Открыть выбор стикеров**](${pickerUrl})\n\nВыберите стикеры для отправки в этот чат!`
                    });
                }

                // Неизвестная команда
                return res.json({
                    response_type: 'ephemeral',
                    text: '❌ Неизвестная команда. Используйте `/sticker help` or `/sticker ass`'
                });

            } catch (error) {
                console.error('Error in slash command:', error);
                res.json({
                    response_type: 'ephemeral',
                    text: '❌ Ошибка обработки команды'
                });
            }
        });

        // ========== WEB INTERFACE ==========
        this.app.get('/', (req, res) => {
            const { session } = req.query;
            
            if (!session) {
                // Главная страница без сессии
                res.sendFile(path.join(__dirname, 'index.html'));
                return;
            }
            
            // Проверяем сессию
            const sessionData = this.sessions.get(session);
            if (!sessionData) {
                res.status(400).send('Invalid or expired session');
                return;
            }
            
            res.sendFile(path.join(__dirname, 'index.html'));
        });

        // ========== API ENDPOINTS ==========

        // Proxy for sticker files - hash lookup, token never exposed
        this.app.get('/proxy/sticker', async (req, res) => {
            const hash = req.query.id;
            if (!hash) {
                return res.status(400).send('Missing id parameter');
            }

            const url = this.telegram.getUrlFromHash(hash); // Нужен метод в TelegramAPI
            if (!url) {
                return res.status(404).send('Sticker not found');
            }

            try {
                const axios = require('axios');
                const response = await axios({
                    method: 'GET',
                    url: url,
                    responseType: 'arraybuffer'
                });

                // Set appropriate content type based on URL
                let contentType = 'application/octet-stream';
                if (url.includes('.webp')) contentType = 'image/webp';
                else if (url.includes('.png')) contentType = 'image/png';
                else if (url.includes('.webm')) contentType = 'video/webm';
                else if (url.includes('.tgs')) contentType = 'application/octet-stream';

                res.set('Content-Type', contentType);
                res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24h
                res.send(response.data);
            } catch (error) {
                console.error('Sticker proxy error:', error.message);
                res.status(500).send('Failed to fetch sticker');
            }
        });

        // Serve converted GIF files
        if (this.webmHandler) {
            this.app.get('/gif/:filename', (req, res) => {
                const gifPath = path.join(__dirname, '..', 'gif-cache', req.params.filename);
                res.sendFile(gifPath);
            });
        }
        
        // Получить список пакетов
        this.app.get('/api/packs', (req, res) => {
            const defaultPacks = ['memezey', 'pepetop', 'HotCherry'];
            const customPacks = this.getCustomPacks().map(pack => pack.name);
            res.json([...defaultPacks, ...customPacks]);
        });

        // Получить стикеры из пакета
        this.app.get('/api/pack/:name', async (req, res) => {
            const packName = req.params.name;

            // Проверяем кэш
            if (this.stickerCache.has(packName)) {
                return res.json(this.stickerCache.get(packName));
            }

            // Проверяем кастомные пакеты
            let telegramPackName = packName;
            const customPacks = this.getCustomPacks();
            const customPack = customPacks.find(pack => pack.name === packName);
            if (customPack) {
                telegramPackName = customPack.telegramName;
            }

            const stickers = await this.telegram.getAllStickerUrls(telegramPackName, true);
            
            if (stickers.length > 0) {
                this.stickerCache.set(packName, stickers);
            }

            res.json(stickers.map(s => ({
                url: s.url, // Это должен быть проксированный URL типа /proxy/sticker?id=abc123
                emoji: s.emoji,
                isAnimated: s.isAnimated,
                isVideo: s.isVideo
            })));
        });

        // Отправить стикер (общий endpoint)
        this.app.post('/api/send', async (req, res) => {
            const { packName, stickerIndex, sessionId } = req.body;

            const session = this.sessions.get(sessionId);
            if (!session) {
                return res.status(400).json({ error: 'Invalid session' });
            }

            // Определяем Telegram имя пакета
            let telegramPackName = packName;
            const customPacks = this.getCustomPacks();
            const customPack = customPacks.find(pack => pack.name === packName);
            if (customPack) {
                telegramPackName = customPack.telegramName;
            }

            const sticker = await this.telegram.getStickerUrl(telegramPackName, stickerIndex);
            if (!sticker) {
                return res.status(400).json({ error: 'Failed to get sticker' });
            }

            // Обрабатываем анимированные стикеры
            let gifFilePath = null;
            
            if (this.webmHandler) {
                try {
                    if (sticker.includes('.webm')) {
                        gifFilePath = await this.webmHandler.convertWebmToGif(sticker);
                        console.log(`Converted WEBM to GIF: ${gifFilePath}`);
                    } else if (sticker.includes('.tgs') && this.tgsHandler) {
                        gifFilePath = await this.tgsHandler.convertTgsToGif(sticker);
                        if (gifFilePath) {
                            console.log(`Converted TGS to GIF: ${gifFilePath}`);
                        }
                    }

                    // Загружаем GIF если сконвертировали
                    if (gifFilePath) {
                        const fileInfo = await uploadFile(
                            this.bot.serverUrl,
                            this.bot.botToken,
                            session.channelId,
                            gifFilePath,
                            `sticker_${packName}_${stickerIndex}.gif`
                        );

                        await sendFileAsPost(
                            this.bot.serverUrl,
                            this.bot.botToken,
                            session.channelId,
                            fileInfo,
                            `@${session.username}\n`
                        );

                        return res.json({ success: true });
                    }
                } catch (err) {
                    console.error('Failed to convert/upload GIF:', err);
                }
            }

            // Статичные изображения
            await this.bot.sendMessage(session.channelId, `@${session.username}\n![sticker](${sticker})`);
            res.json({ success: true });
        });

        // Создать сессию для веб-интерфейса
        this.app.post('/api/session', (req, res) => {
            const { channelId, userId, username } = req.body;
            const sessionId = Math.random().toString(36).slice(2, 12).padEnd(10, '0');

            this.sessions.set(sessionId, {
                channelId,
                userId,
                username: username || userId,
                created: Date.now(),
                isSlashCommand: false
            });

            // Очистка старых сессий
            this.cleanupOldSessions();

            res.json({ sessionId });
        });

        // Создать сессию для slash-команды
        this.app.post('/api/slash-session', (req, res) => {
            const { channelId, userId, username } = req.body;
            const sessionId = `slash_${Date.now()}_${userId}`;

            this.sessions.set(sessionId, {
                channelId,
                userId,
                username: username || `user_${userId}`,
                created: Date.now(),
                isSlashCommand: true
            });

            this.cleanupOldSessions();
            res.json({ sessionId });
        });

        // Добавить кастомный пакет
        this.app.post('/api/add-pack', async (req, res) => {
            try {
                const { packName, packUrl } = req.body;

                if (!packName || !packUrl) {
                    return res.status(400).json({ error: 'Pack name and URL are required' });
                }

                const urlMatch = packUrl.match(/(?:t\.me\/addstickers\/|telegram\.me\/addstickers\/)([^\/\?\#]+)/i);
                if (!urlMatch) {
                    return res.status(400).json({ 
                        error: 'Invalid Telegram sticker pack URL' 
                    });
                }

                const telegramPackName = urlMatch[1];
                await this.addCustomPack(packName, telegramPackName);

                res.json({ message: 'Pack added successfully' });
            } catch (error) {
                console.error('Error adding custom pack:', error);
                res.status(500).json({ error: 'Failed to add pack' });
            }
        });

        // Proxy для TGS файлов
        this.app.get('/proxy/tgs', async (req, res) => {
            const url = req.query.url;
            if (!url) return res.status(400).send('Missing URL');

            try {
                const axios = require('axios');
                const response = await axios({
                    method: 'GET',
                    url: url,
                    responseType: 'arraybuffer'
                });
                res.set('Content-Type', 'application/octet-stream');
                res.send(response.data);
            } catch (error) {
                console.error('TGS proxy error:', error.message);
                res.status(500).send('Failed to fetch TGS file');
            }
        });

        // GIF файлы из кэша
        if (this.webmHandler) {
            this.app.get('/gif/:filename', (req, res) => {
                const gifPath = path.join(__dirname, '..', 'gif-cache', req.params.filename);
                res.sendFile(gifPath);
            });
        }
    }

    getHelpText() {
        return `
## 🎉 Telegram Sticker Bot

**Команды:**
• \`/sticker help\` - Показать это меню
• \`/sticker ass\` - Открыть интерфейс выбора стикеров

**Особенности:**
✅ Работает в любом канале или в личных сообщениях
✅ Не нужно добавлять бота в чат
✅ Поддержка анимированных стикеров (WebM / TGS → GIF)
✅ Веб-интерфейс для удобства выбора

**Как использовать:**
1. Введите \`/sticker ass\` в любомм чате
2. Откройте ссылку в браузере
3. Выберите пакет стикеров и нажмите на любой стикер
4. Он будет отправлен в этот чат!

_💡 Совет: Вы можете добавлять пользовательские пакеты наклеек через веб-интерфейс_
        `;
    }

    async generateSlashPickerLink(channelId, userId) {
        // Получаем имя пользователя
        let username = `user_${userId}`;
        try {
            const userInfo = await this.bot.getUserInfo(userId);
            if (userInfo && userInfo.username) {
                username = userInfo.username;
            }
        } catch (error) {
            console.log('Could not get user info:', error.message);
        }

        // Создаем сессию
//      const sessionId = `slash_${Date.now()}_${userId}`;
        const sessionId = Math.random().toString(36).slice(2, 12).padEnd(10, '0');

        this.sessions.set(sessionId, {
            channelId,
            userId,
            username,
            created: Date.now(),
            isSlashCommand: true
        });

        console.log(`Generated slash picker link for user: ${username} (${userId})`);
        
        const domain = process.env.DOMAIN || 'http://localhost';
        const port = this.port;
//      return `${domain}:${port}/?session=${sessionId}`;
        return `${domain}/?session=${sessionId}`;
    }

    cleanupOldSessions() {
        const now = Date.now();
        for (const [id, session] of this.sessions) {
            if (now - session.created > 10 * 60 * 1000) { // 10 минут
                this.sessions.delete(id);
            }
        }
    }

    async addCustomPack(packName, telegramPackName) {
        const fs = require('fs');
        const path = require('path');
        const customPacksFile = path.join(__dirname, '..', 'custom-packs.json');

        let customPacks = [];
        try {
            if (fs.existsSync(customPacksFile)) {
                customPacks = JSON.parse(fs.readFileSync(customPacksFile, 'utf8'));
            }
        } catch (error) {
            console.error('Error reading custom packs:', error);
        }

        // Проверяем, существует ли пакет
        const existingPack = customPacks.find(pack =>
            pack.name.toLowerCase() === packName.toLowerCase() ||
            pack.telegramName === telegramPackName
        );

        if (existingPack) {
            throw new Error('Pack already exists');
        }

        customPacks.push({
            name: packName,
            telegramName: telegramPackName,
            added: new Date().toISOString()
        });

        fs.writeFileSync(customPacksFile, JSON.stringify(customPacks, null, 2));
        console.log(`Added custom pack: ${packName} (${telegramPackName})`);
    }

    getCustomPacks() {
        const fs = require('fs');
        const path = require('path');
        const customPacksFile = path.join(__dirname, '..', 'custom-packs.json');

        try {
            if (fs.existsSync(customPacksFile)) {
                return JSON.parse(fs.readFileSync(customPacksFile, 'utf8'));
            }
        } catch (error) {
            console.error('Error reading custom packs:', error);
        }

        return [];
    }

    start() {
        const host = process.env.ASS_HOST || '0.0.0.0';
        this.app.listen(this.port, host, () => {
            console.log(`🌐 Web picker running on http://${host}:${this.port}`);
            console.log(`🔗 Slash command endpoint: http://${host}:${this.port}/slash-command`);
        });
    }
}

module.exports = WebPicker;
