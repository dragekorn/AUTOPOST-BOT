require('dotenv').config();
const { initializeBot } = require('./botService');
const { Scenes, session, Markup } = require('telegraf');
const rssService = require('./rssService');
const { processFile } = require('./moduleFiletoPost');
const { extractDomainName, formatPostMessage, successMessage, successMessageWithQuestion } = require('./utils');
const { User, UserProject, createNewProject, PostFile, findUser, addUserLicKey, Subscription, saveSubscription, deleteSubscription, getSubscriptions, getDetailedSubscriptions } = require('./databaseService');

const fs = require('fs');
const path = require('path');


const bot = initializeBot(process.env.TELEGRAM_BOT_TOKEN);

//сцена RSS-подписки
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

//сцена авторизации
const authScene = new Scenes.BaseScene('authScene');
authScene.enter(async (ctx) => {
    const userId = ctx.from.id.toString();
    const user = await findUser(userId);

    if (user && user.licKeys) {
        ctx.reply(`Рады видеть Вас снова, ${user.username}! 😊\n\nПожалуйста, используйте кнопки ниже, чтобы начать работу с AUTOPOST BOT!\n\nЖелаем Вам приятной работы!`, {
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
        ctx.reply('Добро пожаловать в AUTOPOST BOT! Чтобы использовать бота, используйте кнопки ниже.', {
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
        ctx.reply('Неверный ключ. Пожалуйста, введите корректный ключ.');
    }
});

//сцена автопостинга без шаблона
const autopostingScene = new Scenes.BaseScene('autopostingScene');

autopostingScene.enter(async (ctx) => {
    await ctx.reply("Пожалуйста, введите название вашего проекта для автопостинга.");
});

autopostingScene.on('text', async (ctx, next) => {
    const chatId = ctx.message.text;
    // Проверяем, ввели ли ID канала или название проекта
    if (/^-100\d+$/.test(ctx.message.text)) {
        // Проверяем, выбран ли проект
        console.log('Session data:', ctx.session);
        if (checkReadyForAutoposting(ctx)) {
            const chatId = ctx.message.text;
            const userId = ctx.from.id.toString();
            const hasAdminRights = await checkBotAdminRights(ctx, chatId);

            if (hasAdminRights) {
                await startAutoposting(ctx, chatId, ctx.session.userId, ctx.session.projectId, ctx.session.delay);
                ctx.session.projectId = null; // Очищаем projectId из сессии после запуска автопостинга
                ctx.session.delay = null; // Очищаем выбранную задержку из сессии
            } else {
                await ctx.reply("У бота нет прав администратора в этом канале/группе.\nПожалуйста, добавьте бота в группу и сделайте его администратором. После чего, снова отправьте запрос.");
            }
            await ctx.scene.leave(); // Выход из сцены после запуска или ошибки автопостинга
        } else {
            await ctx.reply("Пожалуйста, сначала выберите проект и задержку для автопостинга.");
        }
    } else {
        // Поиск проекта по имени
        const projectName = ctx.message.text;
        const project = await UserProject.findOne({ projectName: projectName, userID: ctx.from.id.toString() });
        if (project) {
            ctx.session.projectId = project._id.toString();
            await ctx.reply("Проект найден. Теперь выберите интервал задержки между постами.", Markup.inlineKeyboard([
                Markup.button.callback('5 секунд', 'delay_5000'),
                Markup.button.callback('10 секунд', 'delay_10000'),
                Markup.button.callback('1 минута', 'delay_60000'),
                Markup.button.callback('10 минут', 'delay_600000')
            ]));
        } else {
            await ctx.reply(`Проект "${projectName}" не найден. Попробуйте еще раз или создайте новый проект.`);
            // Здесь можно добавить логику для создания нового проекта
        }
    }
});

//сцена автопостинга с созданием своего проекта с собственным шаблоном
const selfTemplateScene = new Scenes.BaseScene('selfTemplateScene');

selfTemplateScene.enter((ctx) => {
    ctx.replyWithHTML('Введите название своего проекта:');
});

selfTemplateScene.on('text', async (ctx) => {
    const projectName = ctx.message.text;
    const userId = ctx.from.id;

    try {
        const newProject = await createNewProject(userId, projectName, []);
        ctx.session.projectId = newProject._id;
        ctx.reply('Проект создан успешно. Теперь, пожалуйста, отправьте мне файл с данными для постов.');
    } catch (error) {
        console.error('Ошибка при создании проекта:', error);
        ctx.reply('Произошла ошибка при создании проекта. Пожалуйста, попробуйте снова.');
    }
});

selfTemplateScene.on('document', async (ctx) => {
    const projectId = ctx.session.projectId;
    if (!projectId) {
        ctx.reply('Произошла ошибка: ID проекта не найден. Пожалуйста, начните процесс заново.', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Начать заново', callback_data: 'selfTemplateScene' }],
                ]
            }
        });
        ctx.scene.leave();
        return;
    }

    // Логика обработки файла
    const fileId = ctx.message.document.file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);

    try {
        const projectPosts = await processFile(ctx, fileLink); // Эта функция должна быть адаптирована для возврата данных постов
        ctx.session.projectPosts = projectPosts; // Сохраняем посты в сессии для использования в следующем шаге
        // ctx.reply('Файл успешно обработан. Теперь введите шаблон для сохранения постов в базу данных, используя поля из файла.');
    } catch (error) {
        if (error instanceof TimeoutError) {
            ctx.reply('Процесс занял слишком много времени и был прерван. Пожалуйста, попробуйте с файлом меньшего размера или повторите попытку позже.');
        } else {
            console.error('Ошибка при обработке файла:', error);
            ctx.reply('Произошла ошибка при обработке файла. Пожалуйста, попробуйте снова.');
        }
    }
});

