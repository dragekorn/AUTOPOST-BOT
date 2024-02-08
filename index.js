require('dotenv').config();
const { initializeBot } = require('./botService');
const { Scenes, session, Markup } = require('telegraf');
const rssService = require('./rssService');
const { processFile } = require('./moduleFiletoPost');
const { extractDomainName, formatPostMessage, successMessage, successMessageWithQuestion } = require('./utils');
const { User, PostFile, findUser, addUserLicKey, Subscription, saveSubscription, deleteSubscription, getSubscriptions, getDetailedSubscriptions } = require('./databaseService');

const fs = require('fs');
const path = require('path');


const bot = initializeBot(process.env.TELEGRAM_BOT_TOKEN);

const subscribeScene = new Scenes.BaseScene('subscribeScene');
subscribeScene.enter((ctx) => {
    ctx.reply('Пожалуйста, отправьте RSS ссылку.', Markup.inlineKeyboard([
        Markup.button.callback('Отмена', 'cancel')
    ]));
    ctx.session.awaitingInput = 'rssLink';
    ctx.session.timeout = setTimeout(() => {
        if (ctx.scene.current) {
            ctx.reply('Вы не ввели ссылку на RSS-ленту. Чтобы попробовать заново, введите команду /subscribe');
            ctx.scene.leave();
        }
    }, 300000);
});

subscribeScene.on('text', async (ctx) => {
    if (ctx.session.awaitingInput === 'rssLink') {
        const rssLink = ctx.message.text;
        if (/^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/.test(rssLink)) {
            ctx.session.rssLink = rssLink;
            ctx.session.awaitingInput = 'channelId';
            await ctx.reply('Теперь отправьте мне ID канала или группы, куда следует отправлять посты.');
        } else {
            await ctx.reply('Введите, пожалуйста, корректную ссылку на RSS-ленту.');
        }
    } else if (ctx.session.awaitingInput === 'channelId') {
        const channelId = ctx.message.text;
        if (/^-100\d{10}$/.test(channelId)) {
            let channelName = '';
            try {
                const chat = await bot.telegram.getChat(channelId);
                channelName = chat.title;
                await saveSubscription(ctx.from.id, ctx.session.rssLink, channelId, channelName);
                await ctx.replyWithHTML(`<b>Вы подписались на обновления RSS-ленты!</b>\n\nRSS: ${ctx.session.rssLink}\nПосты пойдут в канал/группу: ${channelName} [ID: ${channelId}]\n\nЧтобы посмотреть список активных RSS-лент, нажмите на кнопку ниже.\n\n<b>Желаем приятной работы с ботом!</b>`, {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🗄 Мои RSS подписки', callback_data: 'my_subscriptions' }
                            ]
                        ]
                    }
                });
                clearTimeout(ctx.session.timeout);
                ctx.scene.leave();
            } catch (error) {
                console.error('Ошибка при получении названия канала:', error);
                await ctx.reply('Произошла ошибка при получении информации о канале. Пожалуйста, проверьте ID и попробуйте снова.');
            }
        } else {
            await ctx.reply('Введите, пожалуйста, корректный ID канала или группы. ID должен начинаться с -100 и содержать 13 цифр.');
        }
    }
});

subscribeScene.action('cancel', (ctx) => {
    ctx.reply('Действие отменено. Возвращаемся в главное меню...');
    ctx.scene.enter('authScene');
});

const authScene = new Scenes.BaseScene('authScene');
authScene.enter(async (ctx) => {
    const userId = ctx.from.id.toString();
    const user = await findUser(userId);

    if (user && user.licKeys) {
        ctx.reply(`Рады видеть Вас снова, ${user.username}! 😊\n\nВы уже успешно зарегистрировались в системе!\n\nПожалуйста, используйте кнопки ниже, чтобы начать работу с AUTOPOST BOT!\n\nЖелаем Вам приятной работы!`, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '⭐️ RSS-постинг', callback_data: 'subscribe' },
                        { text: '📂 Автопостинг из файла', callback_data: 'autopostfile' }
                    ],
                    [
                        { text: '🗄 Мои RSS подписки', callback_data: 'my_subscriptions' }
                    ]
                ]
            }
        });
        ctx.scene.leave();
    } else {
        ctx.reply('Введите ваш лицензионный ключ.');
    }
});

