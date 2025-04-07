import { GoogleGenerativeAI } from "@google/generative-ai";

interface ChatMessage {
  role: "user" | "model";
  text: string;
}

export class GeminiHelper {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private chat: any;
  private history: ChatMessage[] = [];

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    const model2 = "gemini-2.0-flash";
    const model25 = "gemini-2.5-pro-exp-03-25";

    this.model = this.genAI.getGenerativeModel({ model: model25 });
    this.initializeChat();
  }

  private initializeChat(): void {
    const chatOptions: any = {};

    // 添加历史记录
    if (this.history.length > 0) {
      chatOptions.history = this.history.map((msg) => ({
        role: msg.role,
        parts: [{ text: msg.text }],
      }));
    }

    this.chat = this.model.startChat(chatOptions);
  }

  /**
   * 发送消息并获取回复
   * @param message 用户消息
   * @returns 返回AI的回复
   */
  async sendMessage(message: string): Promise<string> {
    try {
      // 添加用户消息到历史记录
      this.history.push({ role: "user", text: message });

      const result = await this.chat.sendMessage(message);
      const response = await result.response;
      const responseText = response.text();

      // 添加AI回复到历史记录
      this.history.push({ role: "model", text: responseText });

      return responseText;
    } catch (error) {
      console.error("Gemini Chat Error:", error);
      throw new Error("Error processing chat request");
    }
  }

  /**
   * 发送消息并获取流式回复
   * @param message 用户消息
   * @param onChunk 处理每个文本块的回调函数
   */
  async sendMessageStream(
    message: string,
    onChunk: (text: string) => void
  ): Promise<void> {
    try {
      // 添加用户消息到历史记录
      this.history.push({ role: "user", text: message });

      const result = await this.chat.sendMessageStream(message);
      let fullResponse = "";

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          fullResponse += text;
          onChunk(text);
        }
      }

      // 添加完整的AI回复到历史记录
      this.history.push({ role: "model", text: fullResponse });
    } catch (error) {
      console.error("Gemini Chat Error:", error);
      throw new Error("Error processing chat request");
    }
  }

  /**
   * 清空聊天历史记录并重新开始对话
   */
  clearHistory(): void {
    this.history = [];
    this.initializeChat();
  }

  /**
   * 获取当前对话历史
   */
  getHistory(): ChatMessage[] {
    return [...this.history];
  }
}
