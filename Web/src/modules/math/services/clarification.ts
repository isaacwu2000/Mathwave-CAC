/** Missing intent is recoverable locally and must not trigger an AI request. */
export class ClarificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClarificationError';
  }
}
