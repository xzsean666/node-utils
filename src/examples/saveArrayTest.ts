import { KVDatabase } from '../db/PGKVDatabase';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testSaveArray() {
  // Create a database connection - replace with your actual connection string
  const connectionString =
    process.env.DATABASE_URL ||
    'postgresql://postgres:password@localhost:5432/testdb';
  const db = new KVDatabase(connectionString, 'kv_store');

  try {
    console.log('Starting array storage test with small batch size...');

    // 1. Save an initial array with small batch size (5)
    const key = 'test_array_small';
    const initialArray = Array.from({ length: 13 }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
      timestamp: new Date().toISOString(),
    }));

    console.log(
      `Saving initial array with ${initialArray.length} items (batch size: 5)...`,
    );
    await db.saveArray(key, initialArray, 6, true);
    console.log('Initial array saved.');

    // 2. Retrieve metadata to verify batch size was stored
    const metaKey = `${key}_meta`;
    const metadata = await db.get(metaKey);
    console.log('Array metadata:', metadata);

    // 3. Retrieve the entire array
    const fullArray = await db.getAllArray(key);
    console.log(`Retrieved full array with ${fullArray.length} items.`);
    console.log('First item:', fullArray[0]);
    console.log('Last item:', fullArray[fullArray.length - 1]);

    // 4. Append more items to the existing array
    const additionalItems = Array.from({ length: 8 }, (_, i) => ({
      id: i + initialArray.length,
      name: `Additional Item ${i}`,
      timestamp: new Date().toISOString(),
    }));

    console.log(`Appending ${additionalItems.length} items...`);
    await db.saveArray(key, additionalItems, 3); // Different batch size to test warning

    // 5. Get updated metadata
    const updatedMetadata = await db.get(metaKey);
    console.log('Updated array metadata:', updatedMetadata);

    // 6. Retrieve a range of items
    const rangeItems = await db.getArrayRange(key, 0, 1);
    console.log(`Retrieved ${rangeItems.length} items from range 10-20:`);
    console.log(rangeItems);

    // 7. Retrieve recent items
    const recentItems = await db.getRecentArray(key, 3);
    console.log('Retrieved 6 most recent items:');
    console.log(recentItems);

    // 8. Verify total count and batch distribution
    const allItems = await db.getAllArray(key);
    console.log(`Total items after append: ${allItems.length}`);
    console.log(
      `Expected total: ${initialArray.length + additionalItems.length}`,
    );

    // 9. Check individual batches
    for (let i = 0; i < updatedMetadata.batchCount; i++) {
      const batchKey = `${key}_${i}`;
      const batch = await db.get(batchKey);
      console.log(`Batch ${i}: ${batch.length} items`);
    }
  } catch (error) {
    console.error('Error during test:', error);
  } finally {
    // Clean up
    await db.close();
    console.log('Test completed and connection closed.');
  }
}

// Run the test
testSaveArray().catch(console.error);
