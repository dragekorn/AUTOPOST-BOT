// utils.js
const { Markup } = require('telegraf');
const { User, UserProject, createNewProject, PostFile, findUser, addUserLicKey, Subscription, saveSubscription, deleteSubscription, getSubscriptions, getDetailedSubscriptions } = require('./databaseService');

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
      ]
      // [
      //   Markup.button.callback('⚙️ Установить шаблон для постов', 'set_template')
      // ]
    ]));
  }

  function formatPostMessage(post) {
    if (post && post.data && Array.isArray(post.data)) {
        return post.data.join('\n');
    } else {
        console.error('Invalid post data:', post);
        return 'Ошибка: данные поста недоступны или некорректны.';
    }
}

function extractDomainName(url) {
  const matches = url.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
  return matches && matches[1] ? matches[1] : '';
}

module.exports = { extractDomainName, formatPostMessage, errorFileMessage, successMessage, successMessageWithQuestion };