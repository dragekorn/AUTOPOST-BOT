// utils.js
const successMessage = async (ctx, message) => {
    await ctx.reply(message);
};

module.exports = { successMessage };