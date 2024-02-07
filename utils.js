// utils.js
const { Markup } = require('telegraf');

const successMessage = async (ctx, message) => {
    await ctx.replyWithHTML(message);
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

module.exports = { successMessage, successMessageWithQuestion };