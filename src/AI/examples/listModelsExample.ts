import { GeminiHelper } from '../GeminiHelper';
import dotenv from 'dotenv';

dotenv.config();

async function listModelsExample() {
  // 初始化GeminiHelper
  const apiKey = process.env.GEMINI_API_KEY || 'your-api-key-here';
  const proxyUrl = process.env.PROXY_URL || '';
  console.log('proxyUrl', proxyUrl);
  console.log('apiKey', apiKey);
  const geminiHelper = new GeminiHelper(apiKey, { proxyUrl });

  try {
    console.log('获取所有可用的Gemini模型...\n');

    // 获取第一页模型（默认50个）
    const modelsResponse = await geminiHelper.listModels();

    console.log(`找到 ${modelsResponse.models.length} 个模型:`);
    console.log('='.repeat(50));

    // 打印每个模型的基本信息
    modelsResponse.models.forEach((model, index) => {
      console.log(`${index + 1}. ${model.displayName || model.name}`);
      console.log(`   名称: ${model.name}`);
      console.log(`   版本: ${model.version}`);
      console.log(`   描述: ${model.description}`);
      console.log(`   输入限制: ${model.inputTokenLimit} tokens`);
      console.log(`   输出限制: ${model.outputTokenLimit} tokens`);
      console.log(
        `   支持的方法: ${model.supportedGenerationMethods.join(', ')}`,
      );
      console.log('');
    });

    // 如果有下一页，获取下一页
    if (modelsResponse.nextPageToken) {
      console.log('获取下一页模型...\n');
      const nextPageResponse = await geminiHelper.listModels(
        undefined,
        modelsResponse.nextPageToken,
      );
      console.log(`下一页找到 ${nextPageResponse.models.length} 个模型`);
    }

    // 筛选支持generateContent的模型
    console.log('\n支持generateContent的模型:');
    console.log('='.repeat(50));
    const generateContentModels = modelsResponse.models.filter((model) =>
      model.supportedGenerationMethods.includes('generateContent'),
    );

    generateContentModels.forEach((model, index) => {
      console.log(
        `${index + 1}. ${model.displayName || model.name} (${model.name})`,
      );
    });

    // 筛选支持embedContent的模型
    console.log('\n支持embedContent的模型:');
    console.log('='.repeat(50));
    const embedContentModels = modelsResponse.models.filter((model) =>
      model.supportedGenerationMethods.includes('embedContent'),
    );

    embedContentModels.forEach((model, index) => {
      console.log(
        `${index + 1}. ${model.displayName || model.name} (${model.name})`,
      );
    });
  } catch (error) {
    console.error('获取模型列表时发生错误:', error);
  }
}

// 如果直接运行此文件，则执行示例
if (require.main === module) {
  listModelsExample();
}

export { listModelsExample };
