import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";

const reply = (response, status, text) =>
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" }).end(text);

/** Google sign-in in the person's own browser: PKCE and a one-shot loopback redirect, as Google asks of
 *  desktop apps. `finish` gets the signed-in client; what it throws is what the browser tab shows. */
export async function googleConsent({ clientId, clientSecret }, scopes, finish) {
  if (!clientId || !clientSecret) throw new Error("Bees could not get Google sign-in from its server");
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  setTimeout(() => server.close(), 5 * 60_000).unref();
  const client = new OAuth2Client(clientId, clientSecret, `http://127.0.0.1:${server.address().port}`);
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state = randomBytes(24).toString("hex");
  server.on("request", (request, response) => {
    const params = new URL(request.url ?? "/", "http://127.0.0.1").searchParams;
    const offered = Buffer.from(params.get("state") ?? "");
    // a favicon or a second tab must not use up the one real callback
    if (!server.listening || offered.length !== state.length || !timingSafeEqual(offered, Buffer.from(state)))
      return void response.writeHead(404).end();
    server.close();
    const code = params.get("code");
    (code ? client.getToken({ code, codeVerifier }) : Promise.reject(new Error("Google access was not granted.")))
      .then(({ tokens }) => {
        // Google lets a person untick a scope, and that sign-in would fail on every call
        if (!scopes.every((scope) => tokens.scope?.split(" ").includes(scope)))
          throw new Error("Google did not grant everything Bees asked for. Try again and leave every box ticked.");
        client.setCredentials(tokens);
        return finish(client);
      })
      .then(() => reply(response, 200, "Connected. You can close this tab and go back to Bees."),
        (error) => reply(response, 400, String(error?.message ?? error)));
  });
  return {
    url: client.generateAuthUrl({
      access_type: "offline", prompt: "consent select_account", scope: scopes, state,
      code_challenge: codeChallenge, code_challenge_method: CodeChallengeMethod.S256
    }),
    close: () => server.close()
  };
}
