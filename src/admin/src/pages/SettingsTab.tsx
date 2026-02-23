import { AIProviderSettings } from '@3dn/ai-provider-settings/react';
import type { ProviderSettingsApiClient } from '@3dn/ai-provider-settings/react';
import { useInstanceConfig } from '../hooks/useInstanceConfig';
import { adminApi } from '../api/client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Creates an API client that bridges poster-memento's admin API
 * to the @3dn/ai-provider-settings contract.
 */
function createAdminApiClient(): ProviderSettingsApiClient {
  return {
    getConfig: async () => {
      const result = await adminApi<any>('/model-config');
      return {
        data: {
          currentModel: result.data.currentModel,
          provider: 'ollama' as any,
          supportedModels: result.data.supportedModels || [],
          configuredProviders: ['ollama', 'openai', 'anthropic', 'google'] as any,
        },
      };
    },
    updateModel: async (model: string) => {
      const result = await adminApi<any>('/model-config', {
        method: 'PUT',
        body: JSON.stringify({ model }),
      });
      return { message: result.message };
    },
    // poster-memento doesn't have API key management
    getApiKeyStatus: async () => ({ data: {} }),
    saveApiKey: async () => ({ message: 'Not supported' }),
    removeApiKey: async () => ({ message: 'Not supported' }),
  };
}

export function SettingsTab() {
  const { config: instanceConfig } = useInstanceConfig();
  const modelType = instanceConfig?.modelType || 'chat';
  const isVision = modelType === 'vision';

  const apiClient = createAdminApiClient();

  return (
    <AIProviderSettings
      apiClient={apiClient}
      showApiKeys={false}
      showPerQueryOverride={!isVision}
      heading={isVision ? 'Vision Model' : 'LLM Model'}
      description={
        isVision
          ? 'Select the default vision model for image processing. Changes take effect immediately.'
          : 'Select the default model for all chat queries. Changes take effect immediately — no restart required.'
      }
    />
  );
}
