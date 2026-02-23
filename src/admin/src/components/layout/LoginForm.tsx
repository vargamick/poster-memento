import { useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';

export function LoginForm() {
  const { setApiKey } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const value = inputRef.current?.value;
    if (value) setApiKey(value);
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-white rounded-lg shadow p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold mb-4">Ask Agar Admin</h1>
        <p className="text-gray-600 mb-4">Enter your API key to continue:</p>
        <input
          ref={inputRef}
          type="password"
          className="w-full border rounded px-3 py-2 mb-4"
          placeholder="API Key"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
          }}
        />
        <button
          onClick={handleSubmit}
          className="w-full bg-blue-500 text-white rounded py-2 hover:bg-blue-600"
        >
          Login
        </button>
      </div>
    </div>
  );
}
