import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { NAVIGATION, defaultOrgColor } from "./shared.js";
import { dashboardsFrom } from "./dashboard-model.js";

test("Home and saved dashboards open directly from each team's navigation", () => {
  const source = readFileSync(new URL("./shell.js", import.meta.url), "utf8");
  const scopeSource = source.slice(source.indexOf("function ScopeSwitcher("), source.indexOf("\nexport function BeesApp("));
  let hook = 0;
  const ScopeSwitcher = vm.runInNewContext(`${scopeSource}\nScopeSwitcher`, {
    NAVIGATION, defaultOrgColor,
    ChevronDownIcon: "chevron", CloseIcon: "close", EditIcon: "edit", SettingsIcon: "settings",
    h: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter(Boolean) }),
    useEffect: () => {},
    useState: (initial) => [hook++ === 0 ? new Set(["one", "two"]) : initial(), () => {}]
  });
  const changes = [], opened = [], renamed = [], deleted = [], navigated = [];
  const props = {
    data: { organizations: [{ id: "org", name: "Private" }], teams: [
      { id: "one", name: "First", organizationId: "org" },
      { id: "two", name: "Second", organizationId: "org" }
    ] },
    organizationId: "org", teamId: "one", connectionId: "", organizationColors: {},
    route: "home", sectionId: "home", activeDashboardId: "sales",
    dashboards: dashboardsFrom([{ id: "sales", name: "Sales", widgets: [] }]),
    onChange: (...args) => changes.push(args), onOpenDashboard: (id) => opened.push(id),
    onRenameDashboard: (dashboard) => renamed.push(dashboard.id),
    onDeleteDashboard: (dashboard) => deleted.push(dashboard.id), onNavigate: (route) => navigated.push(route)
  };
  const nodes = [];
  const walk = (node, parent) => {
    if (!node || typeof node !== "object") return;
    nodes.push({ node, parent });
    node.children.forEach((child) => walk(child, node));
  };
  walk(ScopeSwitcher(props));
  assert.equal(NAVIGATION[0].label, "Home");
  assert(!nodes.some(({ node }) => /bees-nav-dashboards|bees-dashboard-create/.test(node.props.className)));
  const rows = nodes.filter(({ node }) => node.props.className === "bees-dashboard-item");
  assert.equal(rows.length, 4);
  for (const { node, parent } of rows) {
    assert.equal(parent.type, "nav", "dashboards must be top-level team menu entries");
    const link = node.children[0];
    assert.equal(link.props["aria-expanded"], undefined);
    assert(!link.props.className.includes("bees-nav-child"));
    assert.equal(link.props["aria-current"] === "page", parent.props["aria-label"] === "First navigation" && link.props.title === "Sales");
    link.props.onClick();
  }
  assert.deepEqual(opened, ["home", "sales", "home", "sales"]);
  assert.deepEqual(changes, [["team:two", "", false], ["team:two", "", false]]);
  nodes.find(({ node }) => node.props["aria-label"] === "Rename Sales").node.props.onClick();
  nodes.find(({ node }) => node.props["aria-label"] === "Delete Sales").node.props.onClick();
  assert.deepEqual(renamed, ["sales"]);
  assert.deepEqual(deleted, ["sales"]);
  assert(!nodes.some(({ node }) => node.props["aria-label"] === "Delete Home"));
  nodes.find(({ node }) => node.type === "button" && node.children.some((child) => child.children?.includes("Process runs"))).node.props.onClick();
  assert.deepEqual(navigated, ["work"]);
});
