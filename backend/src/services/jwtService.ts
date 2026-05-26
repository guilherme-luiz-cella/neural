import { SignJWT, jwtVerify } from 'jose';
import { JwtPayload, AuthTokens } from '../types';

const secret = (jwtSecret: string) => new TextEncoder().encode(jwtSecret);

export const generateAccessToken = (userId: string, email: string, jwtSecret: string): Promise<string> =>
  new SignJWT({ userId, email, type: 'access' } as JwtPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret(jwtSecret));

export const generateRefreshToken = (userId: string, email: string, jwtSecret: string): Promise<string> =>
  new SignJWT({ userId, email, type: 'refresh' } as JwtPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret(jwtSecret));

export const generateTokenPair = async (
  userId: string,
  email: string,
  jwtSecret: string
): Promise<AuthTokens> => ({
  access_token: await generateAccessToken(userId, email, jwtSecret),
  refresh_token: await generateRefreshToken(userId, email, jwtSecret),
});

export const verifyToken = async (token: string, jwtSecret: string): Promise<JwtPayload> => {
  const { payload } = await jwtVerify(token, secret(jwtSecret), { algorithms: ['HS256'] });
  return payload as unknown as JwtPayload;
};
