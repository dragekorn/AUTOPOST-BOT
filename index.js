require('dotenv').config();
const { Telegraf, Scenes, session } = require('telegraf');
const fs = require('fs');
const path = require('path');
const rssService = require('./rssService');
const { Subscription, saveSubscription, getSubscriptions, getDetailedSubscriptions } = require('./databaseService');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const subscribeScene = new Scenes.BaseScene('subscribeScene');
subscribeScene.enter((ctx) => {
    ctx.reply('Пожалуйста, отправьте RSS ссылку.');
    ctx.session.awaitingInput = 'rssLink'; // Установите ожидаемый ввод в "rssLink"
    // Установка таймера ожидания
    ctx.session.timeout = setTimeout(() => {
        if (ctx.scene.current) {
            ctx.reply('Вы не ввели ссылку на RSS-ленту. Чтобы попробовать заново, введите команду /subscribe');
            ctx.scene.leave();
        }
    }, 60000); // 1 минута ожидания
});

subscribeScene.on('text', async (ctx) => {
    if (ctx.session.awaitingInput === 'rssLink') {
        const rssLink = ctx.message.text;
        if (/^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/.test(rssLink)) {
            ctx.session.rssLink = rssLink;
            ctx.session.awaitingInput = 'channelId'; // Переходим к ожиданию ввода ID канала
            await ctx.reply('Теперь отправьте мне ID канала или группы, куда следует отправлять посты.');
        } else {
            await ctx.reply('Введите, пожалуйста, корректную ссылку на RSS-ленту.');
        }
    } else if (ctx.session.awaitingInput === 'channelId') {
        const channelId = ctx.message.text;
        if (/^-100\d{10}$/.test(channelId)) {
            // После получения корректного ID канала, выполните необходимые действия
            let channelName = '';
            try {
                const chat = await bot.telegram.getChat(channelId);
                channelName = chat.title;
                await saveSubscription(ctx.from.id, ctx.session.rssLink, channelId, channelName);
                await ctx.reply(`Вы подписались на обновления: ${ctx.session.rssLink} для канала/группы: ${channelName} [ID: ${channelId}]`);
                clearTimeout(ctx.session.timeout); // Отмена таймера ожидания
                ctx.scene.leave(); // Выход из сцены
            } catch (error) {
                console.error('Ошибка при получении названия канала:', error);
                await ctx.reply('Произошла ошибка при получении информации о канале. Пожалуйста, проверьте ID и попробуйте снова.');
            }
        } else {
            await ctx.reply('Введите, пожалуйста, корректный ID канала или группы. ID должен начинаться с -100 и содержать 13 цифр.');
        }
    }
});

const stage = new Scenes.Stage([subscribeScene]);
bot.use(session());
bot.use(stage.middleware());

bot.start((ctx) => {
    const welcomeMessage = '<b>Добро пожаловать в бота RSSAutoParser&Post!</b>\n\nЕсли Вы уже приобрели подписку, пожалуйста, введите команду <code>/auth ВашКод</code>\n\nПосле успешной авторизации Вы сможете использовать команду /subscribe.\n\nЕсли Вы ещё не приобрели лицензионный ключ, обратитесь к @russelallen\n\n<b>Желаем приятной работы с ботом!</b>';
    const imagePath = path.resolve(__dirname, 'logoAutoPostBot.png');

    // Отправка локального изображения с подписью
    ctx.replyWithPhoto({ source: fs.createReadStream(imagePath) }, { caption: welcomeMessage, parse_mode: 'HTML' });
});

bot.command('subscribe', async (ctx) => {
    const userId = ctx.from.id.toString(); // Убедитесь, что userId в строковом формате
    const user = await Subscription.findOne({ userId });
  
    if (!user || !user.licKeys) {
      ctx.reply('Для использования этой команды необходимо авторизоваться. Пожалуйста, введите команду /auth <ваш_ключ>.');
      return;
    }
  
    ctx.scene.enter('subscribeScene');
  });
  

