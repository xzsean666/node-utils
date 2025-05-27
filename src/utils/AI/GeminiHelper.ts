import { GoogleGenerativeAI } from '@google/generative-ai';
import { HttpsProxyAgent } from 'https-proxy-agent';
import axios from 'axios';

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

interface GeminiConfig {
  systemInstruction?: string | { parts: { text: string }[] };
  model?: ModelType;
  proxyUrl?: string;
}

type ModelType =
  | 'gemini-2.0-flash'
  | 'gemini-2.5-pro-exp-03-25'
  | 'gemini-2.0-flash-lite';

export class GeminiHelper {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private chat: any;
  private history: ChatMessage[] = [];
  private systemInstruction?: string | { parts: { text: string }[] };

  constructor(apiKey: string, config: GeminiConfig = {}) {
    const {
      systemInstruction,
      model = Math.random() < 0.5
        ? 'gemini-2.0-flash'
        : 'gemini-2.0-flash-lite',
      proxyUrl,
    } = config;

    // Configure global fetch
    if (proxyUrl) {
      const proxyAgent = new HttpsProxyAgent(proxyUrl);
      global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        let url: string;
        let requestInit: RequestInit = { ...init };

        if (typeof input === 'string' || input instanceof URL) {
          url = input.toString();
        } else {
          // input is a Request object
          url = input.url;
          requestInit = {
            method: input.method,
            headers: input.headers as any,
            body: input.body,
            ...init,
          };
        }

        const response = await axios({
          url,
          method: requestInit.method || 'GET',
          headers: requestInit.headers as any,
          data: requestInit.body,
          responseType: 'arraybuffer',
          httpsAgent: proxyAgent,
        });

        return new Response(response.data, {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers(response.headers as any),
        });
      };
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model });
    if (systemInstruction) {
      this.systemInstruction =
        typeof systemInstruction === 'string'
          ? { parts: [{ text: systemInstruction }] }
          : systemInstruction;
    }
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

    // 添加 systemInstruction
    if (this.systemInstruction) {
      chatOptions.systemInstruction = this.systemInstruction;
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
      this.history.push({ role: 'user', text: message });

      const result = await this.chat.sendMessage(message);
      const response = await result.response;
      const responseText = response.text();

      // 添加AI回复到历史记录
      this.history.push({ role: 'model', text: responseText });

      return responseText;
    } catch (error) {
      console.error('Gemini Chat Error:', error);
      throw new Error('Error processing chat request');
    }
  }

  /**
   * 发送消息并获取流式回复
   * @param message 用户消息
   * @param onChunk 处理每个文本块的回调函数
   */
  async sendMessageStream(
    message: string,
    onChunk: (text: string) => void,
  ): Promise<void> {
    try {
      // 添加用户消息到历史记录
      this.history.push({ role: 'user', text: message });

      const result = await this.chat.sendMessageStream(message);
      let fullResponse = '';

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          fullResponse += text;
          onChunk(text);
        }
      }

      // 添加完整的AI回复到历史记录
      this.history.push({ role: 'model', text: fullResponse });
    } catch (error) {
      console.error('Gemini Chat Error:', error);
      throw new Error('Error processing chat request');
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
