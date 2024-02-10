const { PostFile, UserProject } = require('./databaseService');
const { Markup } = require('telegraf');
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
// В этом примере предполагается, что у вас уже есть ID проекта, в который нужно добавить посты
async function processXlsxFile(ctx, filePath, projectName) {
  try {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: null });

      data.shift(); // Убираем заголовки, если они есть

      let postsIds = []; // Массив для хранения ID созданных постов
      for (const row of data) {
          const postData = { data: row.filter(cell => cell !== null) };
          const post = await PostFile.create(postData);
          postsIds.push(post._id);
      }

      // После создания всех постов добавляем их ID в проект
      await UserProject.findByIdAndUpdate(projectName, { $push: { projectPosts: { $each: postsIds } } });

      ctx.reply(`Данные успешно загружены и добавлены в проект. Всего загружено ${data.length} постов.`);
  } catch (error) {
      console.error('Ошибка при обработке XLSX файла:', error);
      ctx.reply('Произошла ошибка при обработке файла.');
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