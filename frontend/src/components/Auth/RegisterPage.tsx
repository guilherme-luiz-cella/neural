import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../utils/api';
import { AxiosError } from 'axios';
import { AuthShell } from './AuthShell';

const getPasswordStrength = (password: string) => {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  const meta = [
    { label: '', color: 'bg-gray-700' },
    { label: 'Weak', color: 'bg-red-500' },
    { label: 'Fair', color: 'bg-yellow-500' },
    { label: 'Good', color: 'bg-blue-500' },
    { label: 'Strong', color: 'bg-green-500' },
  ][score];

  return { score, ...meta };
};

export const RegisterPage = () => {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      const res = await api.get('/auth/google');
      window.location.href = res.data.data.url;
    } catch {
      setError('Failed to start Google sign-in.');
      setGoogleLoading(false);
    }
  };

  const strength = getPasswordStrength(password);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await register(email, username, password);
      navigate('/login', { state: { message: 'Account created. Sign in.' } });
    } catch (err) {
      const axiosErr = err as AxiosError<{ message: string }>;
      setError(axiosErr.response?.data?.message ?? 'Registration failed. Try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Create workspace"
      title="Create account"
      subtitle="Start with email and password, or use Google to create your account faster."
      footer={(
        <>
          Have an account?{' '}
          <Link to="/login" className="text-blue-400 hover:text-blue-300 transition-colors">
            Sign in
          </Link>
        </>
      )}
    >
        {error && (
          <div className="mb-4 border border-red-700 bg-red-900/40 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-700 bg-gray-800 px-3 py-2.5 text-white placeholder-gray-500 outline-none transition-colors focus:border-blue-500"
              placeholder="you@example.com"
              required
              name="email"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full border border-gray-700 bg-gray-800 px-3 py-2.5 text-white placeholder-gray-500 outline-none transition-colors focus:border-blue-500"
              placeholder="your_username"
              required
              name="username"
              autoComplete="username"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-700 bg-gray-800 px-3 py-2.5 text-white placeholder-gray-500 outline-none transition-colors focus:border-blue-500"
              placeholder="••••••••"
              required
              name="new-password"
              autoComplete="new-password"
            />
            {password && (
              <div className="mt-2 space-y-1">
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        i <= strength.score ? strength.color : 'bg-gray-700'
                      }`}
                    />
                  ))}
                </div>
                {strength.label && (
                  <p className="text-xs text-gray-500">{strength.label}</p>
                )}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-800"
          >
            {isLoading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-800" />
          <span className="text-xs text-gray-600">or</span>
          <div className="flex-1 h-px bg-gray-800" />
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={googleLoading}
          className="mt-4 flex w-full items-center justify-center gap-2 bg-white px-4 py-2.5 font-medium text-gray-900 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {googleLoading ? 'Redirecting…' : 'Continue with Google'}
        </button>
    </AuthShell>
  );
};