authScene.on('text', async (ctx) => {
    const userKey = ctx.message.text;
    const keys = require('./key.json');

    if (keys.includes(userKey)) {
        const updatedKeys = keys.filter(key => key !== userKey);
        fs.writeFileSync('key.json', JSON.stringify(updatedKeys));

        await addUserLicKey(ctx.from.id.toString(), userKey, ctx.from.username);
        ctx.reply('Вы успешно авторизованы. Теперь вы можете использовать команду /subscribe.');
        ctx.scene.leave();
    } else {
        ctx.reply('Неверный ключ. Пожалуйста, введите корректный ключ.');
    }
});

const autopostingScene = new Scenes.BaseScene('autopostingScene');

autopostingScene.enter(async (ctx) => {
    await ctx.reply("Пожалуйста, отправьте ID канала или группы для автопостинга.");
});

autopostingScene.on('text', async (ctx) => {
    const chatId = ctx.message.text;
    const userId = ctx.from.id.toString();
    const hasAdminRights = await checkBotAdminRights(ctx, chatId);

    if (hasAdminRights) {
        await startAutoposting(ctx, chatId, userId);
    } else {
        await ctx.reply("У бота нет прав администратора в этом канале/группе.\nПожалуйста, добавьте бота в группу и сделайте его администратором. После чего, снова отправьте запрос.");
    }

    await ctx.scene.leave();
});

const stage = new Scenes.Stage();
stage.register(subscribeScene);
stage.register(authScene);
stage.register(autopostingScene);
bot.use(session());
bot.use(stage.middleware());


bot.action('auth', async (ctx) => {
    await ctx.scene.enter('authScene');
});

bot.action('cancel', (ctx) => {
    ctx.reply('Действие отменено. Возвращаемся в главное меню...');
    ctx.scene.enter('authScene');
});

bot.action('my_subscriptions', async (ctx) => {
    console.log("Команда /my_subscriptions активирована");
    const userId = ctx.from.id.toString();
    const detailedSubscriptions = await getDetailedSubscriptions(userId);

    if (detailedSubscriptions.length === 0) {
        ctx.reply('У вас пока нет подписок.😳\n\nЧтобы настроить RSS-подписку, нажмите на кнопку ниже!', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⭐️ Добавить RSS-линк', callback_data: 'subscribe' }],
                ]
            }
        });
        return;
    }

    let message = '<b>Ваши действующие подписки на RSS-ленты и активные каналы:</b>\n\n';
    const inlineKeyboard = [];

    detailedSubscriptions.forEach((sub, index) => {
        message += `📜 <b>${sub.channelName}</b>\n[ID: <code>${sub.channelId}</code>]\n`;

        sub.rssFeeds.forEach((feed, feedIndex) => {
            const domainName = extractDomainName(feed); // Извлекаем имя домена из URL
            message += `🔗 <a href="${feed}">${domainName}</a>\n`;
            inlineKeyboard.push([{ text: `Удалить ${domainName}`, callback_data: `delete_${sub.subId}_${feedIndex}` }]);
        });

        // Добавляем разделитель между подписками, если есть несколько подписок
        if (index < detailedSubscriptions.length - 1) {
            message += '➖➖➖\n';
        }
    });

    // Добавляем кнопку "Добавить RSS-линк" только один раз в конец всех кнопок
    inlineKeyboard.push([{ text: '⭐️ Добавить RSS-линк', callback_data: 'subscribe' }]);

    ctx.replyWithHTML(message, {
        reply_markup: { inline_keyboard: inlineKeyboard }
    });
});

