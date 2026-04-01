import { SourceOGError, SOURCEOG_ERROR_CODES } from "./errors.js";

export class RedirectInterrupt extends SourceOGError {
  public readonly location: string;

  public readonly status: number;

  public constructor(location: string, status = 302) {
    super(SOURCEOG_ERROR_CODES.REDIRECT_INTERRUPT, `Redirect to ${location}.`, {
      location,
      status
    });
    this.location = location;
    this.status = status;
  }
}

export class NotFoundInterrupt extends SourceOGError {
  public constructor() {
    super(SOURCEOG_ERROR_CODES.NOT_FOUND_INTERRUPT, "Not found interrupt triggered.");
  }
}

export function redirectTo(location: string, status = 302): never {
  throw new RedirectInterrupt(location, status);
}

export function notFound(): never {
  throw new NotFoundInterrupt();
}

export function isRedirectInterrupt(error: unknown): error is RedirectInterrupt {
  return error instanceof RedirectInterrupt;
}

export function isNotFoundInterrupt(error: unknown): error is NotFoundInterrupt {
  return error instanceof NotFoundInterrupt;
}
