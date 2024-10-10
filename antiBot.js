// index.js

const { Client, Intents, Collection } = require("discord.js");
const dotenv = require("dotenv");
const schedule = require("node-schedule");

dotenv.config();

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const MODERATOR_ROLE_ID = process.env.MODERATOR_ROLE_ID; // Role ID for moderators
const SUSPICIOUS_ROLE_ID = process.env.SUSPICIOUS_ROLE_ID; // Role ID to assign to suspicious users
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID; // Channel ID for logging

if (
  !BOT_TOKEN ||
  !MODERATOR_ROLE_ID ||
  !SUSPICIOUS_ROLE_ID ||
  !LOG_CHANNEL_ID
) {
  console.error(
    "Error: Missing necessary environment variables. Please check your .env file."
  );
  process.exit(1);
}

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
    Intents.FLAGS.GUILD_MESSAGE_TYPING,
    Intents.FLAGS.GUILD_MEMBERS, // Required for managing roles
  ],
});

// Configuration thresholds
const CONFIG = {
  MESSAGE: {
    MIN_MESSAGES: 10,
    TIME_WINDOW: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
    REGULARITY_THRESHOLD: 300 * 1000, // 5 minutes in milliseconds
  },
  REACTION: {
    MIN_REACTIONS: 10,
    TIME_WINDOW: 24 * 60 * 60 * 1000,
    REGULARITY_THRESHOLD: 300 * 1000,
  },
  TYPING: {
    MIN_TYPINGS: 10,
    TIME_WINDOW: 24 * 60 * 60 * 1000,
    REGULARITY_THRESHOLD: 300 * 1000,
  },
  COMMAND: {
    MIN_COMMANDS: 5,
    TIME_WINDOW: 24 * 60 * 60 * 1000,
    REGULARITY_THRESHOLD: 300 * 1000,
  },
};

// Data structures to store user activity
const userMessageLogs = new Collection(); // Map<userId, Array<timestamp>>
const userReactionLogs = new Collection(); // Map<userId, Array<timestamp>>
const userTypingLogs = new Collection(); // Map<userId, Array<timestamp>>
const userCommandLogs = new Collection(); // Map<userId, Array<timestamp>>

// Helper Function: Calculate Median
function getMedian(arr) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

// Function to Log Events
async function logEvent(message) {
  const logChannel = await client.channels
    .fetch(LOG_CHANNEL_ID)
    .catch(() => null);
  if (logChannel && logChannel.isText()) {
    logChannel.send(message).catch(console.error);
  } else {
    console.log("Log channel not found or is not a text channel.");
  }
}

// Function to Handle Detected Self-Bot
async function handleSelfBotDetection(userId, reason, guild) {
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    // Assign "Suspicious" Role
    const suspiciousRole = guild.roles.cache.get(SUSPICIOUS_ROLE_ID);
    if (suspiciousRole && !member.roles.cache.has(suspiciousRole.id)) {
      await member.roles
        .add(suspiciousRole, "Potential self-bot detected")
        .catch(console.error);
      await logEvent(
        `⚠️ **Potential Self-Bot Detected** ⚠️\nUser: ${member.user.tag} (ID: ${userId})\nGuild: ${guild.name} (ID: ${guild.id})\nReason: ${reason}`
      );
    }

    // Notify Moderators
    const moderatorRole = guild.roles.cache.get(MODERATOR_ROLE_ID);
    if (moderatorRole) {
      const modMembers = guild.members.cache.filter((member) =>
        member.roles.cache.has(moderatorRole.id)
      );
      modMembers.forEach((mod) => {
        mod
          .send(
            `⚠️ **Potential Self-Bot Detected** ⚠️\nUser: ${member.user.tag} (ID: ${userId})\nGuild: ${guild.name} (ID: ${guild.id})\nReason: ${reason}`
          )
          .catch(() => {});
      });
    }
  } catch (error) {
    console.error(
      `Error handling self-bot detection for user ${userId}:`,
      error
    );
  }
}

// Event: Bot is ready
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

