import { describe, expect, it } from "vitest";
import { fileTree } from "../src/domain.js";

describe("fileTree", () => {
  it("groups relative paths into the folders they came from", () => {
    const tree = fileTree(["a.md", "docs/b.md", "docs/deep/c.md", "docs/d.md"]);
    expect(tree.files).toEqual(["a.md"]);
    const docs = tree.folders.get("docs")!;
    expect(docs.files).toEqual(["b.md", "d.md"]);
    expect(docs.folders.get("deep")!.files).toEqual(["c.md"]);
  });

  it("ignores empty paths", () => {
    const tree = fileTree([""]);
    expect(tree.files).toEqual([]);
    expect(tree.folders.size).toBe(0);
  });
});
