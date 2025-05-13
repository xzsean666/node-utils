import { GeminiHelper } from '../GeminiHelper';
import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

const proxyUrl = 'http://127.0.0.1:7897';
const apikey = process.env.GEMINI_API_KEY || '';

const words = [
  'analyse',
  'approach',
  'area',
  'assess',
  'assume',
  'authority',
  'available',
  'benefit',
  'concept',
  'consistent',
  'constitutional',
  'context',
  'contract',
  'create',
  'data',
  'definition',
  'derived',
  'distribution',
  'economic',
  'environment',
  'established',
  'estimate',
  'evidence',
  'export',
  'factors',
  'financial',
  'formula',
  'function',
  'identified',
  'income',
  'indicate',
  'individual',
  'interpretation',
  'involved',
  'issues',
  'labour',
  'legal',
  'legislation',
  'major',
  'method',
  'occur',
  'percent',
  'period',
  'policy',
  'principle',
  'procedure',
  'process',
  'required',
  'research',
  'response',
  'role',
  'section',
  'sector',
  'significant',
  'similar',
  'source',
  'specific',
  'structure',
  'theory',
  'variables',
];

async function main() {
  const config = {
    proxyUrl,
    systemInstruction:
      'You are a helpful assistant that creates one sentences using provided English words. When using the words in the sentences, keep them in English while the rest of the text should be in Chinese.',
  };
  const helper = new GeminiHelper(apikey, config);

  // Randomly select 5 words
  const selectedWords: string[] = [];
  const wordsCopy: string[] = [...words];
  for (let i = 0; i < 5; i++) {
    const randomIndex = Math.floor(Math.random() * wordsCopy.length);
    selectedWords.push(wordsCopy[randomIndex]);
    wordsCopy.splice(randomIndex, 1);
  }

  const result = await helper.sendMessage(`${selectedWords.join(', ')}`);
  console.log(result);
}
main();