// Шаг 4: Получение шаблона и запись постов в базу данных
// selfTemplateScene.on('text', async (ctx, next) => {
//     if (ctx.message.text.startsWith('/')) {
//         return next();
//     }

//     const projectId = ctx.session.projectId;
//     const projectPosts = ctx.session.projectPosts;
//     if (!projectId || !projectPosts) {
//         ctx.reply('Произошла ошибка: отсутствуют данные проекта или постов. Пожалуйста, начните процесс заново.', {
//             reply_markup: {
//                 inline_keyboard: [
//                     [{ text: 'Начать заново', callback_data: 'selfTemplateScene' }],
//                 ]
//             }
//         });
//         ctx.scene.leave();
//         return;
//     }

//     // Предполагается, что функция updateProjectPosts обновляет проект, добавляя посты с isSent: false
//     try {
//         await updateProjectPosts(projectId, projectPosts);
//         ctx.reply('Посты успешно добавлены в проект и готовы к автопостингу.');
//     } catch (error) {
//         console.error('Ошибка при сохранении постов:', error);
//         ctx.reply('Произошла ошибка при сохранении постов. Пожалуйста, попробуйте снова.');
//     }

//     ctx.scene.leave();
// });

const stage = new Scenes.Stage();
stage.register(subscribeScene);
stage.register(authScene);
stage.register(autopostingScene);
stage.register(selfTemplateScene);
bot.use(session());
bot.use(stage.middleware());


bot.action(/delay_(\d+)/, async (ctx) => {
    const delay = Number(ctx.match[1]);
    if (!ctx.session) ctx.session = {}; // Инициализация сессии, если она ещё не существует
    ctx.session.delay = delay;
    ctx.session.userId = ctx.from.id.toString(); // Повторная инициализация userId для уверенности
    await ctx.reply(`Задержка установлена на ${delay / 1000} секунд. Теперь отправьте ID канала или группы для автопостинга.`);
});

function checkReadyForAutoposting(ctx) {
    // Убедитесь, что все необходимые значения есть в сессии
    return ctx.session.projectId && ctx.session.delay && ctx.session.userId;
}

