import { GrammyBase } from "../grammYBase";

// Replace with your actual Telegram bot token
const token = "8187983534:AAFoGynqcfxx5mLkmqRncmAI6UsDOnHqzFs";

// Optional proxy configuration
const proxyUrl = "http://127.0.0.1:7897"; // Replace with your actual proxy URL

// Create bot instance with proxy support
const bot = new GrammyBase(token, proxyUrl);

// If you don't need proxy, you can initialize without it:
// const bot = new GrammyBase(token);

bot.command("check", async (ctx) => {
  // Get the text after the command using ctx.match
  const commandParameter = ctx.match || "";

  if (commandParameter) {
    await ctx.reply(`check: ${commandParameter}`);
  } else {
    await ctx.reply("Please provide some text after the /check command");
  }
});
// Register command handlers
bot.command("start", async (ctx) => {
  await ctx.reply(
    `Welcome, ${
      ctx.session.firstName || "there"
    }! I'm a bot created with GrammyBase.`
  );
});

bot.command("info", async (ctx) => {
  const info = [
    `User ID: ${ctx.session.userId}`,
    `Username: ${ctx.session.username || "Not available"}`,
    `Message count: ${ctx.session.messageCount}`,
    `Last message time: ${
      ctx.session.lastMessageTime?.toLocaleString() || "Not available"
    }`,
  ].join("\n");

  await ctx.reply(info);
});

// Create an inline keyboard example
bot.command("menu", async (ctx) => {
  const keyboard = bot.createInlineKeyboard([
    [{ text: "Option 1", callbackData: "option_1" }],
    [{ text: "Option 2", callbackData: "option_2" }],
  ]);

  if (ctx.chat) {
    await bot.sendMessage(ctx.chat.id, "Choose an option:", { keyboard });
  }
});

// Handle callback queries
bot.onCallback("option_1", async (ctx) => {
  await ctx.reply("You selected Option 1!");
});

bot.onCallback("option_2", async (ctx) => {
  await ctx.reply("You selected Option 2!");
});

// Handle text messages
bot.onText(async (ctx) => {
  if (ctx.message) {
    const messageText = ctx.message.text;
    await ctx.reply(`You said: ${messageText}`);

    // Access session data
    console.log(
      `Message from ${ctx.session.username}, count: ${ctx.session.messageCount}`
    );
  }
});

// Start the bot
console.log("Bot starting...");
bot.start();
console.log("Bot is running!");
