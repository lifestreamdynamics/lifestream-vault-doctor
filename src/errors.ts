/**
 * Base error class for the Doctor SDK.
 */
export class DoctorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DoctorError';
  }
}

/**
 * Thrown when a crash report upload fails.
 */
export class UploadError extends DoctorError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'UploadError';
    this.statusCode = statusCode;
  }
}

/**
 * Thrown when an operation requires consent that hasn't been granted.
 */
export class ConsentError extends DoctorError {
  constructor(message: string = 'Crash reporting consent has not been granted') {
    super(message);
    this.name = 'ConsentError';
  }
}
