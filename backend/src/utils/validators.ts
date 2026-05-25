export const validateEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

export const validatePassword = (password: string): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  if (password.length < 8) errors.push('Password must be at least 8 characters');
  if (!/[A-Z]/.test(password)) errors.push('Password must contain at least one uppercase letter');
  if (!/[0-9]/.test(password)) errors.push('Password must contain at least one number');
  return { valid: errors.length === 0, errors };
};

export const validateUsername = (username: string): boolean => {
  return (
    username.length >= 3 &&
    username.length <= 255 &&
    /^[a-zA-Z0-9_-]+$/.test(username)
  );
};
