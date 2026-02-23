import { createContext, useContext, useState, useEffect, createElement, type ReactNode } from 'react';
import { adminApi } from '../api/client';

export interface UITabConfig {
  id: string;
  label: string;
  enabled: boolean;
}

export interface InstanceUIConfig {
  instanceName: string;
  title: string;
  useCase: string;
  modelType: 'chat' | 'vision';
  tabs: UITabConfig[];
  entityTypes: string[];
  features: {
    queryLogs?: boolean;
    questionRunner?: boolean;
    scraper?: boolean;
  };
  supportedModels: Array<{
    id: string;
    name: string;
    provider: string;
    input: number;
    output: number;
  }>;
}

interface InstanceConfigContextValue {
  config: InstanceUIConfig | null;
  loading: boolean;
  error: string | null;
}

const InstanceConfigContext = createContext<InstanceConfigContextValue>({
  config: null,
  loading: true,
  error: null,
});

export function InstanceConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<InstanceUIConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi<{ data: InstanceUIConfig }>('/ui-config')
      .then(res => setConfig(res.data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return createElement(
    InstanceConfigContext.Provider,
    { value: { config, loading, error } },
    children
  );
}

export function useInstanceConfig(): InstanceConfigContextValue {
  return useContext(InstanceConfigContext);
}