// Event: Message Create
client.on("messageCreate", (message) => {
  if (message.author.bot) return; // Ignore bot messages

  const userId = message.author.id;
  const guild = message.guild;
  const now = Date.now();

  // Initialize message log for user if not present
  if (!userMessageLogs.has(userId)) {
    userMessageLogs.set(userId, []);
  }

  // Add current timestamp
  userMessageLogs.get(userId).push(now);

  // Remove messages outside the time window
  const messageLog = userMessageLogs
    .get(userId)
    .filter((timestamp) => now - timestamp <= CONFIG.MESSAGE.TIME_WINDOW);
  userMessageLogs.set(userId, messageLog);

  // Check for message regularity
  if (messageLog.length >= CONFIG.MESSAGE.MIN_MESSAGES) {
    const intervals = [];
    for (let i = 0; i < messageLog.length - 1; i++) {
      intervals.push(messageLog[i + 1] - messageLog[i]);
    }

    const medianInterval = getMedian(intervals);

    // Check if all intervals are within the threshold
    const isRegular = intervals.every(
      (interval) =>
        Math.abs(interval - medianInterval) <=
        CONFIG.MESSAGE.REGULARITY_THRESHOLD
    );

    if (isRegular) {
      // Potential self-bot detected
      console.log(
        `Potential self-bot detected: User ID ${userId} is sending messages at regular intervals.`
      );
      handleSelfBotDetection(userId, "Consistent message intervals.", guild);
    }
  }

  // Check if message is a command (starts with '!')
  if (message.content.startsWith("!")) {
    // Initialize command log for user if not present
    if (!userCommandLogs.has(userId)) {
      userCommandLogs.set(userId, []);
    }

    // Add current timestamp
    userCommandLogs.get(userId).push(now);

    // Remove commands outside the time window
    const commandLog = userCommandLogs
      .get(userId)
      .filter((timestamp) => now - timestamp <= CONFIG.COMMAND.TIME_WINDOW);
    userCommandLogs.set(userId, commandLog);

    // Check for command regularity
    if (commandLog.length >= CONFIG.COMMAND.MIN_COMMANDS) {
      const intervals = [];
      for (let i = 0; i < commandLog.length - 1; i++) {
        intervals.push(commandLog[i + 1] - commandLog[i]);
      }

      const medianInterval = getMedian(intervals);

      // Check if all intervals are within the threshold
      const isRegular = intervals.every(
        (interval) =>
          Math.abs(interval - medianInterval) <=
          CONFIG.COMMAND.REGULARITY_THRESHOLD
      );

      if (isRegular) {
        // Potential command self-bot detected
        console.log(
          `Potential command self-bot detected: User ID ${userId} is executing commands at regular intervals.`
        );
        handleSelfBotDetection(
          userId,
          "Consistent command execution intervals.",
          guild
        );
      }
    }
  }
});

// Event: Reaction Add
client.on("messageReactionAdd", (reaction, user) => {
  if (user.bot) return; // Ignore bot reactions

  const userId = user.id;
  const guild = reaction.message.guild;
  const now = Date.now();

  // Initialize reaction log for user if not present
  if (!userReactionLogs.has(userId)) {
    userReactionLogs.set(userId, []);
  }

  // Add current timestamp
  userReactionLogs.get(userId).push(now);

  // Remove reactions outside the time window
  const reactionLog = userReactionLogs
    .get(userId)
    .filter((timestamp) => now - timestamp <= CONFIG.REACTION.TIME_WINDOW);
  userReactionLogs.set(userId, reactionLog);

  // Check for reaction regularity
  if (reactionLog.length >= CONFIG.REACTION.MIN_REACTIONS) {
    const intervals = [];
    for (let i = 0; i < reactionLog.length - 1; i++) {
      intervals.push(reactionLog[i + 1] - reactionLog[i]);
    }

    const medianInterval = getMedian(intervals);

    // Check if all intervals are within the threshold
    const isRegular = intervals.every(
      (interval) =>
        Math.abs(interval - medianInterval) <=
        CONFIG.REACTION.REGULARITY_THRESHOLD
    );

    if (isRegular) {
      // Potential reaction self-bot detected
      console.log(
        `Potential reaction self-bot detected: User ID ${userId} is adding reactions at regular intervals.`
      );
      handleSelfBotDetection(userId, "Consistent reaction intervals.", guild);
    }
  }
});

