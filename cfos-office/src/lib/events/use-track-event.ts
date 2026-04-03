// Stub — analytics events will be implemented in a later session
export function useTrackEvent() {
  return function trackEvent(
    _event: string,
    _categoryOrProperties?: string | Record<string, unknown>,
    _properties?: Record<string, unknown>
  ) {
    // no-op
  }
}
