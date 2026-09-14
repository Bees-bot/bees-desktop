import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { expect, it, vi } from "vitest";

const source = readFileSync(new URL("../dsh-runtime/plugin/client/processes.js", import.meta.url), "utf8");
const h = (tag: any, props: any, ...children: any[]) => ({ tag, props, children });
const flatten = (node: any): any[] => !node || typeof node !== "object" ? []
  : [node, ...(node.children ?? []).flat(Infinity).flatMap(flatten)];

it("runs the selected template, duplicates by name, and confirms archiving", async () => {
  const act = vi.fn();
  const openWorkItem = vi.fn();
  const ask = vi.fn().mockResolvedValue("  Copy name  ");
  const confirmAction = vi.fn().mockResolvedValue(false);
  const setError = vi.fn();
  const Actions = new Script(source.slice(source.indexOf("export function ProcessListActions("), source.indexOf("export function ProcessesPage("))
    .replace("export function", "function") + "; ProcessListActions").runInNewContext({
    h, Error, Button: "button", React: { Fragment: "fragment" }, ask, confirmAction,
    useState: () => ["", setError], useSubmit: (handler: any) => [false, handler]
  });
  const process = { id: "selected", name: "Selected", kind: "standard" };
  const render = (kind = "standard") => flatten(Actions({ process: { ...process, kind }, act, openWorkItem }));
  const click = (label: string) => render().find((node) => node.tag === "button" && node.children[0] === label).props.onClick({});
  await click("Run");
  expect(openWorkItem).toHaveBeenCalledWith(null, "selected");
  expect(act).not.toHaveBeenCalled();
  await click("Duplicate");
  expect(act).toHaveBeenLastCalledWith({ action: "copy_process", processId: "selected", name: "Copy name" });
  act.mockClear();
  ask.mockResolvedValue(null);
  await click("Duplicate");
  await click("Archive");
  expect(act).not.toHaveBeenCalled();
  confirmAction.mockResolvedValue(true);
  await click("Archive");
  expect(act).toHaveBeenLastCalledWith({ action: "archive_process", processId: "selected" });
  act.mockRejectedValue(new Error("Pause schedules first"));
  await click("Archive");
  expect(setError).toHaveBeenLastCalledWith("Pause schedules first");
  expect(render("goals").filter((node) => node.tag === "button").map((node) => [node.children[0], node.props.disabled]))
    .toEqual([["Run", false], ["Duplicate", false], ["Archive", true], ["Delete", true]]);
  act.mockReset();
  for (const sourceKind of ["process", "template"]) {
    const buttons = flatten(Actions({ process: { ...process, archivedAt: "2026-09-10", sourceKind }, act, openWorkItem }))
      .filter((node) => node.tag === "button");
    expect(buttons.map((node) => node.children[0])).toEqual(["Restore"]);
    await buttons[0].props.onClick({});
    expect(act).toHaveBeenLastCalledWith(sourceKind === "process"
      ? { action: "restore_process", processId: "selected" }
      : { action: "restore_process_template", templateId: "selected" });
  }
});
