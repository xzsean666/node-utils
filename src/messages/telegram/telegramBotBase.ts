import { Bot, Context, session, SessionFlavor, InputFile } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { Message } from 'grammy/types';
import { HttpsProxyAgent } from 'https-proxy-agent';

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
export class TelegramBotBase {
  bot: Bot<BaseContext>;
  private messageHandlers: Array<(ctx: BaseContext) => Promise<void> | void> =
    [];

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
          apiRoot: 'https://api.telegram.org',
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

    // Setup message handlers
    // this.setupMessageHandlers();
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
      }),
    );
  }

  /**
   * Setup error handling
   */
  private setupErrorHandling() {
    this.bot.catch((err) => {
      console.error('Error in Telegram bot:', err);
    });
  }

  /**
   * Setup message handlers - similar to TelegramJSBase
   */
  private setupMessageHandlers() {
    this.bot.on('message:text', async (ctx) => {
      // Skip command messages (starting with /) to let command handlers process them
      if (ctx.message?.text?.startsWith('/')) {
        return;
      }

      this.updateUserInfo(ctx);
      for (const handler of this.messageHandlers) {
        try {
          await handler(ctx);
        } catch (error) {
          console.error('Error in message handler:', error);
        }
      }
    });
  }

  /**
   * Start the bot
   */
  start() {
    this.bot.start();
    console.log('Bot started');
  }

  /**
   * Stop the bot
   */
  stop() {
    this.bot.stop();
  }

  /**
   * Connect the bot (alias for start for consistency with TelegramJSBase)
   */
  async connect(): Promise<void> {
    this.start();
  }

  /**
   * Disconnect the bot (alias for stop for consistency with TelegramJSBase)
   */
  async disconnect(): Promise<void> {
    this.stop();
  }

  /**
   * Get current user info (bot info)
   */
  getUserInfo(): BaseSessionData {
    // For bot, we can only return static info since we don't have user session context here
    return {
      messageCount: 0,
      lastMessageTime: undefined,
      userId: undefined,
      username: undefined,
      firstName: undefined,
      lastName: undefined,
    };
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
      parseMode?: 'HTML' | 'MarkdownV2' | 'Markdown';
    } = {},
  ): Promise<Message.TextMessage> {
    return await this.bot.api.sendMessage(chatId, text, {
      parse_mode: options.parseMode,
      reply_markup: options.keyboard,
    });
  }

  /**
   * Send file
   * @param chatId Chat ID
   * @param file File to send (can be file path, URL, or Buffer)
   * @param options Send options
   * @returns Promise with message
   */
  async sendFile(
    chatId: number | string,
    file: string | Buffer | Uint8Array,
    options: {
      caption?: string;
      parseMode?: 'HTML' | 'MarkdownV2' | 'Markdown';
      keyboard?: InlineKeyboard;
    } = {},
  ): Promise<Message> {
    if (typeof file === 'string') {
      // If file is a string, treat it as a file path or URL
      return await this.bot.api.sendDocument(chatId, file, {
        caption: options.caption,
        parse_mode: options.parseMode,
        reply_markup: options.keyboard,
      });
    } else {
      // If file is Buffer or Uint8Array, create an InputFile
      const inputFile = new InputFile(file);
      return await this.bot.api.sendDocument(chatId, inputFile, {
        caption: options.caption,
        parse_mode: options.parseMode,
        reply_markup: options.keyboard,
      });
    }
  }

  /**
   * Get messages from a chat (using bot API)
   * @param chatId Chat ID
   * @param options Get options
   * @returns Promise with messages array
   */
  async getMessages(
    chatId: number | string,
    options: {
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<Message[]> {
    // Note: Bot API has limitations for getting historical messages
    // This is a simplified implementation using getUpdates
    // For full message history access, use TelegramJSBase instead

    try {
      const updates = await this.bot.api.getUpdates({
        limit: options.limit || 10,
        offset: options.offset,
      });

      const messages = updates
        .filter(
          (update) =>
            update.message &&
            update.message.chat.id.toString() === chatId.toString(),
        )
        .map((update) => update.message!)
        .slice(0, options.limit || 10);

      return messages;
    } catch (error) {
      console.error('Error getting messages:', error);
      return [];
    }
  }

  /**
   * Check if bot is authorized (always true for bots)
   */
  async isAuthorized(): Promise<boolean> {
    try {
      await this.bot.api.getMe();
      return true;
    } catch {
      return false;
    }
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
    buttons: Array<Array<{ text: string; callbackData: string }>>,
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
    handler: (ctx: BaseContext) => Promise<void> | void,
  ) {
    this.bot.command(command, async (ctx) => {
      this.updateUserInfo(ctx);
      await handler(ctx);
    });
  }

  /**
   * Register text message handler - now consistent with TelegramJSBase
   * @param handler Text handler function
   */
  onMessage(handler: (ctx: BaseContext) => Promise<void> | void): void {
    // Register directly on the bot, but skip command messages
    this.bot.on('message:text', async (ctx) => {
      // Skip command messages (starting with /) to let command handlers process them
      if (ctx.message?.text?.startsWith('/')) {
        return;
      }

      this.updateUserInfo(ctx);
      try {
        await handler(ctx);
      } catch (error) {
        console.error('Error in message handler:', error);
      }
    });
  }

  /**
   * Register callback query handler
   * @param callbackData Callback data or regex
   * @param handler Callback handler function
   */
  onCallback(
    callbackData: string | RegExp,
    handler: (ctx: BaseContext) => Promise<void> | void,
  ) {
    this.bot.callbackQuery(callbackData, async (ctx) => {
      this.updateUserInfo(ctx);
      await handler(ctx);
      await ctx.answerCallbackQuery();
    });
  }
}
