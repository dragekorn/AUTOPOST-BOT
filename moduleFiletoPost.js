const { PostFile } = require('./databaseService');
const readXlsxFile = require('read-excel-file/node');
const xlsx = require('xlsx');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { parse } = require('json2csv');
const { errorFileMessage, successMessage, successMessageWithQuestion } = require('./utils');

const getPostsCount = async () => {
  return await PostFile.countDocuments();
};

// Функция для обработки JSON файла
async function processJsonFile(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const item of data) {
      await PostFile.create(item);
    }
  } catch (error) {
    console.error('Ошибка при обработке JSON файла:', error);
  }
}

// Функция для обработки CSV файла
async function processCsvFile(filePath) {
  try {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', async (row) => {
        await PostFile.create(row);
      });
  } catch (error) {
    console.error('Ошибка при обработке CSV файла:', error);
  }
}

// Функция для обработки XLSX файла
async function processXlsxFile(ctx, filePath) {
  try {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    let loadedPostsCount = 0;
    let skippedPostsCount = 0; // Счетчик пропущенных постов

    for (const row of data) {
      // Формируем объект поста для проверки
      const postQuery = {
        title: row['Заголовок статьи'],
        text: row['Текст статьи'],
        additionalInfo: row['Подписи хэштеги'],
        // Можете добавить другие поля, если это необходимо
      };

      // Ищем существующий пост с такими же данными
      const existingPost = await PostFile.findOne(postQuery);
      if (existingPost) {
        skippedPostsCount++;
        continue; // Пропускаем добавление дублирующегося поста
      }

      // Добавляем дату постинга к объекту, если пост уникален
      postQuery.datePost = row['Дата постинга'];

      await PostFile.create(postQuery);
      loadedPostsCount++;
    }

    const totalPostsCount = await getPostsCount(); // Общее количество постов в базе
    // Формирование сообщения с учетом количества пропущенных постов
    let message = `Файл успешно обработан, в базу было добавлено ${loadedPostsCount} новых постов.`;
    if (skippedPostsCount > 0) {
      message += `\n\nПропущенных постов: ${skippedPostsCount}.\nВидимо какие-то из постов вы уже добавляли в базу. Пожалуйста, перепроверьте файл.`;
    }
    successMessageWithQuestion(ctx, message, totalPostsCount);
  } catch (error) {
    console.error('Ошибка при обработке XLSX файла:', error);
    successMessage(ctx, 'Произошла ошибка при обработке файла.');
  }
}

async function processFile(ctx, fileUrl) {
  const userId = ctx.from.id;
  try {
      console.log('ctx:', ctx);
      if (!ctx.from) {
          console.error('Отсутствует информация о пользователе');
          return;
      }
        const response = await axios({ url: fileUrl, method: 'GET', responseType: 'stream' });
        const filePath = path.join(__dirname, 'tempfile'); // Временное сохранение файла
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        console.log('File URL:', fileUrl.href);
        if (typeof fileUrl.href !== 'string') {
            console.error('File URL is not a string');
            return;
        }

        if (fileUrl.href.endsWith('.json')) {
          await processJsonFile(filePath);
          } else if (fileUrl.href.endsWith('.csv')) {
              await processCsvFile(filePath);
          } else if (fileUrl.href.endsWith('.xlsx')) {
              await processXlsxFile(ctx, filePath);
          } else {
              errorFileMessage(ctx, '<b>⛔️⛔️⛔️ Ошибка ⛔️⛔️⛔️\n\nК сожалению я ещё не умею читать формат файлов, который Вы отправили.</b>\n\n<u>Попробуйте отправить XLSX, CSV или JSON</u>');
              console.log('Unsupported file format');
              fs.unlinkSync(filePath);
              return;
          }

        // Удаляем временный файл после обработки
        fs.unlinkSync(filePath);
    } catch (error) {
        console.error('Ошибка при скачивании или обработке файла:', error);
        throw error;
    }
}

module.exports = { processFile };