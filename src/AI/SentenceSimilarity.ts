import * as tf from '@tensorflow/tfjs-node'; // 或 '@tensorflow/tfjs' 用于浏览器
import * as use from '@tensorflow-models/universal-sentence-encoder';

export class SentenceSimilarity {
  private model: use.UniversalSentenceEncoder | null = null;

  async init() {
    if (!this.model) {
      // Initialize TensorFlow.js backend
      await tf.ready();

      console.log('Loading model...');
      this.model = await use.load();
      console.log('Model loaded!');
    }
  }

  async getSimilarity(text1: string, text2: string): Promise<number> {
    if (!this.model) {
      throw new Error('Model not initialized');
    }

    // 获取句子嵌入
    const embeddings = await this.model.embed([text1, text2]);
    const vectors = await embeddings.array();

    // 计算余弦相似度
    return this.cosineSimilarity(vectors[0], vectors[1]);
  }

  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    const dotProduct = vec1.reduce((acc, val, i) => acc + val * vec2[i], 0);
    const norm1 = Math.sqrt(vec1.reduce((acc, val) => acc + val * val, 0));
    const norm2 = Math.sqrt(vec2.reduce((acc, val) => acc + val * val, 0));
    return dotProduct / (norm1 * norm2);
  }
}