// Event: Typing Start
client.on("typingStart", (typing) => {
  const userId = typing.user.id;
  const guild = typing.guild;
  const now = Date.now();

  if (typing.user.bot) return; // Ignore bots

  // Initialize typing log for user if not present
  if (!userTypingLogs.has(userId)) {
    userTypingLogs.set(userId, []);
  }

  // Add current timestamp
  userTypingLogs.get(userId).push(now);

  // Remove typing events outside the time window
  const typingLog = userTypingLogs
    .get(userId)
    .filter((timestamp) => now - timestamp <= CONFIG.TYPING.TIME_WINDOW);
  userTypingLogs.set(userId, typingLog);

  // Check for typing regularity
  if (typingLog.length >= CONFIG.TYPING.MIN_TYPINGS) {
    const intervals = [];
    for (let i = 0; i < typingLog.length - 1; i++) {
      intervals.push(typingLog[i + 1] - typingLog[i]);
    }

    const medianInterval = getMedian(intervals);

    // Check if all intervals are within the threshold
    const isRegular = intervals.every(
      (interval) =>
        Math.abs(interval - medianInterval) <=
        CONFIG.TYPING.REGULARITY_THRESHOLD
    );

    if (isRegular) {
      // Potential typing self-bot detected
      console.log(
        `Potential typing self-bot detected: User ID ${userId} is triggering typing indicators at regular intervals.`
      );
      handleSelfBotDetection(
        userId,
        "Consistent typing indicator intervals.",
        guild
      );
    }
  }
});

// Event: Command Execution Detection
client.on("messageCreate", (message) => {
  if (message.author.bot) return; // Ignore bot messages

  if (!message.content.startsWith("!")) return; // Assuming '!' is the command prefix

  const userId = message.author.id;
  const guild = message.guild;
  const now = Date.now();

  // Initialize command log for user if not present
  if (!userCommandLogs.has(userId)) {
    userCommandLogs.set(userId, []);
  }

  // Add current timestamp
  userCommandLogs.get(userId).push(now);

  // Remove commands outside the time window
  const commandLog = userCommandLogs
    .get(userId)
    .filter((timestamp) => now - timestamp <= CONFIG.COMMAND.TIME_WINDOW);
  userCommandLogs.set(userId, commandLog);

  // Check for command regularity
  if (commandLog.length >= CONFIG.COMMAND.MIN_COMMANDS) {
    const intervals = [];
    for (let i = 0; i < commandLog.length - 1; i++) {
      intervals.push(commandLog[i + 1] - commandLog[i]);
    }

    const medianInterval = getMedian(intervals);

    // Check if all intervals are within the threshold
    const isRegular = intervals.every(
      (interval) =>
        Math.abs(interval - medianInterval) <=
        CONFIG.COMMAND.REGULARITY_THRESHOLD
    );

    if (isRegular) {
      // Potential command self-bot detected
      console.log(
        `Potential command self-bot detected: User ID ${userId} is executing commands at regular intervals.`
      );
      handleSelfBotDetection(
        userId,
        "Consistent command execution intervals.",
        guild
      );
    }
  }
});

// ==================== Periodic Cleanup ====================

schedule.scheduleJob("0 * * * *", () => {
  // Runs every hour at minute 0
  const now = Date.now();

  // Clean up message logs
  for (const [userId, timestamps] of userMessageLogs) {
    const filtered = timestamps.filter(
      (timestamp) => now - timestamp <= CONFIG.MESSAGE.TIME_WINDOW
    );
    if (filtered.length > 0) {
      userMessageLogs.set(userId, filtered);
    } else {
      userMessageLogs.delete(userId);
    }
  }

  // Clean up reaction logs
  for (const [userId, timestamps] of userReactionLogs) {
    const filtered = timestamps.filter(
      (timestamp) => now - timestamp <= CONFIG.REACTION.TIME_WINDOW
    );
    if (filtered.length > 0) {
      userReactionLogs.set(userId, filtered);
    } else {
      userReactionLogs.delete(userId);
    }
  }

  // Clean up typing logs
  for (const [userId, timestamps] of userTypingLogs) {
    const filtered = timestamps.filter(
      (timestamp) => now - timestamp <= CONFIG.TYPING.TIME_WINDOW
    );
    if (filtered.length > 0) {
      userTypingLogs.set(userId, filtered);
    } else {
      userTypingLogs.delete(userId);
    }
  }

  // Clean up command logs
  for (const [userId, timestamps] of userCommandLogs) {
    const filtered = timestamps.filter(
      (timestamp) => now - timestamp <= CONFIG.COMMAND.TIME_WINDOW
    );
    if (filtered.length > 0) {
      userCommandLogs.set(userId, filtered);
    } else {
      userCommandLogs.delete(userId);
    }
  }

  console.log("Periodic cleanup completed.");
});

// ==================== Logging and Notifications ====================

// Function to handle detected self-bots (already implemented above)

// ==================== Running the Bot ====================

client.login(BOT_TOKEN);
