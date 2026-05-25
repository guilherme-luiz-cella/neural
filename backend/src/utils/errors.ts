export class AppError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) { super(400, message); }
}

export class AuthenticationError extends AppError {
  constructor(message: string) { super(401, message); }
}

export class ConflictError extends AppError {
  constructor(message: string) { super(409, message); }
}

export class NotFoundError extends AppError {
  constructor(message: string) { super(404, message); }
}
