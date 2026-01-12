/**
 * Forja API Interface
 *
 * API package implements this interface.
 * Using generic type to avoid circular dependency between packages.
 */
export interface IForjaApi<TForja = unknown> {
  /**
   * Handle HTTP request
   *
   * This is the main entry point for all API requests.
   * Handles authentication, permissions, and routing.
   *
   * @param request - Web API Request object
   * @param forja - Forja instance
   * @returns Web API Response object
   */
  handleRequest(request: Request, forja: TForja): Promise<Response>;

  /**
   * Initialize API
   *
   * Called automatically on first request.
   * Handles lifecycle setup (user schema injection, auth manager initialization).
   *
   * @param forja - Forja instance
   */
  init(forja: TForja): Promise<void>;

  /**
   * Check if API is enabled
   *
   * @returns true if api.enabled is true (default: true)
   */
  isEnabled(): boolean;

  /**
   * Check if authentication is enabled
   *
   * @returns true if api.auth.enabled is true
   */
  isAuthEnabled(): boolean;
}
