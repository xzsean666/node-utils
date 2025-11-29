import { SentenceSimilarity } from "../SentenceSimilarity";

async function main() {
  const sentenceSimilarity = new SentenceSimilarity();
  await sentenceSimilarity.init();
  const similarity = await sentenceSimilarity.getSimilarity(
    "Hello, world!",
    "Hello, universe!"
  );
  console.log(similarity);
}

main();
