require('dotenv').config();
const { Telegraf, Scenes, session } = require('telegraf');
const fs = require('fs');
const path = require('path');
const rssService = require('./rssService');
const { processFile } = require('./moduleFiletoPost');
const { User, PostFile, findUser, addUserLicKey, Subscription, saveSubscription, deleteSubscription, getSubscriptions, getDetailedSubscriptions } = require('./databaseService');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const subscribeScene = new Scenes.BaseScene('subscribeScene');
subscribeScene.enter((ctx) => {
    ctx.reply('Пожалуйста, отправьте RSS ссылку.');
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
                await ctx.reply(`Вы подписались на обновления RSS-ленты!\n\nRSS: ${ctx.session.rssLink}\nПосты пойдут в канал/группу: ${channelName} [ID: ${channelId}]\n\nЧтобы посмотреть список активных RSS-лент, нажмите на команду /my_subscriptions\n\nЖелаем приятной работы с ботом!`);
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

const authScene = new Scenes.BaseScene('authScene');
authScene.enter(async (ctx) => {
    const userId = ctx.from.id.toString();
    const user = await findUser(userId);

    if (user && user.licKeys) {
        ctx.reply(`Рады видеть Вас снова, ${user.username}! 😊\n\nВы уже успешно зарегистрировались в системе!\n\nПожалуйста, используйте кнопки ниже, чтобы начать работу с AUTOPOST BOT!\n\nЖелаем Вам приятной работы!`, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'RSS-постинг', callback_data: 'subscribe' },
                        { text: 'Автопостинг из файла', callback_data: 'autopostfile' }
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

const stage = new Scenes.Stage();
stage.register(subscribeScene);
stage.register(authScene);
bot.use(session());
bot.use(stage.middleware());


bot.start((ctx) => {
    const welcomeMessage = '<b>Добро пожаловать в бота AUTOPOST BOT!</b>\n\nЕсли Вы уже приобрели подписку, пожалуйста, нажмите на кнопку <b>🔐 Авторизация</b>\n\nПосле успешной авторизации Вы сможете использовать бота для своей работы!\n\nЕсли Вы ещё не приобрели лицензионный ключ, пожалуйста, нажмите на кнопку <b>🛒 Купить ключ</b> и следуйте инструкции.\n\n<b>Желаем приятной работы с ботом!</b>';
    const imagePath = path.resolve(__dirname, 'logoAutoPostBot.png');

    ctx.replyWithPhoto({ source: fs.createReadStream(imagePath) }, {
        caption: welcomeMessage,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔐 Авторизация', callback_data: 'auth' },{ text: '🛒 Купить ключ', callback_data: 'buy' }],
                
            ],
        },
    });
});



bot.action('auth', async (ctx) => {
    await ctx.scene.enter('authScene');
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

    ctx.reply('Пожалуйста, отправьте мне файл для автопостинга в формате XLSX, CSV или JSON.');
    ctx.session.awaitingFile = true; // Метка ожидания файла
});

bot.on('document', async (ctx) => {
    if (ctx.session && ctx.session.awaitingFile) {
        try {
            // Получаем информацию о файле
            const fileId = ctx.message.document.file_id;
            const fileLink = await ctx.telegram.getFileLink(fileId);

            ctx.reply('Файл получен, начинаю обработку...');

            await processFile(fileLink); // Обработка файла

            ctx.reply('Файл успешно обработан и загружен в базу данных.');
        } catch (error) {
            console.error('Ошибка при обработке файла:', error);
            ctx.reply('Произошла ошибка при обработке файла.');
        }

        delete ctx.session.awaitingFile; // Очищаем метку ожидания файла
    } else {
        ctx.reply('Отправьте файл после активации команды автопостинга через /autopostfile');
    }
});

  bot.command('my_subscriptions', async (ctx) => {
    console.log("Команда /my_subscriptions активирована");
    const userId = ctx.from.id.toString();
    const detailedSubscriptions = await getDetailedSubscriptions(userId);

    if (detailedSubscriptions.length === 0) {
        ctx.reply('У вас пока нет подписок.😳\n\nЧтобы настроить RSS-подписку, используйте команду /subscribe');
        return;
    }

    let message = '<b>Ваши действующие подписки на RSS-ленты и активные каналы:</b>\n';
    const inlineKeyboard = [];

    detailedSubscriptions.forEach((sub, index) => {
        message += `📜 ${sub.channelName} | [ID: ${sub.channelId}]\n`;

        sub.rssFeeds.forEach(feed => {
            message += `- ${feed}\n`;
            inlineKeyboard.push([
                { text: `Удалить ${feed}`, callback_data: `delete_${sub._id}` } // Используем `_id` подписки
            ]);
        });
        message += '➖➖➖\n';
    });

    ctx.replyWithHTML(message, {
        reply_markup: { inline_keyboard: inlineKeyboard }
    });
});

bot.action(/delete_(.+)/, async (ctx) => {
    const subscriptionId = ctx.match[1]; // Получаем ID подписки из callback_data
    try {
        const result = await Subscription.findByIdAndDelete(subscriptionId); // Удаляем подписку по ID
        if (result) {
            await ctx.answerCbQuery(`Подписка успешно удалена`);

            // Получаем обновлённый список подписок пользователя
            const userId = ctx.from.id.toString(); // Убедитесь, что ID пользователя корректно преобразован в строку, если это необходимо
            const detailedSubscriptions = await getDetailedSubscriptions(userId);

            // Проверяем, остались ли активные подписки
            if (detailedSubscriptions.length > 0) {
                let messageText = '<b>Ваши действующие подписки на RSS-ленты и активные каналы:</b>\n';
                detailedSubscriptions.forEach(sub => {
                    messageText += `📜 ${sub.channelName} | [ID: ${sub.channelId}]\n`;
                    sub.rssFeeds.forEach(feed => {
                        messageText += `- ${feed}\n`;
                    });
                    messageText += '➖➖➖\n';
                });
                // Отправляем пользователю обновлённый список подписок
                await ctx.replyWithHTML(messageText);
            } else {
                // Если у пользователя не осталось подписок, сообщаем об этом
                await ctx.reply('У вас больше нет активных подписок.');
            }
        } else {
            await ctx.answerCbQuery(`Не удалось найти подписку`, true);
        }
    } catch (error) {
        console.error('Ошибка при удалении подписки:', error);
        await ctx.answerCbQuery(`Произошла ошибка при удалении подписки`, true);
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

setInterval(checkAndSendUpdates, 60000);

bot.launch();
console.log('Бот запущен...');