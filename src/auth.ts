import { Router } from "express";
import crypto from "crypto";

const router = Router();

// In-memory stores (fine for single instance)
const authCodes = new Map<string, { expires: number }>();
const accessTokens = new Map<string, { expires: number }>();

const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "changeme";
const CLIENT_SECRET = process.env.CLIENT_SECRET || "mcp-secret";

// OAuth discovery endpoint - ChatGPT looks for this
router.get("/.well-known/oauth-authorization-server", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
  });
});

// Also support the OpenID Connect discovery path
router.get("/.well-known/openid-configuration", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
  });
});

// Clean expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of authCodes) {
    if (data.expires < now) authCodes.delete(code);
  }
  for (const [token, data] of accessTokens) {
    if (data.expires < now) accessTokens.delete(token);
  }
}, 60000);

// GET /authorize - Show login form
router.get("/authorize", (req, res) => {
  const { redirect_uri, state, client_id } = req.query;

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>MCP Server Login</title>
      <style>
        * { box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0;
        }
        .container {
          background: rgba(255,255,255,0.05);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 16px;
          padding: 40px;
          width: 100%;
          max-width: 400px;
        }
        h1 {
          color: #fff;
          margin: 0 0 8px 0;
          font-size: 24px;
        }
        p {
          color: rgba(255,255,255,0.6);
          margin: 0 0 24px 0;
          font-size: 14px;
        }
        input {
          width: 100%;
          padding: 12px 16px;
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 8px;
          background: rgba(255,255,255,0.05);
          color: #fff;
          font-size: 16px;
          margin-bottom: 16px;
        }
        input:focus {
          outline: none;
          border-color: #6366f1;
        }
        button {
          width: 100%;
          padding: 12px 16px;
          border: none;
          border-radius: 8px;
          background: #6366f1;
          color: #fff;
          font-size: 16px;
          cursor: pointer;
          transition: background 0.2s;
        }
        button:hover {
          background: #4f46e5;
        }
        .error {
          color: #f87171;
          margin-bottom: 16px;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔐 MCP Server</h1>
        <p>Enter your password to authorize access</p>
        <form method="POST" action="/authorize">
          <input type="password" name="password" placeholder="Password" required autofocus>
          <input type="hidden" name="redirect_uri" value="${redirect_uri || ""}">
          <input type="hidden" name="state" value="${state || ""}">
          <input type="hidden" name="client_id" value="${client_id || ""}">
          <button type="submit">Authorize</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

// POST /authorize - Validate password, redirect with code
router.post("/authorize", (req, res) => {
  const { password, redirect_uri, state } = req.body;

  if (password !== AUTH_PASSWORD) {
    return res.status(401).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Error</title></head>
      <body style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h1>❌ Wrong password</h1>
        <p><a href="javascript:history.back()">Try again</a></p>
      </body>
      </html>
    `);
  }

  // Generate auth code
  const code = crypto.randomUUID();
  authCodes.set(code, { expires: Date.now() + 60000 }); // 1 minute expiry

  // Redirect back to ChatGPT
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (state) redirectUrl.searchParams.set("state", state);

  res.redirect(redirectUrl.toString());
});

// POST /token - Exchange code for access token
router.post("/token", (req, res) => {
  const { code, client_secret, grant_type } = req.body;

  // Validate client secret
  if (client_secret !== CLIENT_SECRET) {
    return res.status(401).json({ error: "invalid_client" });
  }

  // Validate auth code
  const codeData = authCodes.get(code);
  if (!codeData || codeData.expires < Date.now()) {
    authCodes.delete(code);
    return res.status(400).json({ error: "invalid_grant" });
  }

  // Delete used code
  authCodes.delete(code);

  // Generate access token
  const accessToken = crypto.randomUUID();
  accessTokens.set(accessToken, { expires: Date.now() + 30 * 24 * 60 * 60 * 1000 }); // 30 days

  res.json({
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 30 * 24 * 60 * 60,
  });
});

// Middleware to validate access token
export function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing authorization header" });
  }

  const token = authHeader.replace("Bearer ", "");
  const tokenData = accessTokens.get(token);

  if (!tokenData || tokenData.expires < Date.now()) {
    accessTokens.delete(token);
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  next();
}

export default router;

