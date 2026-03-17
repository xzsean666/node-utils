import {
  GoogleGenAI,
  Schema,
  Content,
  createUserContent,
  createPartFromUri,
} from '@google/genai';
import { HttpsProxyAgent } from 'https-proxy-agent';
import axios from 'axios';

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

interface GeminiConfig {
  systemInstruction?: string;
  model?: ModelType;
  proxyUrl?: string;
  responseMimeType?: string;
  // 暂时注释文件功能，后续会用正确的方式实现
  // systemFiles?: string[];
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
  | 'gemini-2.0-flash-exp'
  | 'gemini-2.5-flash-lite-preview-06-17'
  | 'gemini-1.5-flash'
  | 'gemini-1.5-pro';

export class GeminiHelper {
  private genAI: GoogleGenAI;
  private model: string;
  private history: ChatMessage[] = [];
  private systemInstruction?: string;
  private responseMimeType?: string;
  private apiKey: string;
  private proxyUrl?: string;

  constructor(apiKey: string, config: GeminiConfig = {}) {
    const {
      systemInstruction,
      model = 'gemini-2.5-flash-lite-preview-06-17',
      proxyUrl,
    } = config;

    this.apiKey = apiKey;
    this.proxyUrl = proxyUrl;
    this.model = model;
    this.systemInstruction = systemInstruction;
    this.responseMimeType = config.responseMimeType;

    // Configure global fetch for proxy if needed
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

    this.genAI = new GoogleGenAI({ apiKey });
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
   * @param filePath 可选的文件路径
   * @returns 返回AI的回复
   */
  async sendMessage(message: string, filePath?: string): Promise<string> {
    try {
      let contents: Content[];

      if (filePath) {
        // 如果有文件，上传文件并使用单次对话模式
        const uploadedFile = await this.uploadFile(filePath);

        // 检查文件上传结果
        if (!uploadedFile.uri || !uploadedFile.mimeType) {
          throw new Error('File upload failed: missing URI or MIME type');
        }

        // 使用 createUserContent 和 createPartFromUri 构建内容
        const content = createUserContent([
          message,
          createPartFromUri(uploadedFile.uri, uploadedFile.mimeType),
        ]);

        contents = [content];

        // 添加到历史记录
        this.history.push({
          role: 'user',
          text: `${message} [File: ${filePath}]`,
        });
      } else {
        // 普通文本消息，添加到历史记录
        this.history.push({ role: 'user', text: message });

        // 构建对话内容
        contents = this.history.map((msg) => ({
          role: msg.role,
          parts: [{ text: msg.text }],
        }));
      }

      // 使用新的 API 结构
      const response = await this.genAI.models.generateContent({
        model: this.model,
        contents: contents,
        config: {
          systemInstruction: this.systemInstruction,
        },
      });

      const responseText = response.text || '';

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
   * @param filePath 可选的文件路径
   */
  async sendMessageStream(
    message: string,
    onChunk: (text: string) => void,
    filePath?: string,
  ): Promise<void> {
    try {
      let contents: Content[];

      if (filePath) {
        // 如果有文件，上传文件并使用单次对话模式
        const uploadedFile = await this.uploadFile(filePath);

        // 检查文件上传结果
        if (!uploadedFile.uri || !uploadedFile.mimeType) {
          throw new Error('File upload failed: missing URI or MIME type');
        }

        // 使用 createUserContent 和 createPartFromUri 构建内容
        const content = createUserContent([
          message,
          createPartFromUri(uploadedFile.uri, uploadedFile.mimeType),
        ]);

        contents = [content];

        // 添加到历史记录
        this.history.push({
          role: 'user',
          text: `${message} [File: ${filePath}]`,
        });
      } else {
        // 普通文本消息，添加到历史记录
        this.history.push({ role: 'user', text: message });

        // 构建对话内容
        contents = this.history.map((msg) => ({
          role: msg.role,
          parts: [{ text: msg.text }],
        }));
      }

      // 使用新的流式 API
      const response = await this.genAI.models.generateContentStream({
        model: this.model,
        contents: contents,
        config: {
          systemInstruction: this.systemInstruction,
        },
      });

      let fullResponse = '';

      for await (const chunk of response) {
        const text = chunk.text || '';
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
   * 上传文件到 Google 并获取文件 URI
   * @param filePath 本地文件路径
   * @returns 返回文件信息
   */
  async uploadFile(filePath: string) {
    try {
      const uploadedFile = await this.genAI.files.upload({
        file: filePath,
      });
      return uploadedFile;
    } catch (error) {
      console.error('File upload error:', error);
      throw new Error('Error uploading file');
    }
  }

  /**
   * 清空聊天历史记录并重新开始对话
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * 获取当前对话历史
   */
  getHistory(): ChatMessage[] {
    return [...this.history];
  }
}
