import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

export class SlackMessage {
  private blocks: any[];
  private webhookUrl: string;
  private username?: string;
  private icon_emoji?: string;
  private channel?: string;
  private host?: string;

  constructor(webhookUrl: string) {
    this.blocks = [];
    this.webhookUrl = webhookUrl;
    this.host = process.env.HOST_NAME
      ? `Message from ${process.env.HOST_NAME}`
      : undefined;
  }

  // 设置发送者名称
  setUsername(username: string): this {
    this.username = username;
    return this;
  }

  // 设置发送者图标
  setIcon(emoji: string): this {
    this.icon_emoji = emoji;
    return this;
  }

  // 设置目标频道
  setChannel(channel: string): this {
    this.channel = channel;
    return this;
  }

  getMessage(): any {
    return {
      blocks: this.blocks,
      username: this.username,
      icon_emoji: this.icon_emoji,
      channel: this.channel,
    };
  }

  // 添加普通文本块
  addText(text: string): this {
    this.blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: text,
      },
    });
    return this;
  }

  // 添加分割线
  addDivider(): this {
    this.blocks.push({
      type: 'divider',
    });
    return this;
  }

  // 添加按钮
  addButton(text: string, actionId: string, value: string): this {
    this.blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: text,
          },
          action_id: actionId,
          value: value,
        },
      ],
    });
    return this;
  }

  // 添加字段列表
  addFields(fields: string[]): this {
    this.blocks.push({
      type: 'section',
      fields: fields.map((field) => ({
        type: 'mrkdwn',
        text: field,
      })),
    });
    return this;
  }

  // 清空消息块
  clear(): void {
    this.blocks = [];
  }

  // 发送消息到 Slack
  async send(text?: string): Promise<boolean> {
    try {
      // 在消息头部添加 host 信息
      const messageWithHost = this.host
        ? text
          ? `${this.host}\n${text}`
          : this.host
        : text;

      const payload = {
        text: messageWithHost || '',
      };

      const response = await axios.post(this.webhookUrl, payload, {
        // 避免通过系统代理转发到 Slack（代理会导致 400 Proxy error）
        proxy: false,
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      console.log('Message sent to Slack successfully');
      return response.status === 200;
    } catch (error) {
      console.error('Failed to send message to Slack:', error);
      return false;
    }
  }

  // 检查配置状态
  getConfigStatus(): {
    hasWebhook: boolean;
    canSendText: boolean;
    channel?: string;
  } {
    const hasWebhook = !!this.webhookUrl;

    return {
      hasWebhook,
      canSendText: hasWebhook,
      channel: this.channel,
    };
  }
}
