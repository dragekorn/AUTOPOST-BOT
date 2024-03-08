# AUTOPOST BOT (RSS&POST)

Наш бот и создаваемые им справочники организаций является современным и пока не имеющим аналогов интерактивным справочником организаций.

Бот принимает оплату за безлимитное в течении 30 дней комментирование своих организаций и до 100 posts(комментариев, КП, offer, отзывов и предложений) любых других организаций. Стоимость этого минимальна - 100 рублей.

Бот удалит комментарий если доступ не оплачен.
После оплаты бот просит переслать ему карточки организаций, которые бот будет считать "своими" для пользователя, бот предупредит о том, что возможно потребуется дополнительная проверка прав пользователя писать от имени организации, сообщит наш ИНН для контакта по ЭДО для исправления этих дополнительных проверок.

По истечении срока 30 дней бот прекратит доступ, то есть будет удалять любые комментарии и другие посты. По истечении 100 posts(комментариев, КП, offer, отзывов и предложений) к любым другим организациям - бот прекратит доступ, то есть будет удалять любые комментарии.

Бот умеет принимать оплату за работу с импортом организаций через ссылки на xml файлы и файлы xlsx загруженные в бот.

1. [История обновлений бота](#%D0%B8%D1%81%D1%82%D0%BE%D1%80%D0%B8%D1%8F-%D0%BE%D0%B1%D0%BD%D0%BE%D0%B2%D0%BB%D0%B5%D0%BD%D0%B8%D0%B9)
2. [Перенос и клонирование бота](#%D0%BF%D0%B5%D1%80%D0%B5%D0%BD%D0%BE%D1%81-%D0%B8-%D0%BA%D0%BB%D0%BE%D0%BD%D0%B8%D1%80%D0%BE%D0%B2%D0%B0%D0%BD%D0%B8%D0%B5-%D0%B1%D0%BE%D1%82%D0%B0)


## История обновлений

### Обновление v.0.2.8(18)
- **Теперь бот отвечает прямо в карточку, чтобы не было путаницы**
- **Бот теперь удаляет и свое сообщение через 30 секунд, чтобы не было «мусора» в комментариях к сообщению**

### Обновление v.0.2.8(14)
- **Обновлена система контроля комментариев**

*Теперь после покупки доступа к комментариям, бот у пользователя спрашивает ссылку (обновлена инструкция (https://telegra.ph/Oplata-vozmozhnosti-kommentirovaniya-03-05)) на сообщение, которое будет комментироваться без затрат токенов. По легенде, пользователь вписывает свою карточку фирмы\услуги, к которой может дополнять различную информацию в течение действия подписки (30 дней). Пользователь может комментировать другие посты в канале, но за это у него будут тратиться токены.*

- **Обновлена система оповещения пользователей о необходимости подписки**

*Система оповещения пользователей о необходимости подписки для возможности комментировать записи была обновлена и внедрена система банов на 24  часа. Если пользователь игнорирует эти оповещения 5 раз, то попадает в бан на 24 часа. Возможность разбана только через админа. (возможно стоит подумать над разбаном платным, автоматизированным через бота)*

- **Прочие изменения:**

В логе добавлены оповещения о том, когда пользователь пишет в свои сообщения или не в свои, показывается сколько токенов было потрачено и сколько осталось. Пользователь указан в виде UserId, что позволит быстрее найти его в базе данных.

- **Заметки**

**Пользователь МОЖЕТ писать в общий чат, но за это у него отнимаются токены.**

### Обновление v.0.2.1(05) - v.0.2.3(13)
- **Добавлена система контроля комментариев**

*Пользователь не может добавить комментарий (в группу) где присутствует бот. После добавления комментария, бот автоматически удаляет его и отсылает сообщение, которое держится 10 секунд, после чего удаляется. В сообщении указано уведомление пользователю с упоминанием, в котором говориться о том, что необходимо приобрести подписку на комменты, чтобы комментировать. В сообщении указана ссылка на инструкцию. В инструкции указано, что необходимо запустить автоматического бота и совершить оплату.*
- **Добавлена система автоматического принятия оплаты от пользователей и предоставления доступа к комментариям.**

*После оплаты пользователю приходит сообщение о том, что он приобрёл 100 токенов (сообщений\комментариев) сроком на 30 дней. По истечению 30 дней токены сгорают и пользователя оповещает бот о том, что подписка и токены сгорели и предлагает оплатить заново.*
- **Обновлена структура базы данных**

*Добавлены новые колонки **hasPaid(буллевое значение)**, **tokens(количество токенов)**, **paymentDate(дата оплаты)**, **subscriptionEndDate(окончание подписки)***

- **Примеры сообщения пользователю:**

**Когда бот не обнаружил у пользователя подписку:**

> Уважаемый {имя пользователя}, у вас закончились токены для комментирования. Оплатить доступ (https://ваша_ссылка_на_инструкцию)

**После оплаты**
> Спасибо за вашу оплату! Вам добавлено 100 токенов для комментариев. Подписка действует в течение 30 дней.

**Когда подписка истекла:**
> Уважаемый {имя пользователя}, ваша подписка на комментарии истекла. Оплатить доступ (https://ваша_ссылка_на_инструкцию)

**Когда закончились токены:**
> Уважаемый {имя пользователя}, у вас закончились токены для комментирования. Оплатить доступ (https://ваша_ссылка_на_инструкцию)

### Обновление v.0.1.1(17)
- Соединены два бота в единую экосистему. 
- Услучшена система RSS парсинга и автопостинга
- Улучшена система POST-бота из файла
- Исправление ошибок

### Обновление v.0.0.5(13)
- Данное обновление предшествует соединению двух ботов PostBot и RssToPostBot. Модель почти завершена, осталось переписать модуль формирования постов из файлов (XLSX, JSON, CSV)

# Перенос и клонирование бота
- Установить версию node не ниже v20.11.1 + установить зависимости (npm install) в папке с проектом
- Установить базу данных MongoDB
- файл .env копировать или исправить

Файл должен выглядеть примерно так (в зависимости от ваших потребностей можно расширить)
> TELEGRAM_BOT_TOKEN=здесь_ваш_токен
- название базы данных изменить на название бота (рекомендация)
- экспортировать json файлы из прошлой db в новую или из корня в новую
- запускать бота через pm2 с параметром --watch, но тогда каждый клон бота переименовать в name бота
- в случае изменения шаблона в index.js (он должен быть переименован в name бота) найти "const messageTemplate" в функции "await ctx.telegram.editMessageText" и внести изменения, а соранение (в случае работы бота через pm2 с параметром --watch) будет подхвачено и изменено "на лету"


