import { PriceHistoryInterval } from "../clobHelper";
import { ClobHelper } from "../clobHelper";

const clobHelper = new ClobHelper();

const testTokenId =
  "1058034204743981638761184078775429143309188189262032449052514787758187822006";
const tokenIds = [
  "17648915224792903315311551538465127188735444015854429477250693170076466976557",
  "50009806211022054972034898005071786712855699957661803368961436195761757669566",
];
async function main() {
  // const orderbook = await clobHelper.getOrderBook(testTokenId);
  // console.log(orderbook);
  const orderbooks = await clobHelper.getOrderBooks(tokenIds);
  console.log(orderbooks);
  const priceHistory = await clobHelper.getRecentPriceHistory({
    tokenId: testTokenId,
    durationDays: 30,
  });

  // Sort by timestamp and remove duplicates
  // const sortedAndUnique = priceHistory.history
  //   .sort((a, b) => a.t - b.t) // Sort by timestamp (ascending)
  //   .filter(
  //     (item, index, self) => index === 0 || item.t !== self[index - 1].t // Keep item if it's the first one or if its timestamp differs from the previous one
  //   );
  // console.log(sortedAndUnique.length);

  // Replace the original history array with the sorted and deduplicated one
  // priceHistory.history = sortedAndUnique;

  console.log(priceHistory[0], priceHistory[priceHistory.length - 1]);
  console.log(
    new Date(priceHistory[0].t * 1000),
    new Date(priceHistory[priceHistory.length - 1].t * 1000)
  );
}

main();
