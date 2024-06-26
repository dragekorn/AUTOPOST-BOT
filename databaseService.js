const mongoose = require('mongoose');

mongoose.connect('mongodb://localhost:27017/RSStoPostBot')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const projectPostSchema = new mongoose.Schema({
  title: String,
  text: String,
  additionalInfo: mongoose.Schema.Types.Mixed,
  isSent: { type: Boolean, default: false }
}, { timestamps: true });

  const subscriptionSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
    userId: String,
    rssLink: String,
    channelId: String,
    channelName: String,
    subId: { type: Number, required: true, unique: true }
  });

const Subscription = mongoose.model('Subscription', subscriptionSchema);

const postSchema = new mongoose.Schema({
    channelId: String,
    postLinks: [String],
  });
  
const Post = mongoose.model('Post', postSchema);

const userSchema = new mongoose.Schema({
  userId: { type: String, unique: true },
  licKeys: { type: String, default: "" },
  username: { type: String },
  channels: [{ type: String }],
  hasPaid: { type: Boolean, default: false },
  isBlocked: { type: Boolean, default: false },
  paymentDate: { type: Date },
  tokens: { type: Number, default: 0 },
  subscriptionEndDate: { type: Date },
  warningCount: { type: Number, default: 0 },
  blockExpiresAt: { type: Date },
  allowedMessageIds: [{ type: Number }]
});

const User = mongoose.model('User', userSchema);

const postFileSchema = new mongoose.Schema({
  data: mongoose.Schema.Types.Mixed,
  isSent: { type: Boolean, default: false },
  datePost: { type: Date, default: Date.now },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserProject' },
  createdAt: { type: Date, default: Date.now }
});

const PostFile = mongoose.model('PostFile', postFileSchema);

const userProjectSchema = new mongoose.Schema({
  userID: {
    type: Number,
    required: true,
    ref: 'User'
  },
  projectName: {
    type: String,
    required: true
  },
  projectPosts: [postFileSchema]
}, { timestamps: true });

const UserProject = mongoose.model('UserProject', userProjectSchema);

const findUser = async (userId) => {
  return await User.findOne({ userId });
};

const addUserLicKey = async (userId, licKey, username) => {
  return await User.findOneAndUpdate({ userId }, { $set: { licKeys: licKey, username: username } }, { upsert: true, new: true });
};

const saveSubscription = async (userId, rssLink, channelId, channelName) => {
  try {
    const existingSubscription = await Subscription.findOne({ userId, rssLink, channelId });
    if (existingSubscription) {
      console.log('Подписка уже существует');
      return existingSubscription;
    }

    const subId = Date.now();

    const subscription = new Subscription({ userId, rssLink, channelId, channelName, subId });
    await subscription.save();
    console.log('Новая подписка сохранена:', subscription);
    return subscription;
  } catch (error) {
    console.error('Ошибка при сохранении подписки:', error);
    throw error;
  }
};

const getLastSentPosts = async (channelId) => {
  try {
    const record = await Post.findOne({ channelId });
    return record ? record.postLinks : [];
  } catch (err) {
    console.error('Error fetching last sent posts:', err);
    return [];
  }
};

const saveSentPosts = async (channelId, newPostLinks) => {
  try {
    const record = await Post.findOneAndUpdate(
      { channelId },
      { $addToSet: { postLinks: { $each: newPostLinks } } },
      { new: true, upsert: true }
    );
    // console.log(`Updated posts for ${channelId}`);
    return record ? record.postLinks : [];
  } catch (err) {
    console.error('Error saving sent posts:', err);
    return [];
  }
};

const getSubscriptions = async () => {
    try {
      const subscriptions = await Subscription.find({});
      return subscriptions.map(sub => ({
        userId: sub.userId,
        rssLink: sub.rssLink,
        channelId: sub.channelId
      }));
    } catch (err) {
      console.error('Error fetching subscriptions:', err);
      return [];
    }
  };

const getUserSubscriptions = async (userId) => {
    try {
      const subscriptions = await Subscription.find({ userId });
      console.log(subscriptions);
      return subscriptions.map(sub => ({
        rssLink: sub.rssLink,
        channelId: sub.channelId
      }));
    } catch (err) {
      console.error('Error fetching user subscriptions:', err);
      return [];
    }
};

const getDetailedSubscriptions = async (userId) => {
  try {
      console.log(`Fetching detailed subscriptions for userId: ${userId}`);

      const subscriptions = await Subscription.aggregate([
          {
              $match: { userId: userId.toString() }
          },
          {
              $group: {
                  _id: "$channelId",
                  rssFeeds: { $push: "$rssLink" },
                  channelName: { $first: "$channelName" },
                  // Предполагаем, что subId уникален для каждой подписки и не меняется в группировке
                  subId: { $first: "$subId" }
              }
          },
          {
              $project: {
                  channelId: "$_id",
                  _id: 0,
                  rssFeeds: 1,
                  channelName: 1,
                  subId: 1 // Включаем subId в проекцию
              }
          }
      ]);

      const detailedSubscriptions = subscriptions.map(sub => ({
          channelId: sub.channelId,
          rssFeeds: sub.rssFeeds,
          channelName: sub.channelName,
          subId: sub.subId // Добавляем subId в возвращаемый объект
      }));

      console.log(`Detailed subscriptions found:`, detailedSubscriptions);

      return detailedSubscriptions;
    } catch (err) {
      console.error('Error fetching detailed subscriptions:', err);
      return [];
  }
};


const deleteSubscription = async (userId, rssLink = null, channelId = null) => {
  try {
    const query = { userId };
    if (rssLink) query.rssLink = rssLink;
    if (channelId) query.channelId = channelId;

    const result = await Subscription.deleteOne(query);
    if (result.deletedCount === 0) {
      console.log('Подписка не найдена или уже удалена.');
      return false;
    } else {
      console.log('Подписка успешно удалена.');
      return true;
    }
  } catch (error) {
    console.error('Ошибка при удалении подписки:', error);
    return false;
  }
};

async function createNewProject(userID, projectName, projectPosts) {
  try {
    const newProject = new UserProject({
      userID,
      projectName,
      projectPosts
    });
    
    await newProject.save();
    console.log('Проект успешно создан!');
    return newProject;
  } catch (error) {
    console.error('Ошибка при создании проекта:', error);
    throw error;
  }
}

module.exports = { User, UserProject, createNewProject, PostFile, findUser, addUserLicKey, Subscription, saveSubscription, deleteSubscription, getUserSubscriptions, getLastSentPosts, saveSentPosts, getSubscriptions, getDetailedSubscriptions };
