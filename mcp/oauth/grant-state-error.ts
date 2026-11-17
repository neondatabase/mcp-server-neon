export class GrantStateUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('OAuth grant state is temporarily unavailable', options);
    this.name = 'GrantStateUnavailableError';
  }
}
