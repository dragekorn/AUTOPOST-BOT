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
    const userId = ctx.from.id.toString();
    const projects = await UserProject.find({ userID: userId });
    
    if (projects.length > 0) {
        let messageText = 'Выберите проект для автопостинга:\n';
        const projectsKeyboard = projects.map(project =>
            Markup.button.callback(project.projectName, `select_project_${project._id}`)
        );

        await ctx.reply(messageText, Markup.inlineKeyboard([...projectsKeyboard, Markup.button.callback('❌ Отмена', 'cancel')]));
    } else {
        await ctx.reply("У Вас ещё нет проектов. Создайте их для начала по кнопке ниже.",
            Markup.inlineKeyboard([Markup.button.callback('📃 Создать проект', 'selfTemplateScene'), Markup.button.callback('❌ Отмена', 'cancel')])
        );
    }
});

autopostingScene.on('text', async (ctx) => {
    const chatId = ctx.message.text;

    // Проверяем, является ли введенный текст ID канала
    if (/^-100\d+$/.test(chatId)) {
        if (ctx.session.projectId && ctx.session.delay) { // Проверяем, выбраны ли проект и задержка
            const hasAdminRights = await checkBotAdminRights(ctx, chatId);

            if (hasAdminRights) {
                // Запускаем автопостинг
                await startAutoposting(ctx, chatId, ctx.from.id.toString(), ctx.session.projectId, ctx.session.delay);
                ctx.session.projectId = null;
                ctx.session.delay = null;
                ctx.scene.leave();
            } else {
                await ctx.reply("У бота нет прав администратора в этом канале/группе. Пожалуйста, добавьте бота в группу и сделайте его администратором.");
            }
        } else {
            await ctx.reply("Не все параметры выбраны. Пожалуйста, выберите проект и установите задержку.");
        }
    } else {
        await ctx.reply("Введите корректный ID канала или группы.");
    }
});

//сцена автопостинга с созданием своего проекта с собственным шаблоном
const selfTemplateScene = new Scenes.BaseScene('selfTemplateScene');

selfTemplateScene.enter((ctx) => {
    ctx.replyWithHTML('Введите название своего проекта:');
});

