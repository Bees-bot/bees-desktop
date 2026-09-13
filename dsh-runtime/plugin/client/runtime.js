export let React;
export let NativeUi;
export let createPortal;
export let h;
export let useEffect;
export let useRef;
export let useState;
export let MarkdownText;
export let CodeBlock;
export let LocalAiController;
export let LocalAiSettings;
export let ExternalLocalAiSettings;
export let FreeAiController;
export let FreeAiSettings;
export let CustomAiSettings;
export let SubscriptionSettings;

export function configureRuntime(require) {
  React = require("react");
  ({ createPortal } = require("react-dom"));
  h = React.createElement;
  NativeUi = React.createContext(null);
  ({ useEffect, useRef, useState } = React);
  ({ MarkdownText, CodeBlock } = require("@deepseek-ai/dsh-client-ui-primitives"));
  ({ LocalAiController, LocalAiSettings, ExternalLocalAiSettings } = require("@bees/dsh-local-ai"));
  ({ FreeAiController, FreeAiSettings } = require("@bees/dsh-free-ai"));
  ({ CustomAiSettings } = require("@bees/dsh-custom-ai"));
  ({ SubscriptionSettings } = require("@bees/dsh-subscriptions"));
}
