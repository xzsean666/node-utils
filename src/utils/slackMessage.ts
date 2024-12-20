import axios from "axios";

export class SlackMessage {
  private blocks: any[];
  private webhookUrl: string;
  private username?: string;
  private icon_emoji?: string;
  private channel?: string;

  constructor(webhookUrl: string) {
    this.blocks = [];
    this.webhookUrl = webhookUrl;
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
      type: "section",
      text: {
        type: "mrkdwn",
        text: text,
      },
    });
    return this;
  }

  // 添加分割线
  addDivider(): this {
    this.blocks.push({
      type: "divider",
    });
    return this;
  }

  // 添加按钮
  addButton(text: string, actionId: string, value: string): this {
    this.blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
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
      type: "section",
      fields: fields.map((field) => ({
        type: "mrkdwn",
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
      const payload = text ? { text, ...this.getMessage() } : this.getMessage();

      const response = await axios.post(this.webhookUrl, payload);
      console.log("Message sent to Slack successfully");
      return response.status === 200;
    } catch (error) {
      console.error("Failed to send message to Slack:", error);
      return false;
    }
  }
}
