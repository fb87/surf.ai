export class ProviderApiError extends Error {
  constructor(message, kind, status) {
    super(message);
    this.name = "ProviderApiError";
    this.kind = kind; // 'not_found' | 'rate_limited' | 'network' | 'unauthorized' | 'unknown'
    this.status = status;
  }
}
