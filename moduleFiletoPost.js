const { PostFile } = require('./databaseService');
const readXlsxFile = require('read-excel-file/node');
const xlsx = require('xlsx');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { parse } = require('json2csv');

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
async function processXlsxFile(filePath) {
    try {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
  
      // Обработка каждой строки данных
      const processedData = data.map(row => {
        // Ваша логика обработки строки
        return row;
      });
  
      // Далее сохранение в базу данных, как в предыдущем коде
      for (const item of processedData) {
        await PostFile.create(item);
      }
    } catch (error) {
      console.error('Ошибка при обработке XLSX файла:', error);
    }
  }

async function processFile(fileUrl) {
    try {
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
            await processXlsxFile(filePath);
        } else {
            console.log('Unsupported file format');
        }

        // Удаляем временный файл после обработки
        fs.unlinkSync(filePath);
    } catch (error) {
        console.error('Ошибка при скачивании или обработке файла:', error);
        throw error;
    }
}

module.exports = { processFile };