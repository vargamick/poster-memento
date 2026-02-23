import type { ReactNode } from 'react';
import { TabBar } from './TabBar';
import { useAuth } from '../../hooks/useAuth';
import { useInstanceConfig } from '../../hooks/useInstanceConfig';

interface AppShellProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: ReactNode;
}

export function AppShell({ activeTab, onTabChange, children }: AppShellProps) {
  const { logout } = useAuth();
  const { config } = useInstanceConfig();

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{config?.title || 'Admin'}</h1>
        <button
          onClick={logout}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Logout
        </button>
      </div>

      <TabBar activeTab={activeTab} onTabChange={onTabChange} />

      {children}
    </div>
  );
}
