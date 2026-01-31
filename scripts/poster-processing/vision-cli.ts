#!/usr/bin/env tsx
/**
 * Vision Model CLI - Manage and compare vision models
 */

import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';

import { VisionModelFactory } from '../../src/image-processor/VisionModelFactory.js';
import { VisionModelProvider } from '../../src/image-processor/types.js';

/**
 * List all available vision models
 */
async function listModels() {
  console.log('='.repeat(60));
  console.log('Available Vision Models');
  console.log('='.repeat(60));

  const config = VisionModelFactory.loadConfig();
  const defaultModel = VisionModelFactory.getDefaultModelKey();

  console.log(`\nDefault Model: ${defaultModel}`);
  console.log(`Environment Override: ${process.env.VISION_MODEL || '(none)'}\n`);

  console.log('Models:');
  console.log('-'.repeat(60));

  for (const [key, modelConfig] of Object.entries(config.models)) {
    const isDefault = key === defaultModel;
    const marker = isDefault ? '→' : ' ';
    console.log(`${marker} ${key}`);
    console.log(`     Provider: ${modelConfig.provider}`);
    console.log(`     Model: ${modelConfig.model}`);
    console.log(`     Parameters: ${modelConfig.parameters || 'unknown'}`);
    console.log(`     Description: ${modelConfig.description || '-'}`);
    console.log('');
  }

  // Check which models are actually available
  console.log('Availability Status:');
  console.log('-'.repeat(60));

  for (const key of Object.keys(config.models)) {
    try {
      const provider = VisionModelFactory.createByName(key);
      const isHealthy = await provider.healthCheck();
      const status = isHealthy ? '✓ Available' : '✗ Not Available';
      console.log(`  ${key}: ${status}`);
    } catch (error) {
      console.log(`  ${key}: ✗ Error - ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Switch to a different vision model
 */
async function switchModel(modelKey: string) {
  console.log('='.repeat(60));
  console.log('Switch Vision Model');
  console.log('='.repeat(60));

  const availableModels = VisionModelFactory.listAvailableModels();

  if (!availableModels.includes(modelKey)) {
    console.error(`\nError: Model "${modelKey}" not found.`);
    console.log(`\nAvailable models: ${availableModels.join(', ')}`);
    process.exit(1);
  }

  const modelConfig = VisionModelFactory.getModelConfig(modelKey);

  console.log(`\nSwitching to: ${modelKey}`);
  console.log(`Provider: ${modelConfig?.provider}`);
  console.log(`Model: ${modelConfig?.model}`);

  // Test the model
  try {
    const provider = VisionModelFactory.createByName(modelKey);
    const isHealthy = await provider.healthCheck();

    if (isHealthy) {
      console.log('\n✓ Model is available and responding');
      console.log('\nTo use this model, set the environment variable:');
      console.log(`  export VISION_MODEL=${modelKey}`);
      console.log('\nOr add to your .env file:');
      console.log(`  VISION_MODEL=${modelKey}`);
    } else {
      console.log('\n✗ Model is not available');
      console.log('Make sure the inference service is running.');
    }
  } catch (error) {
    console.error('\n✗ Error testing model:', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Test extraction on a single image
 */
async function testExtraction(imagePath: string, modelKey?: string) {
  console.log('='.repeat(60));
  console.log('Test Vision Extraction');
  console.log('='.repeat(60));

  if (!fs.existsSync(imagePath)) {
    console.error(`\nError: File not found: ${imagePath}`);
    process.exit(1);
  }

  const model = modelKey || VisionModelFactory.getDefaultModelKey();
  console.log(`\nImage: ${path.basename(imagePath)}`);
  console.log(`Model: ${model}`);

  try {
    const provider = VisionModelFactory.createByName(model);
    console.log(`\nExtracting text...`);

    const startTime = Date.now();
    const result = await provider.extractFromImage(imagePath);
    const elapsed = Date.now() - startTime;

    console.log(`\nExtraction Complete (${elapsed}ms)`);
    console.log('-'.repeat(60));

    console.log('\nExtracted Text:');
    console.log(result.extracted_text.slice(0, 1000));
    if (result.extracted_text.length > 1000) {
      console.log(`\n... (${result.extracted_text.length - 1000} more characters)`);
    }

    if (result.structured_data) {
      console.log('\nStructured Data:');
      console.log(JSON.stringify(result.structured_data, null, 2));
    }

    console.log('\nMetadata:');
    console.log(`  Model: ${result.model}`);
    console.log(`  Provider: ${result.provider}`);
    console.log(`  Processing Time: ${result.processing_time_ms}ms`);
  } catch (error) {
    console.error('\n✗ Extraction failed:', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Compare multiple models on the same image
 */
async function compareModels(imagePath: string, modelKeys?: string[]) {
  console.log('='.repeat(70));
  console.log('Model Comparison');
  console.log('='.repeat(70));

  if (!fs.existsSync(imagePath)) {
    console.error(`\nError: File not found: ${imagePath}`);
    process.exit(1);
  }

  const modelsToCompare = modelKeys && modelKeys.length > 0
    ? modelKeys
    : VisionModelFactory.listAvailableModels();

  console.log(`\nImage: ${path.basename(imagePath)}`);
  console.log(`Comparing ${modelsToCompare.length} models...\n`);

  const results: Array<{
    model: string;
    available: boolean;
    time?: number;
    headliner?: string;
    venue?: string;
    error?: string;
  }> = [];

  for (const modelKey of modelsToCompare) {
    process.stdout.write(`  Testing ${modelKey}... `);

    try {
      const provider = VisionModelFactory.createByName(modelKey);
      const isHealthy = await provider.healthCheck();

      if (!isHealthy) {
        console.log('Not available');
        results.push({ model: modelKey, available: false });
        continue;
      }

      const startTime = Date.now();
      const result = await provider.extractFromImage(imagePath);
      const elapsed = Date.now() - startTime;

      console.log(`Done (${elapsed}ms)`);

      results.push({
        model: modelKey,
        available: true,
        time: elapsed,
        headliner: result.structured_data?.headliner,
        venue: result.structured_data?.venue
      });
    } catch (error) {
      console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
      results.push({
        model: modelKey,
        available: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Print comparison table
  console.log('\n' + '='.repeat(70));
  console.log('Comparison Results');
  console.log('='.repeat(70));

  console.log('\n┌' + '─'.repeat(25) + '┬' + '─'.repeat(10) + '┬' + '─'.repeat(30) + '┐');
  console.log('│ ' + 'Model'.padEnd(23) + ' │ ' + 'Time'.padEnd(8) + ' │ ' + 'Headliner'.padEnd(28) + ' │');
  console.log('├' + '─'.repeat(25) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(30) + '┤');

  for (const r of results) {
    const time = r.time ? `${r.time}ms` : (r.available ? 'N/A' : 'Unavail');
    const headliner = r.headliner?.slice(0, 26) || (r.error ? 'Error' : '-');
    console.log(
      '│ ' + r.model.slice(0, 23).padEnd(23) + ' │ ' +
      time.padStart(8) + ' │ ' +
      headliner.padEnd(28) + ' │'
    );
  }

  console.log('└' + '─'.repeat(25) + '┴' + '─'.repeat(10) + '┴' + '─'.repeat(30) + '┘');

  // Save detailed results
  const outputFile = `./comparison-${Date.now()}.json`;
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  console.log(`\nDetailed results saved to: ${outputFile}`);
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'models':
    case 'list':
      await listModels();
      break;

    case 'use':
    case 'switch':
      if (!args[1]) {
        console.error('Usage: vision-cli use <model-key>');
        console.log('Run "vision-cli models" to see available models');
        process.exit(1);
      }
      await switchModel(args[1]);
      break;

    case 'test':
      if (!args[1]) {
        console.error('Usage: vision-cli test <image-path> [model-key]');
        process.exit(1);
      }
      await testExtraction(args[1], args[2]);
      break;

    case 'compare':
      if (!args[1]) {
        console.error('Usage: vision-cli compare <image-path> [model1,model2,...]');
        process.exit(1);
      }
      const models = args[2] ? args[2].split(',') : undefined;
      await compareModels(args[1], models);
      break;

    default:
      console.log('Vision Model CLI');
      console.log('');
      console.log('Usage:');
      console.log('  vision-cli models                    List available models');
      console.log('  vision-cli use <model-key>           Switch to a different model');
      console.log('  vision-cli test <image> [model]      Test extraction on an image');
      console.log('  vision-cli compare <image> [models]  Compare models on an image');
      console.log('');
      console.log('Examples:');
      console.log('  vision-cli models');
      console.log('  vision-cli use llama-vision-ollama');
      console.log('  vision-cli test ./poster.jpg');
      console.log('  vision-cli test ./poster.jpg minicpm-v-ollama');
      console.log('  vision-cli compare ./poster.jpg');
      console.log('  vision-cli compare ./poster.jpg minicpm-v-ollama,llama-vision-ollama');
  }
}

main().catch(console.error);
