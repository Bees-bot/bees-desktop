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
  // "$12,000, up $2,000" rendered as math, so escape a $ before a digit outside code
  const money = (text) => typeof text === "string" ? text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/).map((part, i) => i % 2 ? part : part.replace(/\$(?=\d)/g, "\\$")).join("") : text;
  MarkdownText = (props) => h(primitives.MarkdownText, { labels: markdownLabels, ...props, text: money(props.text) });
  if (!hosted) {
    ({ CustomAiSettings, OpenAiServersSettings } = require("@bees/dsh-custom-ai"));
    ({ SubscriptionSettings } = require("@bees/dsh-subscriptions"));
  }
}
