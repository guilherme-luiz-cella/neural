import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/authService';

export const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password, username } = req.body;
    const { user } = await authService.registerUser({ email, password, username });
    res.status(201).json({ success: true, message: 'User registered successfully', data: { user } });
  } catch (err) {
    next(err);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body;
    const { user, tokens } = await authService.loginUser({ email, password });
    res.status(200).json({ success: true, message: 'Login successful', data: { ...tokens, user } });
  } catch (err) {
    next(err);
  }
};

export const refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      res.status(400).json({ success: false, message: 'refresh_token is required' });
      return;
    }
    const result = await authService.refreshAccessToken(refresh_token);
    res.status(200).json({ success: true, message: 'Token refreshed', data: result });
  } catch (err) {
    next(err);
  }
};

export const me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await authService.getUserById(req.user!.userId);
    res.status(200).json({ success: true, message: 'User data retrieved', data: { user } });
  } catch (err) {
    next(err);
  }
};

export const logout = (_req: Request, res: Response): void => {
  // Stateless JWT — client discards tokens. Future: implement server-side token blacklist.
  res.status(200).json({ success: true, message: 'Logged out successfully' });
};