bot.command('auth', async (ctx) => {
    const userKey = ctx.message.text.split(' ')[1]; // Предполагаем, что ключ идет после команды /auth
    const keys = require('./key.json');
  
    if (keys.includes(userKey)) {
      // Удалите использованный ключ из списка и обновите файл
      const updatedKeys = keys.filter(key => key !== userKey);
      fs.writeFileSync('key.json', JSON.stringify(updatedKeys));
  
      // Запишите ключ в базу данных для данного пользователя
      await Subscription.findOneAndUpdate({ userId: ctx.from.id }, { $set: { licKeys: userKey } }, { upsert: true });
      ctx.reply('Вы успешно авторизованы. Теперь вы можете использовать команду /subscribe.');
    } else {
      ctx.reply('Неверный ключ. Пожалуйста, введите корректный ключ.');
    }
  });
  

bot.command('my_subscriptions', async (ctx) => {
    console.log("Команда /my_subscriptions активирована");
    const userId = ctx.from.id;
    try {
        console.log(`Fetching subscriptions for user: ${userId}`);
        const detailedSubscriptions = await getDetailedSubscriptions(userId);
        console.log(`Subscriptions fetched:`, detailedSubscriptions);

        if (detailedSubscriptions.length === 0) {
            ctx.reply('У вас пока нет подписок.😳\n\nЧтобы настроить RSS-подписку, используйте команду /subscribe');
            return;
        }

        let message = '<b>Ваши действующие подписки на RSS-ленты и активные каналы:</b>\n';
        const channelsCount = detailedSubscriptions.length;
        const rssFeedsCount = detailedSubscriptions.reduce((acc, sub) => acc + sub.rssFeeds.length, 0);

        message += `📜Каналы/группы: ${channelsCount}\n📜RSS-ленты: ${rssFeedsCount}\n➖➖➖\nПодробные сведения:\n`;

        detailedSubscriptions.forEach(sub => {
            message += `В ${sub.channelName} | [ID: ${sub.channelId}] задействовано ${sub.rssFeeds.length} RSS-лент:\n`;
            sub.rssFeeds.forEach(feed => {
                message += `${feed}\n`;
            });
            message += '➖➖➖\n'; // Разделитель между каналами
        });

        ctx.replyWithHTML(message);
    } catch (err) {
        console.error('Ошибка при получении подписок:', err);
        ctx.reply('Произошла ошибка при попытке получить ваши подписки.');
    }
});

bot.on('text', async (ctx) => {
    if (ctx.session.rssLink) {
        const channelOrGroupId = ctx.message.text;
        const userId = ctx.from.id;
        const rssLink = ctx.session.rssLink;

        try {
            await saveSubscription(bot, userId, rssLink, channelOrGroupId);
            ctx.reply(`Вы подписались на обновления: ${rssLink} для канала/группы: ${channelOrGroupId}`);
            delete ctx.session.rssLink;
        } catch (error) {
            console.error(error);
            ctx.reply('Произошла ошибка при подписке.');
        }
    }
});

const checkAndSendUpdates = async () => {
    const subscriptions = await getSubscriptions();

    for (const subscription of subscriptions) {
        const { channelId, rssLink } = subscription;
        if (!channelId) {
            //console.warn(`chatId для подписки ${rssLink} не определен`);
            continue;
        }

        const newPosts = await rssService.getNewRSSPosts(rssLink, channelId);
        for (const post of newPosts) {
            try {
                if (post.imagePath) {
                    await bot.telegram.sendPhoto(channelId, {
                        source: fs.createReadStream(post.imagePath),
                        caption: post.formattedPost,
                        parse_mode: 'HTML'
                    });
                    fs.unlinkSync(post.imagePath);
                } else {
                    await bot.telegram.sendMessage(channelId, post.formattedPost, { parse_mode: 'HTML', disable_web_page_preview: true });
                }
            } catch (error) {
                if (error.response && error.response.error_code === 429) {
                    const retryAfter = error.response.parameters.retry_after * 1000; // Преобразование секунд в миллисекунды
                    console.log(`Waiting for ${retryAfter}ms before retrying...`);
                    setTimeout(() => checkAndSendUpdates(), retryAfter);
                    return; // Остановка текущего цикла обработки и переход к следующему
                } else {
                    console.error(`Ошибка при отправке сообщения в ${channelId}:`, error);
                }
            }
        }
    }
};

setInterval(checkAndSendUpdates, 60000);

bot.launch();
console.log('Бот запущен...');