bot.action('selfTemplateScene', async (ctx) => {
    ctx.scene.enter('selfTemplateScene');
});

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
            const domainName = extractDomainName(feed);
            message += `🔗 <a href="${feed}">${domainName}</a>\n`;
            inlineKeyboard.push([{ text: `Удалить ${domainName}`, callback_data: `delete_${sub.subId}_${feedIndex}` }]);
        });

        if (index < detailedSubscriptions.length - 1) {
            message += '➖➖➖\n';
        }
    });

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
        ctx.reply('Для использования этой команды необходимо авторизоваться. Пожалуйста, нажмите на кнопку ниже.', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔐 Авторизация', callback_data: 'auth'}],
                ]
            }
        });
        return;
    }
    
    ctx.scene.enter('subscribeScene');
});

bot.action('autopostfile', async (ctx) => {
    const userId = ctx.from.id.toString();
    const user = await findUser(userId);

    if (!user || !user.licKeys) {
        await ctx.reply('Для использования этой функции необходима авторизация.', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔐 Авторизация', callback_data: 'auth'}],
                ]
            }
        });
        return;
    }

    ctx.replyWithHTML('Добро пожаловать в секцию автопостинга из файла.\n\nПожалуйста, нажмите на кнопку 📃 Создать проект и следуйте инструкциям.', 
    Markup.inlineKeyboard([
        Markup.button.callback('📃 Создать проект', 'selfTemplateScene'),
        Markup.button.callback('❌ Отмена', 'cancel')
    ]));
    ctx.session.awaitingFile = true;
});

bot.on('document', async (ctx) => {
    if (ctx.session && ctx.session.awaitingFile) {
        try {

            const chatId = ctx.chat.id;
            const fileId = ctx.message.document.file_id;
            const fileLink = await ctx.telegram.getFileLink(fileId);

            ctx.reply('Файл получен, начинаю обработку...');

            await processFile(ctx, fileLink);
        } catch (error) {
            console.error('Ошибка при обработке файла:', error);
            ctx.reply('Произошла ошибка при обработке файла.');
        }

        delete ctx.session.awaitingFile;
    } else {
        ctx.reply('Отправьте файл после активации команды автопостинга через /autopostfile');
    }
});

