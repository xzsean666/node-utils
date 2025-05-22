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
export const prompt = {
  vocabulary_explanation:
    'You are a vocabulary expert. You will receive an array of vocabulary words and need to return an array of explanations. For each word, provide:\n' +
    '1. The word itself\n' +
    '2. Its pronunciation in IPA format\n' +
    '3. Multiple definitions with parts of speech\n' +
    'For verbs, include different forms (e.g., present, past, past participle).\n' +
    'Format each explanation as a JSON object with the following structure:\n' +
    '{\n' +
    '  "word": "string",\n' +
    '  "pronunciation": "string (IPA format)",\n' +
    '  "definitions": [\n' +
    '    {\n' +
    '      "partOfSpeech": "string (e.g., v., n., adj., adv.)",\n' +
    '      "meaning": "string"\n' +
    '    }\n' +
    '  ]\n' +
    '}\n' +
    'Keep explanations clear and concise. For verbs, include all relevant forms in the definitions.',
  word_flow_card_generation:
    "You are a helpful assistant that creates sentences using provided English words. Tailor the sentences to topics related to the user's interests. You will receive an array of English words and the user's interest tags. For each consecutive group of 5 words in the array, create ONE sentence that includes all 5 words, ensuring the sentence context aligns with the provided interest tags. Present each sentence in three different formats. Return the final result as a JSON array where each element corresponds to a sentence generated from a group of 5 words. The structure for each element in the JSON array should be:\n" +
    '[\n' +
    '  {\n' +
    '    "mixed_language": "The sentence with English words kept as-is while the rest is in Chinese",\n' +
    '    "english_only": "The exact same sentence fully in English",\n' +
    '    "fill_in_blanks": "The exact same sentence in English but with the given English words replaced by their first character followed by a number of ? equal to the remaining characters.",\n' +
    '    "used_words": ["word1", "word2", "word3", "word4", "word5"]\n' +
    '  },\n' +
    '  // ... other sentence objects\n' +
    ']\n' +
    'Process the words in batches of 5. If the total number of words is not a multiple of 5, process the last remaining words as a single batch.',
};

async function main() {
  const config = {
    proxyUrl,
    systemInstruction: prompt.word_flow_card_generation,
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
  const selectedWordsStr = words.join(', ');
  const hash = CryptoHelper.calculateSHA256(
    selectedWordsStr + config.systemInstruction,
  );

  const result = await helper.sendMessage(`${selectedWordsStr}`);
  console.log('selectedWords:', selectedWords);
  console.log('systemInstruction:', config.systemInstruction);
  console.log('hash:', hash);
  console.log('result:', result);
}
main();
