import * as React from "react";
import * as ReactDom from "react-dom";
import { createRoot } from "react-dom/client";
import * as primitives from "@deepseek-ai/dsh-client-ui-primitives";
import { configureRuntime, h, NativeUi } from "./runtime.js";
import { BeesApp } from "./shell.js";
import { css, Button } from "./shared.js";
import { installScrollbars } from "./scrollbars.js";
import {
  createHostedClient,
  observable,
  hostedPreferences,
  runNotifications,
  hostedConnectionDestination,
} from "./hosted-client.js";
import { HostedPage } from "./hosted-pages.js";
import gridstackCss from "gridstack/dist/gridstack.min.css";
import cronCss from "react-cron-generator/build/cron-builder.css";
import brand from "../../../src/brand-mark.png";
import "./hosted.css";

let client = createHostedClient();
configureRuntime(
  (name) =>
    ({
      react: React,
      "react-dom": ReactDom,
      "@deepseek-ai/dsh-client-ui-primitives": primitives,
    })[name],
  {
    hosted: true,
    request: (...args) => client.request(...args),
  },
);
const style = document.createElement("style");
style.textContent = gridstackCss + "\n" + cronCss + "\n" + css;
document.head.append(style);
installScrollbars(document);

function contextFor(user, client) {
  let scope = {};
  const forms = new Map(),
    sessions = observable({ ids: [], byId: {} }),
    status = observable(new Map());
  const form = (name) => {
    if (!forms.has(name)) forms.set(name, hostedPreferences(user.id, name));
    return forms.get(name);
  };
  const refresh = () => client.request("/bees-api/snapshot");
  const ctx = {
    configForms: { get: form },
    theme: {
      getTheme: () => ({
        preference: form("bees").getSnapshot().value.colorMode || "dark",
      }),
      setTheme: (mode) => {
        document.documentElement.style.colorScheme = mode;
      },
    },
    sessions: {
      list: sessions,
      refresh,
      async using(id, _options, work) {
        return work({
          binding: {
            session: {
              async prompt(parts) {
                await client.request("/api/desktop/prompt", {
                  method: "POST",
                  body: JSON.stringify({
                    executionId: id,
                    text: parts.map((p) => p.text || "").join("\n"),
                  }),
                });
                return { ok: true };
              },
            },
          },
        });
      },
    },
    uiSession: { sessionStatus: status },
    hosted: {
      initialSelection: (data) =>
        hostedConnectionDestination(location.search, data),
      user,
      request: (...args) => client.request(...args),
      setTarget: (target) => client.setTarget(target),
      async connectGoogle() {
        if (!scope.teamId) throw Error("Choose a team first");
        if (window.__TAURI_INTERNALS__)
          return window.__TAURI_INTERNALS__.invoke("fleet_open_connections", {
            organization: scope.organizationId,
            team: scope.teamId,
          });
        const popup = window.open(
          "about:blank",
          "bees-google",
          "width=600,height=740",
        );
        if (!popup)
          throw Error(
            "Allow this Bees window to open the Google sign-in popup",
          );
        try {
          const { url } = await client.request(
            `/api/fleet/${scope.teamId}/google/connect`,
            { method: "POST", body: "{}" },
          );
          popup.opener = null;
          popup.location = url;
        } catch (error) {
          popup.close();
          throw error;
        }
      },
      async notifications(enabled) {
        if (enabled && !window.__TAURI_INTERNALS__) {
          if (
            !window.Notification ||
            (await Notification.requestPermission()) !== "granted"
          )
            throw Error("Allow notifications in your browser settings first");
        }
        await form("bees").set("cloudNotifications", enabled);
      },
      selectScope(parts) {
        scope = { organizationId: parts.organizationId, teamId: parts.teamId };
        client.selectScope({
          organizationId: parts.organizationId,
          teamId: parts.teamId,
        });
        client.setTarget(
          form("bees").getSnapshot().value.executionTargets?.[parts.teamId] || {
            kind: "managed",
            fallback: "none",
          },
        );
        window.dispatchEvent(new Event("bees-scope-changed"));
      },
      renderPage: (route, props) =>
        [
          "getting-started",
          "create-organization",
          "accounts",
          "mcp",
          "skills",
        ].includes(route) || props.section === "settings"
          ? h(HostedPage, { ...props, route, ctx, refresh })
          : null,
      async pickFile(teamId) {
        const file = await new Promise((resolve) => {
          const input = document.createElement("input");
          input.type = "file";
          input.onchange = () => resolve(input.files[0] || null);
          input.oncancel = () => resolve(null);
          input.click();
        });
        if (!file) return null;
        if (file.size > 10_000_000)
          throw new Error("Files must be under 10 MB");
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const result = await client.request("/api/desktop/upload", {
          method: "POST",
          body: JSON.stringify({
            teamId,
            name: file.name,
            content: btoa(binary),
          }),
        });
        await refresh();
        window.dispatchEvent(new Event("bees-change"));
        return result;
      },
    },
  };
  let previous;
  client.subscribe((data) => {
    if (form("bees").getSnapshot().value.cloudNotifications)
      for (const message of runNotifications(previous, data)) {
        if (window.__TAURI_INTERNALS__)
          void window.__TAURI_INTERNALS__
            .invoke("fleet_notification", { message })
            .catch(console.error);
        else if (window.Notification?.permission === "granted")
          new Notification("Bees", { body: message });
      }
    previous = data;
    sessions.update({
      ids: data.runs.map((r) => r.id),
      byId: Object.fromEntries(
        data.runs.map((r) => [r.id, { id: r.id, status: r.status }]),
      ),
    });
    const states = new Map();
    for (const q of data.questions) {
      if (states.has(q.jobId)) continue;
      states.set(q.jobId, {
        pendingInteraction: {
          kind: "question",
          key: q.id,
          questions: q.questions,
          async answer(answer) {
            await client.request(
              "/api/fleet/" + q.teamId + "/jobs/" + q.jobId + "/control",
              {
                method: "POST",
                headers: { "x-organization-id": q.organizationId },
                body: JSON.stringify({
                  kind: "answer",
                  data: {
                    questionId: q.id,
                    answers: answer.answers.map((a) => ({
                      id: a.id,
                      text: [...(a.selected || []), a.custom]
                        .filter(Boolean)
                        .join("\n"),
                    })),
                  },
                }),
              },
            );
            await refresh();
          },
        },
      });
    }
    status.update(states);
  });
  return ctx;
}

