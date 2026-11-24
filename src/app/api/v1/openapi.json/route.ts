export function GET(request: Request): Response {
  const origin = new URL(request.url).origin;
  return Response.json({
    openapi: "3.1.0",
    info: { title: "Personal Management Dashboard API", version: "1.0.0" },
    servers: [{ url: `${origin}/api/v1` }],
    paths: {
      "/health": {
        get: { summary: "Health snapshot", responses: { "200": { description: "OK" } } },
      },
      "/profile": {
        get: { summary: "Current profile", responses: { "200": { description: "Profile" } } },
        patch: {
          summary: "Update current profile",
          responses: { "200": { description: "Updated" } },
        },
      },
      "/profile/image": {
        post: { summary: "Upload profile image", responses: { "201": { description: "Created" } } },
      },
      "/users": {
        get: { summary: "List users", responses: { "200": { description: "Users" } } },
        post: { summary: "Create user", responses: { "201": { description: "Created" } } },
      },
      "/users/{userId}": {
        patch: {
          summary: "Change role or activation",
          responses: { "200": { description: "Updated" } },
        },
      },
      "/users/{userId}/sessions": {
        delete: {
          summary: "Revoke user sessions",
          responses: { "200": { description: "Revoked" } },
        },
      },
      "/users/{userId}/password": {
        post: { summary: "Reset user password", responses: { "200": { description: "Reset" } } },
      },
      "/roles": { get: { summary: "Role matrix", responses: { "200": { description: "Roles" } } } },
      "/admin/status": {
        get: {
          summary: "Administration readiness",
          responses: { "200": { description: "Status" } },
        },
      },
    },
    components: {
      securitySchemes: {
        sessionCookie: { type: "apiKey", in: "cookie", name: "pmd.session_token" },
      },
    },
    security: [{ sessionCookie: [] }],
  });
}
