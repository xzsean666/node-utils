import { Bot, Context, session, SessionFlavor } from "grammy";
import { InlineKeyboard } from "grammy";
import { Message } from "grammy/types";
import { HttpsProxyAgent } from "https-proxy-agent";

/**
 * Base session data interface
 */
export interface BaseSessionData {
  messageCount: number;
  lastMessageTime?: Date;
  userId?: number;
  username?: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Session context with base session data
 */
export type BaseContext = Context & SessionFlavor<BaseSessionData>;

/**
 * Base grammy helper class for Telegram bot
 */
export class GrammyBase {
  bot: Bot<BaseContext>;

  /**
   * Constructor
   * @param token Telegram bot token
   * @param proxyUrl Optional proxy URL
   */
  constructor(token: string, proxyUrl?: string) {
    if (proxyUrl) {
      const agent = new HttpsProxyAgent(proxyUrl);
      this.bot = new Bot<BaseContext>(token, {
        client: {
          apiRoot: "https://api.telegram.org",
          baseFetchConfig: {
            agent,
            compress: true,
          },
        },
      });
    } else {
      this.bot = new Bot<BaseContext>(token);
    }

    // Initialize session middleware
    this.setupSession();

    // Setup error handling
    this.setupErrorHandling();
  }

  /**
   * Setup session middleware
   */
  private setupSession() {
    this.bot.use(
      session({
        initial(): BaseSessionData {
          return {
            messageCount: 0,
          };
        },
      })
    );
  }

  /**
   * Setup error handling
   */
  private setupErrorHandling() {
    this.bot.catch((err) => {
      console.error("Error in Telegram bot:", err);
    });
  }

  /**
   * Start the bot
   */
  start() {
    this.bot.start();
    console.log("Bot started");
  }

  /**
   * Stop the bot
   */
  stop() {
    this.bot.stop();
  }

  /**
   * Send text message
   * @param chatId Chat ID
   * @param text Message text
   * @param options Additional options
   * @returns Promise with message
   */
  async sendMessage(
    chatId: number | string,
    text: string,
    options: {
      keyboard?: InlineKeyboard;
      parseMode?: "HTML" | "MarkdownV2" | "Markdown";
    } = {}
  ): Promise<Message.TextMessage> {
    return await this.bot.api.sendMessage(chatId, text, {
      parse_mode: options.parseMode,
      reply_markup: options.keyboard,
    });
  }

  /**
   * Update user info in session
   * @param ctx Bot context
   */
  updateUserInfo(ctx: BaseContext) {
    if (ctx.from) {
      ctx.session.userId = ctx.from.id;
      ctx.session.username = ctx.from.username;
      ctx.session.firstName = ctx.from.first_name;
      ctx.session.lastName = ctx.from.last_name;
      ctx.session.lastMessageTime = new Date();
      ctx.session.messageCount++;
    }
  }

  /**
   * Create inline keyboard
   * @param buttons Array of button rows with text and callback data
   * @returns InlineKeyboard
   */
  createInlineKeyboard(
    buttons: Array<Array<{ text: string; callbackData: string }>>
  ) {
    const keyboard = new InlineKeyboard();

    for (const row of buttons) {
      for (const button of row) {
        keyboard.text(button.text, button.callbackData);
      }
      keyboard.row();
    }

    return keyboard;
  }

  /**
   * Register command handler
   * @param command Command name without slash
   * @param handler Command handler function
   */
  command(
    command: string,
    handler: (ctx: BaseContext) => Promise<void> | void
  ) {
    this.bot.command(command, async (ctx) => {
      this.updateUserInfo(ctx);
      await handler(ctx);
    });
  }

  /**
   * Register text message handler
   * @param handler Text handler function
   */
  onText(handler: (ctx: BaseContext) => Promise<void> | void) {
    this.bot.on("message:text", async (ctx) => {
      this.updateUserInfo(ctx);
      await handler(ctx);
    });
  }

  /**
   * Register callback query handler
   * @param callbackData Callback data or regex
   * @param handler Callback handler function
   */
  onCallback(
    callbackData: string | RegExp,
    handler: (ctx: BaseContext) => Promise<void> | void
  ) {
    this.bot.callbackQuery(callbackData, async (ctx) => {
      this.updateUserInfo(ctx);
      await handler(ctx);
      await ctx.answerCallbackQuery();
    });
  }
}