function SignIn({ done }) {
  const [error, setError] = React.useState(""),
    [busy, setBusy] = React.useState(false),
    [signup, setSignup] = React.useState(false);
  const [providers, setProviders] = React.useState([]);
  React.useEffect(() => {
    client.request("/api/config").then(
      (c) => setProviders(c.socialProviders || []),
      () => {},
    );
  }, []);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(event.currentTarget),
      email = String(f.get("email"));
    try {
      await client.request(
        "/api/auth/" + (signup ? "sign-up/email" : "sign-in/email"),
        {
          method: "POST",
          body: JSON.stringify({
            email,
            password: f.get("password"),
            ...(signup ? { name: f.get("name") || email.split("@")[0] } : {}),
          }),
        },
      );
      done((await client.request("/api/me")).user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return h(
    "div",
    { className: "bees-hosted-login" },
    h("img", { src: brand, alt: "", width: 48 }),
    h("h1", null, signup ? "Create your Bees account" : "Welcome to Bees"),
    h("p", null, "Your work runs in Bees Cloud. No installation needed."),
    h(
      "form",
      { className: "bees-form", onSubmit: submit },
      signup
        ? h(
            "label",
            null,
            "Name",
            h("input", {
              className: "bees-input",
              name: "name",
              autoComplete: "name",
              required: true,
            }),
          )
        : null,
      h(
        "label",
        null,
        "Email",
        h("input", {
          className: "bees-input",
          type: "email",
          name: "email",
          autoComplete: "username",
          required: true,
        }),
      ),
      h(
        "label",
        null,
        "Password",
        h("input", {
          className: "bees-input",
          type: "password",
          name: "password",
          minLength: 8,
          autoComplete: signup ? "new-password" : "current-password",
          required: true,
        }),
      ),
      error ? h("p", { role: "alert", className: "bees-error" }, error) : null,
      h(
        Button,
        { type: "submit", className: "primary", disabled: busy },
        busy ? "Signing in…" : signup ? "Create account" : "Sign in",
      ),
    ),
    h(
      Button,
      {
        onClick: () => {
          setSignup(!signup);
          setError("");
        },
      },
      signup ? "Already have an account? Sign in" : "Create account",
    ),
    ...providers.map((provider) =>
      h(
        Button,
        {
          key: provider,
          onClick: async () => {
            try {
              const result = await client.request("/api/auth/sign-in/social", {
                method: "POST",
                body: JSON.stringify({
                  provider,
                  callbackURL: location.origin + "/app" + location.search,
                }),
              });
              location.assign(result.url);
            } catch (e) {
              setError(e.message);
            }
          },
        },
        "Continue with " + provider,
      ),
    ),
  );
}

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError() {
    return { error: "This screen could not load. Reload Bees to try again." };
  }
  componentDidCatch(error) {
    console.error(error);
  }
  render() {
    return this.state.error
      ? h(
          "div",
          { role: "alert", className: "bees-hosted-login" },
          this.state.error,
          h(Button, { onClick: () => location.reload() }, "Reload Bees"),
        )
      : this.props.children;
  }
}
function HostedApp() {
  const [user, setUser] = React.useState(null),
    [loading, setLoading] = React.useState(true),
    [error, setError] = React.useState("");
  React.useEffect(() => {
    client
      .request("/api/me")
      .then(
        (value) => setUser(value.user),
        (error) => {
          if (error.status !== 401) setError(error.message);
        },
      )
      .finally(() => setLoading(false));
    const logout = () => {
      client.dispose();
      client = createHostedClient();
      setUser(null);
    };
    window.addEventListener("bees-signed-out", logout);
    return () => window.removeEventListener("bees-signed-out", logout);
  }, []);
  const ctx = React.useMemo(
    () => (user ? contextFor(user, client) : null),
    [user?.id],
  );
  if (loading)
    return h(
      "p",
      { role: "status", className: "bees-hosted-login" },
      "Loading Bees…",
    );
  if (error)
    return h(
      "div",
      { role: "alert", className: "bees-hosted-login" },
      error,
      h(Button, { onClick: () => location.reload() }, "Retry"),
    );
  if (!user) return h(SignIn, { done: setUser });
  return h(
    NativeUi.Provider,
    { key: user.id, value: { ctx } },
    h(BeesApp, {
      ctx,
      preferences: ctx.configForms.get("bees"),
      modelSettings: ctx.configForms.get("llm-pi-ai"),
    }),
  );
}
createRoot(document.getElementById("bees-root")).render(
  h(ErrorBoundary, null, h(HostedApp)),
);
