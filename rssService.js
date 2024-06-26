const axios = require('axios');
const cheerio = require('cheerio');
const Parser = require('rss-parser');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const parser = new Parser({
    customFields: {
      item: [
        ['dc:creator', 'creator']
      ]
    }
  });
const { getLastSentPosts, saveSentPosts } = require('./databaseService');

// const getAbsoluteImageUrl = (baseUrl, imageUrl) => {
//     return imageUrl.startsWith('http') ? imageUrl : new URL(imageUrl, baseUrl).href;
// };

// const getFirstImageFromHtml = async (url) => {
//     try {
//         const response = await axios.get(url);
//         const $ = cheerio.load(response.data);
//         const imgSrc = $('img').first().attr('src');
//         return imgSrc ? getAbsoluteImageUrl(url, imgSrc) : null;
//     } catch (error) {
//         console.error('Error fetching image from URL:', url, error);
//         return null;
//     }
// };

// const downloadImage = async (url, postId) => {
//     try {
//         const response = await axios({
//             url,
//             responseType: 'arraybuffer',
//         });

//         if (response.status !== 200) {
//             throw new Error(`Failed to download image, status code: ${response.status}`);
//         }

//         const tempDir = path.join(__dirname, 'temp');
//         if (!fs.existsSync(tempDir)) {
//             fs.mkdirSync(tempDir);
//         }

//         const imagePath = path.join(tempDir, `${postId}.jpg`);
//         const buffer = await sharp(response.data).jpeg().toBuffer();
//         fs.writeFileSync(imagePath, buffer);

//         return imagePath;
//     } catch (error) {
//         console.error('Error downloading image:', error);
//         return null;
//     }
// };

const getNewRSSPosts = async (rssLink, channelId) => {
    try {
        const feed = await parser.parseURL(rssLink);
        const lastSentPosts = await getLastSentPosts(channelId);

        let resolvedPosts = [];
        for (const item of feed.items) {
            if (!lastSentPosts.includes(item.link)) {
                let content = item.contentSnippet || item.content;
                content = content.replace("Читать далее", "");
                const hashtag = item.creator ? `#${item.creator.replace(/\s+/g, '_')}` : '';
                const formattedPost = `<b>${item.title}</b>\n\n${content}\n\n<a href="${item.link}">Источник</a> ${hashtag}`;

                resolvedPosts.push({
                    item: item,
                    formattedPost: formattedPost,
                    imageStream: null, // Изображения временно не обрабатываются
                });

            }
        }

        await saveSentPosts(channelId, resolvedPosts.map(post => post.item.link));
        return resolvedPosts;
    } catch (error) {
        console.error(`Error fetching new posts from RSS feed ${rssLink}:`, error);
        return [];
    }
};


module.exports = {
    getNewRSSPosts,
};
