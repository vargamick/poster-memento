import { useState } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { InstanceConfigProvider, useInstanceConfig } from './hooks/useInstanceConfig';
import { AppShell } from './components/layout/AppShell';
import { LoginForm } from './components/layout/LoginForm';
import { SystemTab } from './pages/SystemTab';
import { ScraperTab } from './pages/ScraperTab';
import { ProcessingTab } from './pages/ProcessingTab';
import { QuestionRunnerTab } from './pages/QuestionRunnerTab';
import { QueryLogsTab } from './pages/QueryLogsTab';
import { SettingsTab } from './pages/SettingsTab';
import { OperationsTab } from './pages/OperationsTab';

function AdminApp() {
  const { apiKey } = useAuth();
  const { config, loading } = useInstanceConfig();

  const enabledTabIds = config?.tabs.filter(t => t.enabled).map(t => t.id) || ['system'];
  const [activeTab, setActiveTab] = useState<string>(() => {
    const hash = window.location.hash.replace('#', '');
    return hash && enabledTabIds.includes(hash) ? hash : 'system';
  });

  if (!apiKey) return <LoginForm />;
  if (loading) return <div className="flex justify-center py-12"><div className="spinner"></div></div>;

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    window.location.hash = tab === 'system' ? '' : tab;
  };

  return (
    <AppShell activeTab={activeTab} onTabChange={handleTabChange}>
      {activeTab === 'system' && <SystemTab />}
      {activeTab === 'scraper' && enabledTabIds.includes('scraper') && <ScraperTab />}
      {activeTab === 'processing' && enabledTabIds.includes('processing') && <ProcessingTab />}
      {activeTab === 'runner' && enabledTabIds.includes('runner') && <QuestionRunnerTab />}
      {activeTab === 'logs' && enabledTabIds.includes('logs') && <QueryLogsTab />}
      {activeTab === 'settings' && enabledTabIds.includes('settings') && <SettingsTab />}
      {activeTab === 'operations' && enabledTabIds.includes('operations') && <OperationsTab />}
    </AppShell>
  );
}

export function App() {
  return (
    <AuthProvider>
      <InstanceConfigProvider>
        <AdminApp />
      </InstanceConfigProvider>
    </AuthProvider>
  );
}
