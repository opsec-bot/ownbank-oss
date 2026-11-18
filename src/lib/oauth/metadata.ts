import { ALL_SCOPES, appUrl, resourceUrl } from "./config";

// RFC 9728: tells a client which authorization server protects /api/mcp.
export function protectedResourceMetadata() {
  return {
    resource: resourceUrl(),
    authorization_servers: [appUrl()],
    bearer_methods_supported: ["header"],
    scopes_supported: [...ALL_SCOPES],
  };
}

// RFC 8414. No OIDC document on purpose.
export function authorizationServerMetadata() {
  const base = appUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...ALL_SCOPES],
  };
}
