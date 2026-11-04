export class SiloError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(message: string, code = "SILO_ERROR", options?: ErrorOptions & { details?: Readonly<Record<string, unknown>> }) {
    super(message, options);
    this.code = code;
    this.details = options?.details ?? {};
  }
}

export function assertUnreachable(value: never): never {
  throw new SiloError(`Unhandled case: ${String(value)}`);
}
