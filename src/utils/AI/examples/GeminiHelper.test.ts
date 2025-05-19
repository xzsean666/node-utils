import { GeminiHelper } from '../GeminiHelper';
import { config as dotenvConfig } from 'dotenv';
dotenvConfig();
import { CryptoHelper } from '../../encodeUtils/cryptoHelper';

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
<<<<<<< Updated upstream
      'You are a helpful assistant that creates sentences using provided English words. Create ONE sentence and present it in three different formats. Return the result in JSON format with the following structure:\n' +
      '{\n' +
      '  "mixedLanguage": "The sentence with English words kept as-is while the rest is in Chinese",\n' +
      '  "englishOnly": "The exact same sentence fully in English",\n' +
      '  "fillInBlanks": "The exact same sentence in English but with the given English words replaced by ???"\n' +
      '}',
=======
      'You are a helpful assistant that creates one sentences using provided English words. When using the words in the sentences, keep them in English while the rest of the text should be in Chinese. Focus on creating sentences related to technology and automotive topics.',
>>>>>>> Stashed changes
  };
  const helper = new GeminiHelper(apikey, config);

  // Randomly select 5 words
  const selectedWords: string[] = [];
  const selectedWords2 = [
    'legislation',
    'response',
    'significant',
    'identified',
    'create',
  ];
  const wordsCopy: string[] = [...words];
  for (let i = 0; i < 5; i++) {
    const randomIndex = Math.floor(Math.random() * wordsCopy.length);
    selectedWords.push(wordsCopy[randomIndex]);
    wordsCopy.splice(randomIndex, 1);
  }
  const selectedWordsStr = selectedWords.join(', ');
  const hash = CryptoHelper.calculateSHA256(
    selectedWordsStr + config.systemInstruction,
  );

<<<<<<< Updated upstream
  const result = await helper.sendMessage(`${selectedWordsStr}`);
  console.log('selectedWords:', selectedWords);
  console.log('systemInstruction:', config.systemInstruction);
  console.log('hash:', hash);
  console.log('result:', result);
=======
  const result = await helper.sendMessage(`${selectedWords2.join(', ')}`);
  console.log(result);
>>>>>>> Stashed changes
}
main();
