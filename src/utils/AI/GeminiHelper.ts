import { GoogleGenerativeAI, Schema, Content } from '@google/generative-ai';
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
  responseMimeType?: string;
}

interface Model {
  name: string;
  baseModelId?: string;
  version: string;
  displayName: string;
  description: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  supportedGenerationMethods: string[];
  temperature?: number;
  maxTemperature?: number;
  topP?: number;
  topK?: number;
}

interface ListModelsResponse {
  models: Model[];
  nextPageToken?: string;
}

type ModelType =
  | 'gemini-2.0-flash'
  | 'gemini-2.5-flash-lite-preview-06-17'
  | 'gemini-2.5-flash'
  | 'gemma-3-27b-it';

export class GeminiHelper {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private chat: any;
  private history: ChatMessage[] = [];
  private systemInstruction?: string | { parts: { text: string }[] };
  private responseMimeType?: string;
  private apiKey: string;
  private proxyUrl?: string;

  constructor(apiKey: string, config: GeminiConfig = {}) {
    const {
      systemInstruction,
      model = Math.random() < 0.5
        ? 'gemini-2.0-flash'
        : 'gemini-2.0-flash-lite',
      proxyUrl,
    } = config;

    this.apiKey = apiKey;
    this.proxyUrl = proxyUrl;
    this.responseMimeType = config.responseMimeType;

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
      let systemInstructionForModel: Content;
      if (typeof this.systemInstruction === 'string') {
        systemInstructionForModel = {
          role: 'system',
          parts: [{ text: this.systemInstruction }],
        };
      } else {
        systemInstructionForModel = {
          role: 'system',
          parts: this.systemInstruction.parts,
        };
      }
      chatOptions.systemInstruction = systemInstructionForModel;
    }

    this.chat = this.model.startChat(chatOptions);
  }

  /**
   * 列出可用的Gemini模型
   * @param pageSize 每页返回的模型数量，默认50，最大1000
   * @param pageToken 分页令牌，用于获取下一页结果
   * @returns 返回模型列表和下一页令牌
   */
  async listModels(
    pageSize?: number,
    pageToken?: string,
  ): Promise<ListModelsResponse> {
    try {
      const url = new URL(
        'https://generativelanguage.googleapis.com/v1beta/models',
      );
      url.searchParams.append('key', this.apiKey);

      if (pageSize) {
        url.searchParams.append('pageSize', pageSize.toString());
      }

      if (pageToken) {
        url.searchParams.append('pageToken', pageToken);
      }

      let response: Response;

      if (this.proxyUrl) {
        // 使用代理
        const proxyAgent = new HttpsProxyAgent(this.proxyUrl);
        const axiosResponse = await axios({
          url: url.toString(),
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          httpsAgent: proxyAgent,
        });

        response = new Response(JSON.stringify(axiosResponse.data), {
          status: axiosResponse.status,
          statusText: axiosResponse.statusText,
          headers: new Headers(axiosResponse.headers as any),
        });
      } else {
        // 直接请求
        response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: ListModelsResponse = await response.json();
      return data;
    } catch (error) {
      console.error('Gemini List Models Error:', error);
      throw new Error('Error fetching models list');
    }
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
   * 发送消息并获取结构化回复
   * @param message 用户消息
   * @param responseSchema 定义所需 JSON 结构的模式对象
   * @returns 返回AI根据模式生成的结构化回复（JSON对象）
   */
  async sendMessageStructured<T>(
    message: string,
    responseSchema: Schema,
  ): Promise<T> {
    try {
      let systemInstructionForModel: Content | undefined;
      if (this.systemInstruction) {
        if (typeof this.systemInstruction === 'string') {
          systemInstructionForModel = {
            role: 'system',
            parts: [{ text: this.systemInstruction }],
          };
        } else {
          systemInstructionForModel = {
            role: 'system',
            parts: this.systemInstruction.parts,
          };
        }
      }

      const modelWithConfig = this.genAI.getGenerativeModel({
        model: this.model.modelName,
        generationConfig: {
          responseMimeType: this.responseMimeType || 'application/json',
          responseSchema: responseSchema,
        },
        systemInstruction: systemInstructionForModel,
      });

      const result = await modelWithConfig.generateContent(message);
      const response = result.response;
      const responseText = response.text();

      try {
        const parsedResponse: T = JSON.parse(responseText);
        return parsedResponse;
      } catch (jsonError) {
        console.error('Failed to parse JSON response:', jsonError);
        throw new Error('Model did not return valid JSON');
      }
    } catch (error) {
      console.error('Gemini Structured Chat Error:', error);
      throw new Error('Error processing structured chat request');
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
