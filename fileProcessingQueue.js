const Queue = require('bull');
const fileProcessingQueue = new Queue('file-processing');

module.exports = fileProcessingQueue;
