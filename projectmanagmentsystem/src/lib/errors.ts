export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (m: string) => new ApiError(400, m);
export const unauthorized = (m = 'Please log in to continue') => new ApiError(401, m);
export const forbidden = (m = 'You do not have permission to do that') => new ApiError(403, m);
export const notFound = (m = 'Not found') => new ApiError(404, m);
export const conflict = (m: string) => new ApiError(409, m);
