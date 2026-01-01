import { google } from "googleapis";
import { readFileSync, writeFileSync } from "fs";
import * as readline from "readline";

const SCOPES = ["https://www.googleapis.com/auth/tasks"];

async function main() {
  const credsPath = process.argv[2] || "gcp-oauth.keys.json";
  const tokenPath = process.argv[3] || ".gtasks-token.json";

  console.log(`Reading credentials from: ${credsPath}`);
  const credentials = JSON.parse(readFileSync(credsPath, "utf-8"));
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });

  console.log("\n========================================");
  console.log("Authorize this app by visiting this URL:");
  console.log("========================================\n");
  console.log(authUrl);
  console.log("\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question("Enter the authorization code from the page: ", async (code) => {
    rl.close();
    try {
      const { tokens } = await oauth2Client.getToken(code);
      writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
      console.log(`\n✓ Token saved to: ${tokenPath}`);
      console.log("\nYou can now enable the gtasks plugin in your config.");
    } catch (err) {
      console.error("Error retrieving token:", err);
      process.exit(1);
    }
  });
}

main().catch(console.error);