selfTemplateScene.on('text', async (ctx) => {
    const projectName = ctx.message.text;
    const userId = ctx.from.id.toString();

     const existingProject = await UserProject.findOne({ projectName: projectName, userID: userId });
     if (existingProject) {
         await ctx.reply('Проект с таким названием уже существует. Пожалуйста, выберите другое название.');
         return;
     }

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


// Добавляем обработчик для выбора проекта
bot.action(/select_project_(.+)/, async (ctx) => {
    const selectedProjectId = ctx.match[1];
    ctx.session.projectId = selectedProjectId;

    // Запрос задержки после выбора проекта
    await ctx.reply("Проект выбран. Теперь выберите интервал задержки между постами.", Markup.inlineKeyboard([
        Markup.button.callback('5 секунд', 'delay_5000'),
        Markup.button.callback('10 секунд', 'delay_10000'),
        Markup.button.callback('1 минута', 'delay_60000'),
        Markup.button.callback('10 минут', 'delay_600000')
    ]));
});

bot.action(/delay_(\d+)/, async (ctx) => {
    const delay = Number(ctx.match[1]);
    ctx.session.delay = delay;

    // Запрос ID канала после выбора задержки
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

// Обработчик кнопки "Комментарии"
bot.action('comments', async (ctx) => {
    try {
        // Ваша логика для отображения информации о платеже или прямой переход к оплате
        // Пример отправки инвойса пользователю через Telegram
        ctx.replyWithInvoice({
            title: 'Оплата доступа к комментариям',
            description: 'Оплата возможности оставлять комментарии в группе.',
            payload: 'unique_payload', // Уникальный идентификатор внутри вашего бота
            provider_token: '381764678:TEST:79618', // Токен, полученный от ЮKassa
            currency: 'RUB',
            prices: [{ label: 'Доступ к комментариям', amount: 10000 }], // Сумма в минимальных единицах (копейках/центах)
            start_parameter: 'get_access',
            photo_url: 'URL_изображения_услуги',
            is_flexible: false // Налог не применяется
        });
    } catch (error) {
        console.error('Ошибка при попытке отправить инвойс:', error);
        ctx.reply('Произошла ошибка при попытке отправить инвойс. Пожалуйста, попробуйте ещё раз.');
    }
});

// Обработчик успешного платежа
bot.on('successful_payment', async (ctx) => {
    // Извлекаем userId и сумму платежа из сообщения
    const userId = ctx.update.message.from.id.toString();
    const amountPaid = ctx.update.message.successful_payment.total_amount; // Сумма в минимальных единицах валюты (копейках)

    try {
        // Обновляем статус оплаты пользователя, добавляем токены и устанавливаем срок подписки
        const tokensAdded = await updateUserPaymentStatus(userId, true, amountPaid);

        // Отправляем пользователю подтверждение об успешной оплате и информацию о добавленных токенах
        ctx.reply(`Спасибо за вашу оплату! Вам добавлено ${tokensAdded} токенов для комментариев. Подписка действует в течение 30 дней.`);
    } catch (error) {
        console.error('Ошибка при обработке успешного платежа:', error);
        ctx.reply('Произошла ошибка при обработке вашего платежа. Пожалуйста, свяжитесь с поддержкой.');
    }
});

// Дополнительно: Обработчик pre_checkout_query
bot.on('pre_checkout_query', (ctx) => {
    // Telegram требует подтверждения pre_checkout_query
    ctx.answerPreCheckoutQuery(true).catch(error => console.error('Ошибка при ответе на pre_checkout_query:', error));
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

// Функция обновления статуса оплаты пользователя с добавлением токенов и подписки
async function updateUserPaymentStatus(userId, hasPaid, amountPaid) {
    const tokensToAdd = amountPaid; // 100 рублей = 100 токенов, amountPaid должен быть в копейках
    const subscriptionDuration = 30; // Срок подписки в днях

    try {
        const user = await User.findOne({ userId: userId });
        if (user) {
            user.hasPaid = hasPaid;
            user.paymentDate = new Date(); // Записываем дату оплаты
            user.tokens += tokensToAdd / 100; // Добавляем токены
            user.subscriptionEndDate = new Date(user.paymentDate.getTime() + (subscriptionDuration * 24 * 60 * 60 * 1000)); // Устанавливаем дату окончания подписки

            await user.save();
            console.log(`Статус оплаты и токены для пользователя ${userId} обновлены. Токенов добавлено: ${tokensToAdd / 100}. Срок подписки до: ${user.subscriptionEndDate}`);

            return tokensToAdd / 100; // Возвращаем количество добавленных токенов для последующего уведомления пользователя
        } else {
            throw new Error(`Пользователь с ID ${userId} не найден.`);
        }
    } catch (error) {
        console.error('Ошибка при обновлении статуса оплаты пользователя и добавлении токенов:', error);
        throw error; // Пробрасываем ошибку дальше
    }
}

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

    const projects = await UserProject.find({ userID: userId });
    let messageText = 'Добро пожаловать в секцию автопостинга из файла.\n\n';

    let keyboardOptions = [
        [Markup.button.callback('📃 Создать проект', 'selfTemplateScene'), Markup.button.callback('❌ Отмена', 'cancel')],
        [Markup.button.callback('▶️ Начать автопостинг', 'start_autoposting')]
    ];

    if (projects && projects.length > 0) {
        messageText += 'Ваши текущие проекты и статус сообщений:\n';
        for (const project of projects) {
            const sentMessagesCount = await PostFile.countDocuments({ projectId: project._id, isSent: true });
            const pendingMessagesCount = await PostFile.countDocuments({ projectId: project._id, isSent: false });

            messageText += `📁 ${project.projectName}\n`;
            messageText += `   ✅ Отправлено: ${sentMessagesCount}\n`;
            messageText += `   🕒 Ожидает отправки: ${pendingMessagesCount}\n\n`;

            keyboardOptions.push([Markup.button.callback(`🗑 Удалить ${project.projectName}`, `delete_project_${project._id}`)]);
        }
    } else {
        messageText += 'У вас пока нет проектов.\n\nПожалуйста, создайте новый проект.';
    }

    await ctx.replyWithHTML(messageText, Markup.inlineKeyboard(keyboardOptions));
    ctx.session.awaitingFile = true;
});



bot.action(/delete_project_(.+)/, async (ctx) => {
    const projectId = ctx.match[1]; // Извлеките ID проекта из callback_data
    const userId = ctx.from.id.toString(); // Получите ID пользователя

    try {
        // Удаление всех постов, связанных с проектом
        await PostFile.deleteMany({ projectId: projectId });

        // Удаление самого проекта
        await UserProject.findByIdAndDelete(projectId);

        // После удаления проекта получаем обновленный список проектов пользователя
        const projects = await UserProject.find({ userID: userId });

        let messageText = 'Добро пожаловать в секцию автопостинга из файла.\n\n';
        let keyboardOptions = [
            [Markup.button.callback('📃 Создать проект', 'selfTemplateScene'), Markup.button.callback('❌ Отмена', 'cancel')],
            [Markup.button.callback('▶️ Начать автопостинг', 'start_autoposting')]
        ];

        if (projects && projects.length > 0) {
            messageText += 'Ваши текущие проекты и статус сообщений:\n';
            for (const project of projects) {
                const sentMessagesCount = await PostFile.countDocuments({ projectId: project._id, isSent: true });
                const pendingMessagesCount = await PostFile.countDocuments({ projectId: project._id, isSent: false });

                messageText += `📁 ${project.projectName}\n`;
                messageText += `   ✅ Отправлено: ${sentMessagesCount}\n`;
                messageText += `   🕒 Ожидает отправки: ${pendingMessagesCount}\n\n`;

                keyboardOptions.push([Markup.button.callback(`🗑 Удалить ${project.projectName}`, `delete_project_${project._id}`)]);
            }
        } else {
            messageText += 'Все проекты были удалены.\n\nПожалуйста, создайте новый проект.';
        }

        // Обновляем сообщение с новым списком проектов
        await ctx.editMessageText(messageText, Markup.inlineKeyboard(keyboardOptions));
    } catch (error) {
        console.error('Ошибка при удалении проекта и постов:', error);
        // В случае ошибки пытаемся отправить сообщение об ошибке без изменения оригинального сообщения
        await ctx.answerCbQuery('Произошла ошибка при попытке удалить проект. Пожалуйста, попробуйте снова.', true);
    }
});


// ОПЛАТА И ПРОВЕРКА ВОЗМОЖНОСТИ КОММЕНТИРОВАНИЯ В СВЯЗАННОЙ ГРУППЕ

// Добавляем или обновляем пользователя в базе данных
async function upsertUser(userId, username) {
    try {
        // Поиск существующего пользователя
        const existingUser = await User.findOne({ userId: userId }).exec();

        if (existingUser) {
            // Обновляем только имя пользователя, если пользователь уже существует
            existingUser.username = username;
            await existingUser.save();
            return existingUser;
        } else {
            // Создание нового пользователя, если он не найден
            const newUser = new User({
                userId: userId,
                username: username,
                hasPaid: false,
                // Инициализация полей для нового пользователя
                tokens: 0, // Начальное количество токенов
                subscriptionEndDate: null // Дата окончания подписки не установлена
            });
            await newUser.save();
            return newUser;
        }
    } catch (error) {
        console.error('Ошибка при добавлении/обновлении пользователя:', error);
        throw error; // Проброс ошибки дальше
    }
}

// Пример обновления статуса оплаты пользователя и добавления токенов/даты окончания подписки
// async function updateUserPaymentStatus(userId, amountPaid) {
//     try {
//         // Извлечение соответствующего количества токенов из суммы оплаты
//         // Предположим, что 100 копеек = 1 токен
//         const tokensToAdd = amountPaid / 100; // или другой коэффициент, соответствующий вашей ценовой политике

//         // Расчет даты окончания подписки
//         const currentSubscriptionEndDate = new Date();
//         currentSubscriptionEndDate.setDate(currentSubscriptionEndDate.getDate() + 30); // Добавляем 30 дней к текущей дате

//         const user = await User.findOneAndUpdate({ userId: userId }, {
//             $set: {
//                 hasPaid: true,
//                 subscriptionEndDate: currentSubscriptionEndDate
//             },
//             $inc: { tokens: tokensToAdd } // Увеличение на количество купленных токенов
//         }, { new: true });

//         console.log(`Статус оплаты и токены для пользователя ${userId} обновлены.`);
//         return user;
//     } catch (error) {
//         console.error('Ошибка при обновлении статуса оплаты пользователя:', error);
//         throw error;
//     }
// }

async function hasUserPaid(userId) {
    try {
        const user = await User.findOne({ 'telegramId': userId }).exec();
        return user && user.hasPaid;
    } catch (error) {
        console.error('Ошибка при проверке статуса оплаты пользователя:', error);
        return false;
    }
}


bot.on('message', async (ctx) => {
    // Пропускаем сообщения от ботов и пересланные сообщения из каналов
    if (ctx.message.from.is_bot || ctx.message.forward_from_chat) {
        return;
    }

    if (ctx.chat.type === 'supergroup' || ctx.chat.type === 'group') {
        const userId = ctx.from.id.toString();
        const username = ctx.from.username || `${ctx.from.first_name} ${ctx.from.last_name}`;

        // Добавляем или обновляем пользователя в базе данных
        const user = await upsertUser(userId, username);

        // Проверяем, не является ли пользователь администратором
        const admins = await ctx.telegram.getChatAdministrators(ctx.chat.id);
        const isAdmin = admins.some(admin => admin.user.id === parseInt(userId));

        if (isAdmin) {
            // Пропускаем обработку для администраторов
            return;
        }

        // Проверка, не заблокирован ли пользователь
        if (user.isBlocked && user.blockExpiresAt > new Date()) {
            // Прекращаем обработку, если пользователь заблокирован
            await ctx.deleteMessage(ctx.message.message_id);
            return;
        } else if (user.isBlocked && user.blockExpiresAt <= new Date()) {
            // Разблокируем пользователя, если время блокировки истекло
            await User.updateOne({ userId: userId }, { $unset: { isBlocked: "", blockExpiresAt: "" } });
        }

        // Проверка наличия токенов и действительности подписки
        const currentDate = new Date();
        if (user.tokens > 0 && user.subscriptionEndDate && currentDate <= new Date(user.subscriptionEndDate)) {
            user.tokens -= 1; // Уменьшаем количество токенов на один
            await user.save(); // Сохраняем изменения
        } else {
            // Если токенов нет или подписка истекла, удаляем сообщение и уведомляем пользователя
            await ctx.deleteMessage(ctx.message.message_id);

            let replyText;
            if (user.tokens <= 0) {
                replyText = `Уважаемый [${ctx.from.first_name}](tg://user?id=${userId}), у вас закончились токены для комментирования. [Оплатить доступ](https://telegra.ph/Oplata-vozmozhnosti-kommentirovaniya-03-05)`;
            } else {
                // В случае если подписка истекла
                replyText = `Уважаемый [${ctx.from.first_name}](tg://user?id=${userId}), ваша подписка на комментарии истекла. [Оплатить доступ](https://telegra.ph/Oplata-vozmozhnosti-kommentirovaniya-03-05)`;
            }

            const message = await ctx.replyWithMarkdown(replyText, {
                disable_web_page_preview: true
            });

            setTimeout(() => {
                try {
                    ctx.deleteMessage(message.message_id);
                } catch (deleteError) {
                    console.error('Ошибка при удалении уведомления:', deleteError);
                }
            }, 10000);
        }
    }
});



// bot.on('document', async (ctx) => {
//     if (ctx.session && ctx.session.awaitingFile) {
//         try {

//             const chatId = ctx.chat.id;
//             const fileId = ctx.message.document.file_id;
//             const fileLink = await ctx.telegram.getFileLink(fileId);

//             ctx.reply('Файл получен, начинаю обработку...');

//             await processFile(ctx, fileLink);
//         } catch (error) {
//             console.error('Ошибка при обработке файла:', error);
//             ctx.reply('Произошла ошибка при обработке файла.');
//         }

//         delete ctx.session.awaitingFile;
//     } else {
//         ctx.reply('Отправьте файл после активации команды автопостинга через /autopostfile');
//     }
// });

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

    const messageTemplate = `
    #РейтингМоскОблСтоимостьОрганизации
<b>Рейтинг</b>
Организации Московской Области
Вид деятельности:
{7}
    
<b>Место в рейтинге</b> {12} по величине "Стоимости организации"
    
<b>Название:</b> {0}
<b>ИНН</b> {1} и <b>КПП</b> {2}
<b>Адрес:</b> {3}
    
<b>Руководитель:</b> {4} {5} {6}
Вид деятельности: {7}
    
Идентификатор ЭДО: {13}
    
#Рейтинг
#инн{1} #кпп{2}
#РейтингМоскОблСтоимостьОрганизации
  
<b>Жми комментировать и дополняй информацию организаций: прайс, презентацию, контакты, реквизиты, отзывы, как пройти и другую информацию.</b>
<b>Телефоны:</b> {8}
email: {9}
`;
    
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