bot.action('buy', (ctx) => {
    const buyMessage = '<b>Чтобы приобрести ключ, отсканируйте, пожалуйста, QR-код выше и совершите оплату</b>\n\n<u>После оплаты, Вам необходимо написать</u> @arhi_pro, предварительно подготовив скриншот об оплате.\n\nПосле проверки платежа, Вам выдадут лицензионный ключ, который Вы сможете использовать для аутентификации!\n\n<b>Приятной работы с ботом AUTOPOST BOT! 🤖</b> ';
    const imagePath = path.resolve(__dirname, 'qr.jpg');
    ctx.replyWithPhoto({ source: fs.createReadStream(imagePath) }, { 
        caption: buyMessage, 
        parse_mode: 'HTML',
        reply_markup:{
            inline_keyboard: [
                [{ text: '🔐 Авторизация', callback_data: 'auth' }],
            ],
        },
    });
});

bot.action('subscribe', async (ctx) => {
    const userId = ctx.from.id.toString();
    const user = await findUser(userId);
    
    if (!user || !user.licKeys) {
        ctx.reply('Для использования этой команды необходимо авторизоваться. Пожалуйста, введите команду /auth <ваш_ключ>.');
        return;
    }
    
    ctx.scene.enter('subscribeScene');
});

bot.action('autopostfile', async (ctx) => {
    // Проверка на наличие лицензионного ключа у пользователя
    const userId = ctx.from.id.toString();
    const user = await findUser(userId);

    if (!user || !user.licKeys) {
        await ctx.reply('Для использования этой функции необходима авторизация.');
        return;
    }

    ctx.replyWithHTML('Пожалуйста, отправьте мне файл для автопостинга в формате XLSX, CSV или JSON.\n\nОбязательно убедитесь, что структура Вашего файла следующая:\n<b>Заголовок статьи</b>\n<b>Текст статьи</b>\n<b>Подписи хэштеги</b>\n\nЕсли у Вас такая структура, отправляйте файл. Если нет, пожалуйста, приведите Ваш файл в должный вид.', Markup.inlineKeyboard([
        Markup.button.callback('Отмена', 'cancel')
    ]));
    ctx.session.awaitingFile = true; // Метка ожидания файла
});

bot.on('document', async (ctx) => {
    if (ctx.session && ctx.session.awaitingFile) {
        try {
            // Получаем информацию о файле
            const chatId = ctx.chat.id;  // Исправлено здесь
            const fileId = ctx.message.document.file_id;
            const fileLink = await ctx.telegram.getFileLink(fileId);

            ctx.reply('Файл получен, начинаю обработку...');

            await processFile(ctx, fileLink); // Обработка файла
        } catch (error) {
            console.error('Ошибка при обработке файла:', error);
            ctx.reply('Произошла ошибка при обработке файла.');
        }

        delete ctx.session.awaitingFile; // Очищаем метку ожидания файла
    } else {
        ctx.reply('Отправьте файл после активации команды автопостинга через /autopostfile');
    }
});

