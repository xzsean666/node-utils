import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export class GraphQLHelperAxios {
  private client: AxiosInstance;

  constructor(
    endpoint: string,
    headers?: Record<string, string>,
    config?: AxiosRequestConfig,
  ) {
    this.client = axios.create({
      baseURL: endpoint,
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {}),
      },
      ...config,
    });
  }

  /**
   * 执行 GraphQL 查询
   * @param query GraphQL 查询语句
   * @param variables 查询变量
   * @returns 查询结果
   */
  async query<T = any>(
    query: string,
    variables?: Record<string, any>,
  ): Promise<T> {
    try {
      const response: AxiosResponse<GraphQLResponse<T>> =
        await this.client.post('/', {
          query,
          variables,
        });

      const data = response.data;

      if (data.errors) {
        throw new Error(
          `GraphQL Errors: ${data.errors.map((e: any) => e.message).join(', ')}`,
        );
      }

      return data.data as T;
    } catch (error) {
      console.error('GraphQL query error:', error);
      throw error;
    }
  }

  /**
   * 执行 GraphQL 变更操作
   * @param mutation 变更操作语句
   * @param variables 变更变量
   * @returns 变更结果
   */
  async mutate<T = any>(
    mutation: string,
    variables?: Record<string, any>,
  ): Promise<T> {
    try {
      // 预处理 variables，自动序列化 JSON 类型的值
      const processedVariables = variables
        ? this.processVariables(variables)
        : undefined;

      const response: AxiosResponse<GraphQLResponse<T>> =
        await this.client.post('/', {
          query: mutation,
          variables: processedVariables,
        });
      const result = response.data;

      if (result.errors) {
        throw new Error(
          `GraphQL Errors: ${result.errors.map((e: any) => e.message).join(', ')}`,
        );
      }

      return result.data as T;
    } catch (error) {
      console.error('GraphQL mutation error:', error);
      throw error;
    }
  }

  /**
   * 处理变量，自动序列化需要的值
   * @param variables 变量对象
   * @returns 处理后的变量对象
   */
  private processVariables(
    variables: Record<string, any>,
  ): Record<string, any> {
    return Object.entries(variables).reduce(
      (acc, [key, value]) => {
        // 如果值是对象但不是Date、Array等，则序列化
        if (
          value &&
          typeof value === 'object' &&
          !(value instanceof Date) &&
          !Array.isArray(value)
        ) {
          acc[key] = JSON.stringify(value);
        } else {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, any>,
    );
  }

  /**
   * 更新 GraphQL 客户端的请求头
   * @param headers 新的请求头
   */
  setHeaders(headers: Record<string, string>): void {
    this.client.defaults.headers.common = {
      ...this.client.defaults.headers.common,
      ...headers,
    };
  }

  /**
   * 获取当前的 GraphQL 客户端实例
   * @returns GraphQL 客户端实例
   */
  getClient(): AxiosInstance {
    return this.client;
  }
}

// 使用示例：
/*
  // 基本用法 - 仅传入端点和 headers
  const graphqlHelperAxios = new GraphQLHelperAxios('https://api.example.com/graphql', {
    'Authorization': 'Bearer your-token'
  });

  // 高级用法 - 使用 AxiosRequestConfig 进行更多配置
  const advancedGraphqlHelper = new GraphQLHelperAxios(
    'https://api.example.com/graphql',
    {
      'Authorization': 'Bearer your-token'
    },
    {
      timeout: 10000,
      withCredentials: true,
      maxRedirects: 5,
      proxy: {
        host: 'proxy.example.com',
        port: 8080
      }
    }
  );
  
  // 查询示例
  const GET_USER = `
    query GetUser($id: ID!) {
      user(id: $id) {
        id
        name
        email
      }
    }
  `;
  
  async function fetchUser() {
    try {
      const userData = await graphqlHelperAxios.query(GET_USER, { id: '123' });
      console.log('User Data:', userData);
    } catch (error) {
      console.error('Error fetching user:', error);
    }
  }

  // 变更示例
  const UPDATE_USER = `
    mutation UpdateUser($id: ID!, $name: String!) {
      updateUser(id: $id, name: $name) {
        id
        name
        email
      }
    }
  `;
  
  async function updateUser() {
    try {
      const updatedUser = await graphqlHelperAxios.mutate(UPDATE_USER, { 
        id: '123', 
        name: 'New Name' 
      });
      console.log('Updated User:', updatedUser);
    } catch (error) {
      console.error('Error updating user:', error);
    }
  }

  // To run examples:
  // fetchUser();
  // updateUser();
*/
