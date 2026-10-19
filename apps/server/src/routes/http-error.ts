/** An error with an HTTP status and a machine-readable code; the app's error handler sends it as JSON. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
