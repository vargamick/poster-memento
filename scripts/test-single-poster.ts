import { handleProcessPosterBatch } from '../src/server/handlers/toolHandlers/processPosterBatch.js';
import { KnowledgeGraphManager } from '../src/KnowledgeGraphManager.js';
import { initializeStorageProvider } from '../src/config/storage.js';

async function test() {
  console.log('Testing single poster processing...');
  
  const storageProvider = initializeStorageProvider();
  const knowledgeGraphManager = new KnowledgeGraphManager({ storageProvider });
  
  const result = await handleProcessPosterBatch(
    {
      sourcePath: './instances/posters/SourceImages',
      batchSize: 1,
      offset: 0,
      skipIfExists: true,
      storeImages: false
    },
    knowledgeGraphManager
  );
  
  console.log('Result:', JSON.stringify(result, null, 2));
}

test().catch(console.error);
