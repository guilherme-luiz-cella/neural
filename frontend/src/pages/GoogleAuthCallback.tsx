import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import * as authUtils from '../utils/auth';

export const GoogleAuthCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loadUser } = useAuth();

  useEffect(() => {
    const accessToken = searchParams.get('access_token');
    const refreshToken = searchParams.get('refresh_token');
    const error = searchParams.get('google_error');

    if (error || !accessToken || !refreshToken) {
      navigate('/login?google_error=true', { replace: true });
      return;
    }

    authUtils.setTokens(accessToken, refreshToken);
    loadUser().then(() => navigate('/dashboard', { replace: true }));
  }, [searchParams, navigate, loadUser]);

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-400 text-sm">Signing in with Google…</p>
    </div>
  );
};