bot.action(/delete_(.+)/, async (ctx) => {
    const subId = parseInt(ctx.match[1]);
  
    try {
      const result = await Subscription.findOneAndDelete({ subId: subId });
      if (result) {
        await ctx.answerCbQuery('Подписка успешно удалена');

        const userId = ctx.from.id.toString();
        const detailedSubscriptions = await getDetailedSubscriptions(userId);

        let messageText = '<b>Ваши действующие подписки на RSS-ленты и активные каналы:</b>\n\n';
        const inlineKeyboard = [];

        detailedSubscriptions.forEach((sub, index) => {
            messageText += `📜 <b>${sub.channelName}</b>\n[ID: <code>${sub.channelId}</code>]\n`;

            sub.rssFeeds.forEach((feed, feedIndex) => {
                const domainName = extractDomainName(feed);
                messageText += `🔗 <a href="${feed}">${domainName}</a>\n`;
                inlineKeyboard.push([{ text: `Удалить ${domainName}`, callback_data: `delete_${sub.subId}_${feedIndex}` }]);
            });

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

bot.action('load_data', async (ctx) => {
    if (!ctx.session.xlsxData) {
      ctx.reply('Ошибка: отсутствуют данные для загрузки. Пожалуйста, загрузите файл снова.');
      return;
    }
  
    const data = ctx.session.xlsxData;
  
    try {
      for (const row of data) {
        // Создаем пост, где каждая строка - это массив данных
        await PostFile.create({ data: row.filter(cell => cell !== null) }); // Исключаем null (пустые ячейки)
      }
  
      ctx.reply(`Данные успешно загружены. Всего загружено ${data.length} постов.`);
    } catch (error) {
      console.error('Ошибка при загрузке данных:', error);
      ctx.reply('Произошла ошибка при загрузке данных. Пожалуйста, попробуйте снова.');
    } finally {
      delete ctx.session.xlsxData;
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
    
    await updateUserAutopostingStatus(userId, { autopostingActive: false });

    await ctx.reply('Автопостинг приостановлен. Вы можете возобновить его в любое время, нажав "Продолжить автопостинг".', Markup.inlineKeyboard([
        Markup.button.callback('Продолжить автопостинг', 'resume_autoposting')
    ]));
});

bot.action('cancel_autoposting', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    await cancelUserAutoposting(userId);

    await ctx.reply('Автопостинг отменен. Вы можете запустить новую сессию автопостинга в любое время.', Markup.inlineKeyboard([
        Markup.button.callback('Запустить автопостинг', 'start_autoposting'),
        Markup.button.callback('Загрузить новые посты', 'autopostfile')
    ]));
});

bot.action('resume_autoposting', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    await updateUserAutopostingStatus(userId, { autopostingActive: true });

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
        if (member.status === 'administrator' && member.can_post_messages) {
            return true;
        } else {
            return false;
        }
    } catch (error) {
        console.error("Ошибка при проверке прав администратора бота:", error);
        return false;
    }
}

async function safeSendMessage(ctx, chatId, message, options) {
    try {
        await ctx.telegram.sendMessage(chatId, message, options);
    } catch (error) {
        if (error.code === 429) { // Проверка на ошибку ограничения скорости
            const retryAfter = error.parameters.retry_after;
            console.log(`Rate limit hit, waiting for ${retryAfter} seconds`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            // Повторная отправка сообщения после задержки
            await ctx.telegram.sendMessage(chatId, message, options);
        } else {
            throw error; // Если ошибка не связана с ограничением скорости, перебрасываем её дальше
        }
    }
}

function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secondsLeft = seconds % 60;

    return [
        hours.toString().padStart(2, '0'),
        minutes.toString().padStart(2, '0'),
        secondsLeft.toString().padStart(2, '0')
    ].join(':');
}

async function startAutoposting(ctx, chatId, userId, projectId, delay) {
    const projectExists = await UserProject.exists({ _id: projectId, userID: userId });
    if (!projectExists) {
        await ctx.reply("Проект не найден или вы не имеете к нему доступ.");
        return;
    }

    const postsToSend = await PostFile.find({ projectId: projectId, isSent: false });
    const totalPosts = postsToSend.length;
    let sentCount = 0;

    // Отправляем исходное сообщение с информацией об автопостинге
    const statusMessage = await ctx.reply(`Автопостинг запущен.\n\nСообщений отправлено: 0\nСообщений в очереди: ${totalPosts}\n\nПримерное ожидание завершения автопостинга: ${totalPosts * delay / 1000} секунд\n\nОжидайте пожалуйста.`);

    // Функция для обновления статуса автопостинга
    const updateStatusMessage = async () => {
        const sentPosts = await PostFile.countDocuments({ projectId: projectId, isSent: true });
        const remainingPosts = totalPosts - sentPosts;
        const estimatedTimeSeconds = remainingPosts * delay / 1000;
        const estimatedTimeFormatted = formatTime(estimatedTimeSeconds);
    
        await ctx.telegram.editMessageText(ctx.chat.id, statusMessage.message_id, null, `<b>Автопостинг запущен.</b>\n\nСообщений отправлено: ${sentPosts}\nСообщений в очереди: ${remainingPosts}\n\nПримерное ожидание завершения автопостинга: ${estimatedTimeFormatted}\n\nОжидайте пожалуйста.`, { parse_mode: 'HTML' });
    };

    const messageTemplate = '<b>Название фирмы</b>: {0}\n<b>ИНН</b>: {1}\n...';
    
    // Запускаем автопостинг с задержкой и обновляем статус
    for (let i = 0; i < totalPosts; i++) {
        const post = postsToSend[i];
        setTimeout(async () => {
            if (!post.isSent) {
                // Обновляем вызов функции для использования шаблона
                const formattedMessage = formatPostMessage(post, messageTemplate);
                await safeSendMessage(ctx, chatId, formattedMessage, { parse_mode: 'HTML' });
                post.isSent = true;
                await post.save();
                sentCount++;
                
                // Обновляем статус после каждого отправленного сообщения
                await updateStatusMessage();
            }
        }, delay * i);
    }

    // Здесь нет нужды отправлять финальное сообщение сразу, так как статус будет обновляться автоматически
}



setInterval(checkAndSendUpdates, 60000);

bot.launch().then(() => {
    console.log('Бот запущен...');
});