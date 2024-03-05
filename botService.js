// botService.js
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');

const initializeBot = (token) => {
    const bot = new Telegraf(token);
        
        bot.start((ctx) => {
            const welcomeMessage = '<b>Добро пожаловать в бота AUTOPOST BOT!</b>\n\nЕсли Вы уже приобрели подписку, пожалуйста, нажмите на кнопку <b>🔐 Авторизация</b>\n\nПосле успешной авторизации Вы сможете использовать бота для своей работы!\n\nЕсли Вы ещё не приобрели лицензионный ключ, пожалуйста, нажмите на кнопку <b>🛒 Купить ключ</b> и следуйте инструкции.\n\n<b>Желаем приятной работы с ботом!</b>';
            const imagePath = path.resolve(__dirname, 'logoAutoPostBot.png');
        
            ctx.replyWithPhoto({ source: fs.createReadStream(imagePath) }, {
                caption: welcomeMessage,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔐 Авторизация', callback_data: 'auth' },{ text: '🛒 Купить ключ', callback_data: 'buy' }],
                        [{ text: '💬 Комментарии', callback_data: 'comments' }]
                        
                    ],
                },
            });
        });
    return bot;
};

module.exports = { initializeBot };