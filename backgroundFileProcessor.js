const fileProcessingQueue = require('./fileProcessingQueue');
const { processJsonFile, processCsvFile, processXlsxFile } = require('./moduleFiletoPost');

fileProcessingQueue.process(async (job, done) => {
    const { fileUrl, fileType, projectId, userId } = job.data;

    try {
        if (fileType === 'xlsx') {
            await processXlsxFile(ctx, filePath, ctx.session.projectId, ctx.from.id.toString());
        }

        done();
    } catch (error) {
        console.error('Ошибка при обработке файла:', error);
        done(error);
    }
});
