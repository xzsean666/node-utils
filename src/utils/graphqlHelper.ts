export class GraphQLHelper {
  private endpoint: string;
  private headers: Record<string, string>;

  constructor(endpoint: string, headers?: Record<string, string>) {
    this.endpoint = endpoint;
    this.headers = {
      "Content-Type": "application/json",
      ...(headers || {}),
    };
  }

  /**
   * 执行 GraphQL 查询
   * @param query GraphQL 查询语句
   * @param variables 查询变量
   * @returns 查询结果
   */
  async query<T = any>(
    query: string,
    variables?: Record<string, any>
  ): Promise<T> {
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ query, variables }),
      });
      const data = await response.json();
      return data.data as T;
    } catch (error) {
      console.error("GraphQL query error:", error);
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
    variables?: Record<string, any>
  ): Promise<T> {
    return this.query<T>(mutation, variables);
  }

  /**
   * 更新 GraphQL 客户端的请求头
   * @param headers 新的请求头
   */
  setHeaders(headers: Record<string, string>): void {
    this.headers = {
      ...this.headers,
      ...headers,
    };
  }

  /**
   * 获取当前的 GraphQL 客户端实例
   * @returns GraphQL 客户端实例
   */
  getClient(): any {
    return this;
  }
}

// 使用示例：
/*
  const graphqlHelper = new GraphQLHelper('https://api.example.com/graphql', {
    'Authorization': 'Bearer your-token'
  });
  
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
  
  const userData = await graphqlHelper.query(GET_USER, { id: '123' });
  
  // 变更示例
  const UPDATE_USER = `
    mutation UpdateUser($id: ID!, $name: String!) {
      updateUser(id: $id, name: $name) {
        id
        name
      }
    }
  `;
  
  const updatedUser = await graphqlHelper.mutate(UPDATE_USER, { 
    id: '123', 
    name: 'New Name' 
  });
  */
