export let React;
export let h;
export let useEffect;
export let useRef;
export let useState;
export let MarkdownText;
export let ExternalLocalAiSettings;
export let CustomAiSettings;
export let SubscriptionSettings;
export let hosted = false;

const markdownLabels = { code: { copyLabel: "Copy", copiedLabel: "Copied" }, footnotes: "Footnotes" };

export function configureRuntime(require, options = {}) {
  hosted = Boolean(options.hosted);
  React = require("react");
  h = React.createElement;
  ({ useEffect, useRef, useState } = React);
  const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
  MarkdownText = (props) => h(primitives.MarkdownText, { labels: markdownLabels, ...props });
  if (!hosted) {
    ({ ExternalLocalAiSettings } = require("@bees/dsh-local-ai"));
    ({ CustomAiSettings } = require("@bees/dsh-custom-ai"));
    ({ SubscriptionSettings } = require("@bees/dsh-subscriptions"));
  }
}
