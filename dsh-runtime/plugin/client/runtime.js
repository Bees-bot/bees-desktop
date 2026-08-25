export let React;
export let h;
export let useEffect;
export let useMemo;
export let useRef;
export let useState;
export let MarkdownText;
export let PendingQuestion;
export let LocalAiController;
export let LocalAiSettings;
export let ExternalLocalAiSettings;
export let FreeAiController;
export let FreeAiSettings;
export let OmniRouteSettings;
export let CustomAiSettings;
export let SubscriptionSettings;

export function configureRuntime(require) {
  React = require("react");
  h = React.createElement;
  ({ useEffect, useMemo, useRef, useState } = React);
  ({ MarkdownText } = require("@deepseek-ai/dsh-client-ui-primitives"));
  ({ PendingQuestion } = require("@deepseek-ai/dsh-client-ui-user-questions"));
  ({ LocalAiController, LocalAiSettings, ExternalLocalAiSettings } = require("@bees/dsh-local-ai"));
  ({ FreeAiController, FreeAiSettings, OmniRouteSettings } = require("@bees/dsh-free-ai"));
  ({ CustomAiSettings } = require("@bees/dsh-custom-ai"));
  ({ SubscriptionSettings } = require("@bees/dsh-subscriptions"));
}
