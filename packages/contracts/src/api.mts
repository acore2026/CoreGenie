export interface ApiErrorResult {
  success: false;
  error?: string | null;
}

export type SaveResult<T = object> = ({ success: true } & T) | ApiErrorResult;
