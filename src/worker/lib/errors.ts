/** クライアントへ返すエラー。メッセージに秘密情報・内部情報を含めない */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
