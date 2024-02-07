// utils.js
const { Markup } = require('telegraf');

const successMessage = async (ctx, message) => {
    await ctx.replyWithHTML(message);
};

const errorFileMessage = async (ctx, message) => {
    await ctx.replyWithHTML(message, Markup.inlineKeyboard([
        [
            Markup.button.callback('🔄 Загрузить другой файл', 'autopostfile')
        ]
    ]));
};

async function successMessageWithQuestion(ctx, message, loadedPostsCount) {
    await ctx.replyWithHTML(`${message}\n\nУ Вас в БД уже ${loadedPostsCount} подготовленных постов. Желаете начать автопостинг?`, Markup.inlineKeyboard([
      [
        Markup.button.callback('▶️ Начать автопостинг', 'start_autoposting'),
        Markup.button.callback('🔄 Загрузить ещё', 'autopostfile')
      ],
      [
        Markup.button.callback('⚙️ Установить шаблон для постов', 'set_template')
      ]
    ]));
  }

module.exports = { errorFileMessage, successMessage, successMessageWithQuestion };