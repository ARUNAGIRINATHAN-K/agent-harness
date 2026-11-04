export class HarnessError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options); this.name = "HarnessError";
  }
}
