export class RetryableError extends Error {
  attempts: number;
  constructor(message: string, opts: { attempts: number }) {
    super(message);
    this.name = "RetryableError";
    this.attempts = opts.attempts;
  }
}
