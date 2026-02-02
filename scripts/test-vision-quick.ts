import { VisionModelFactory } from '../src/image-processor/VisionModelFactory.js';

async function test() {
  console.log('Testing Ollama vision model...');
  
  const provider = VisionModelFactory.createDefault();
  console.log('Model info:', provider.getModelInfo());
  
  const health = await provider.healthCheck();
  console.log('Health check:', health);
  
  if (!health) {
    console.error('Ollama is not healthy');
    return;
  }
  
  const imagePath = './instances/posters/SourceImages/10000bc.JPG';
  console.log(`Testing with image: ${imagePath}`);
  
  try {
    const result = await provider.extractFromImage(imagePath, 'Describe this image briefly.');
    console.log('SUCCESS!');
    console.log('Response:', result.extracted_text.substring(0, 300));
  } catch (error) {
    console.error('EXTRACTION ERROR:', error);
  }
}

test().catch(console.error);
