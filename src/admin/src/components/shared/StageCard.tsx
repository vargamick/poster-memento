import { useState, type ReactNode } from 'react';

interface StageCardProps {
  title: string;
  description: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function StageCard({ title, description, children, defaultOpen }: StageCardProps) {
  const [open, setOpen] = useState(defaultOpen || false);
  return (
    <div className="bg-white rounded-lg shadow mb-4">
      <button onClick={() => setOpen(!open)} className="w-full flex justify-between items-center p-4 text-left hover:bg-gray-50">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-sm text-gray-500">{description}</p>
        </div>
        <span className="text-gray-400 text-xl">{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && <div className="px-4 pb-4 border-t">{children}</div>}
    </div>
  );
}
