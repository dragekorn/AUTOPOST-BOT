const { PostFile } = require('./databaseService');
const readXlsxFile = require('read-excel-file/node');
const xlsx = require('xlsx');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { parse } = require('json2csv');
const { successMessage } = require('./utils');

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
    // Чтение данных из файла
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    // Счетчик успешно загруженных постов
    let loadedPostsCount = 0;

    // Итерация по всем строкам данных и формирование постов
    for (const row of data) {
      const postFormat = {
        title: row['Заголовок статьи'],
        text: row['Текст статьи'],
        additionalInfo: row['Подписи хэштеги'],
        datePost: row['Дата постинга'],
      };

      // Запись данных в базу данных и инкремент счетчика
      await PostFile.create(postFormat);
      loadedPostsCount++;
    }

    // Отправка сообщения пользователю об успешной загрузке данных с указанием количества загруженных постов
    successMessage(ctx, `Файл успешно обработан.\n\nВ базу было загружено ${loadedPostsCount} постов для автопостинга.`);
  } catch (error) {
    console.error('Ошибка при обработке XLSX файла:', error);
    // Отправляем сообщение об ошибке, если не удалось обработать файл
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
              console.log('Unsupported file format');
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