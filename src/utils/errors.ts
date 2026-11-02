export class SiloError extends Error {
  readonly code: string;

  constructor(message: string, code = "SILO_ERROR", options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export function assertUnreachable(value: never): never {
  throw new SiloError(`Unhandled case: ${String(value)}`);
}