bot.action(/delete_(.+)/, async (ctx) => {
    const subId = parseInt(ctx.match[1]); // Парсим subId из callback_data
  
    try {
      const result = await Subscription.findOneAndDelete({ subId: subId }); // Используем subId для поиска и удаления
      if (result) {
        await ctx.answerCbQuery('Подписка успешно удалена');

        // Получаем обновлённый список подписок пользователя
        const userId = ctx.from.id.toString();
        const detailedSubscriptions = await getDetailedSubscriptions(userId);

        // Формируем обновлённое сообщение и клавиатуру
        let messageText = '<b>Ваши действующие подписки на RSS-ленты и активные каналы:</b>\n\n';
        const inlineKeyboard = [];

        detailedSubscriptions.forEach((sub, index) => {
            messageText += `📜 <b>${sub.channelName}</b>\n[ID: <code>${sub.channelId}</code>]\n`;

            sub.rssFeeds.forEach((feed, feedIndex) => {
                const domainName = extractDomainName(feed); // Извлекаем имя домена из URL
                messageText += `🔗 <a href="${feed}">${domainName}</a>\n`;
                inlineKeyboard.push([{ text: `Удалить ${domainName}`, callback_data: `delete_${sub.subId}_${feedIndex}` }]);
            });

        // Добавляем разделитель между подписками, если есть несколько подписок
        if (index < detailedSubscriptions.length - 1) {
            messageText += '➖➖➖\n';
        }
    });

        inlineKeyboard.push([{ text: '⭐️ Добавить RSS-линк', callback_data: 'subscribe' }]);

        // Обновляем сообщение
        await ctx.editMessageText(messageText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: inlineKeyboard } });
      } else {
        await ctx.answerCbQuery('Не удалось найти подписку', true);
      }
    } catch (error) {
      console.error('Ошибка при удалении подписки:', error);
      await ctx.answerCbQuery('Произошла ошибка при удалении подписки', true);
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


bot.action('start_autoposting', async (ctx) => {
    await ctx.scene.enter('autopostingScene');
});


bot.action('pause_autoposting', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    // Это просто пример. Вам нужно адаптировать его под вашу логику и структуру базы данных
    await updateUserAutopostingStatus(userId, { autopostingActive: false });

    // Отправляем сообщение пользователю о приостановке автопостинга
    await ctx.reply('Автопостинг приостановлен. Вы можете возобновить его в любое время, нажав "Продолжить автопостинг".', Markup.inlineKeyboard([
        Markup.button.callback('Продолжить автопостинг', 'resume_autoposting')
    ]));
});

bot.action('cancel_autoposting', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    // Здесь логика для полной отмены автопостинга, например, удаление заданий из очереди автопостинга
    await cancelUserAutoposting(userId);

    // Отправляем сообщение пользователю об отмене автопостинга
    await ctx.reply('Автопостинг отменен. Вы можете запустить новую сессию автопостинга в любое время.', Markup.inlineKeyboard([
        Markup.button.callback('Запустить автопостинг', 'start_autoposting'),
        Markup.button.callback('Загрузить новые посты', 'autopostfile')
    ]));
});

// Дополнительно, функция для возобновления автопостинга, если вам это нужно
bot.action('resume_autoposting', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    // Возобновляем автопостинг для пользователя
    await updateUserAutopostingStatus(userId, { autopostingActive: true });

    // Сообщение о возобновлении автопостинга
    await ctx.reply('Автопостинг возобновлен. Посты будут отправляться в соответствии с вашей настройкой.');
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
                    const retryAfter = error.response.parameters.retry_after * 1000;
                    console.log(`Waiting for ${retryAfter}ms before retrying...`);
                    setTimeout(() => checkAndSendUpdates(), retryAfter);
                    return;
                } else {
                    console.error(`Ошибка при отправке сообщения в ${channelId}:`, error);
                }
            }
        }
    }
};

async function checkBotAdminRights(ctx, chatId) {
    try {
        const member = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
        // Проверяем, что бот является администратором и имеет права на отправку сообщений
        if (member.status === 'administrator' && member.can_post_messages) {
            return true; // Бот имеет права администратора и может отправлять сообщения
        } else {
            return false; // Бот не имеет достаточных прав
        }
    } catch (error) {
        console.error("Ошибка при проверке прав администратора бота:", error);
        return false; // В случае ошибки также считаем, что бот не имеет прав
    }
}

async function startAutoposting(ctx, chatId, userId) {
    // Получаем непосланные посты из базы данных
    const posts = await PostFile.find({ isSent: false });

    if (posts.length > 0) {
        for (const post of posts) {
            // Отправляем посты в канал
            await ctx.telegram.sendMessage(chatId, formatPostMessage(post));
            // Обновляем статус поста на "отправленный"
            await PostFile.findByIdAndUpdate(post._id, { isSent: true });
        }
        await ctx.reply(`Автопостинг завершен. Отправлено ${posts.length} постов.`);
    } else {
        await ctx.reply("Нет постов для отправки.");
    }
}

setInterval(checkAndSendUpdates, 60000);

bot.launch().then(() => {
    console.log('Бот запущен...');
});