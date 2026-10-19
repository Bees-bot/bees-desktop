export let React;
export let NativeUi;
export let createPortal;
export let h;
export let useEffect;
export let useRef;
export let useState;
export let MarkdownText;
export let CodeBlock;
export let CustomAiSettings;
export let OpenAiServersSettings;
export let SubscriptionSettings;
export let hosted = false;
export let hostedRequest;

const markdownLabels = { code: { copyLabel: "Copy", copiedLabel: "Copied" }, footnotes: "Footnotes" };

export function configureRuntime(require, options = {}) {
  hosted = Boolean(options.hosted);
  hostedRequest = options.request;
  React = require("react");
  ({ createPortal } = require("react-dom"));
  h = React.createElement;
  NativeUi = React.createContext(null);
  ({ useEffect, useRef, useState } = React);
  const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
  CodeBlock = primitives.CodeBlock;
  MarkdownText = (props) => h(primitives.MarkdownText, { labels: markdownLabels, ...props });
  if (!hosted) {
    ({ CustomAiSettings, OpenAiServersSettings } = require("@bees/dsh-custom-ai"));
    ({ SubscriptionSettings } = require("@bees/dsh-subscriptions"));
  }
}
