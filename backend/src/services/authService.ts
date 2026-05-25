import { SupabaseClient } from '@supabase/supabase-js';
import { User, AuthTokens } from '../types';
import { hashPassword, verifyPassword } from '../utils/crypto';
import { generateTokenPair, generateAccessToken, verifyToken } from './jwtService';
import { validateEmail, validatePassword, validateUsername } from '../utils/validators';
import { ValidationError, AuthenticationError, ConflictError, NotFoundError } from '../utils/errors';

interface RegisterInput { email: string; password: string; username: string; }
interface LoginInput { email: string; password: string; }

export const registerUser = async (
  supabase: SupabaseClient,
  jwtSecret: string,
  input: RegisterInput
): Promise<{ user: User }> => {
  const { email, password, username } = input;

  if (!validateEmail(email)) throw new ValidationError('Invalid email format');

  const pwCheck = validatePassword(password);
  if (!pwCheck.valid) throw new ValidationError(pwCheck.errors.join(', '));

  if (!validateUsername(username)) {
    throw new ValidationError('Username must be 3-255 characters: letters, numbers, underscores, hyphens');
  }

  const [{ data: byEmail }, { data: byUsername }] = await Promise.all([
    supabase.from('users').select('id').eq('email', email).maybeSingle(),
    supabase.from('users').select('id').eq('username', username).maybeSingle(),
  ]);

  if (byEmail || byUsername) throw new ConflictError('Email or username already in use');

  const password_hash = await hashPassword(password);

  const { data: user, error } = await supabase
    .from('users')
    .insert({ email, password_hash, username })
    .select('id, email, username, created_at, updated_at')
    .single();

  if (error || !user) throw new Error(error?.message ?? 'Failed to create user');

  return { user: user as User };
};

export const loginUser = async (
  supabase: SupabaseClient,
  jwtSecret: string,
  input: LoginInput
): Promise<{ user: User; tokens: AuthTokens }> => {
  const { email, password } = input;

  const { data } = await supabase
    .from('users')
    .select('id, email, username, password_hash, created_at, updated_at')
    .eq('email', email)
    .maybeSingle();

  if (!data) throw new AuthenticationError('Invalid credentials');

  const valid = await verifyPassword(password, data.password_hash);
  if (!valid) throw new AuthenticationError('Invalid credentials');

  const { password_hash: _omit, ...user } = data;
  const tokens = await generateTokenPair(user.id, user.email, jwtSecret);

  return { user: user as User, tokens };
};

export const refreshAccessToken = async (
  supabase: SupabaseClient,
  jwtSecret: string,
  refreshToken: string
): Promise<{ access_token: string }> => {
  const payload = await verifyToken(refreshToken, jwtSecret);
  if (payload.type !== 'refresh') throw new AuthenticationError('Invalid token type');

  const { data } = await supabase
    .from('users')
    .select('id, email')
    .eq('id', payload.userId)
    .maybeSingle();

  if (!data) throw new NotFoundError('User not found');

  const access_token = await generateAccessToken(data.id, data.email, jwtSecret);
  return { access_token };
};

export const getUserById = async (supabase: SupabaseClient, userId: string): Promise<User> => {
  const { data } = await supabase
    .from('users')
    .select('id, email, username, created_at, updated_at')
    .eq('id', userId)
    .maybeSingle();

  if (!data) throw new NotFoundError('User not found');
  return data as User;
};
