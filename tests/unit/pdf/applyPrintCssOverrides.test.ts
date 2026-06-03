import { describe, expect, it } from "vitest";
import { __internal } from "../../../src/pdf/exportPdf";

const { applyPrintCssOverrides } = __internal;

describe("applyPrintCssOverrides", () => {
  it("appends overrides inside the existing <style> block", () => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">` +
      `<defs><style>.ifc-object { vector-effect: non-scaling-stroke; }</style></defs>` +
      `<path class="ifc-object" d="M0 0L10 0"/>` +
      `</svg>`;
    const out = applyPrintCssOverrides(svg);
    expect(out).toContain(".ifc-object");
    // Original rule survives (the override is appended, not a replace).
    expect(out).toContain(".ifc-object { vector-effect: non-scaling-stroke; }");
    // Override at the end of the style block disables the effect for paper.
    expect(out).toContain("vector-effect: none !important");
    // Label haloes are killed so the 0.18-unit halo doesn't print as a
    // 1.4 mm coloured band around every glyph after non-scaling-stroke is off.
    expect(out).toContain(".ifc-label, .user-area-label, .site-element-label");
    expect(out).toContain("stroke: none !important");
    expect(out).toContain("paint-order: normal !important");
  });

  it("injects a <defs><style> if the input has no style block", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L10 0"/></svg>`;
    const out = applyPrintCssOverrides(svg);
    expect(out).toContain("<defs><style>");
    expect(out).toContain("vector-effect: none !important");
    expect(out).toContain("stroke: none !important");
    // Original content untouched.
    expect(out).toContain(`<path d="M0 0L10 0"/>`);
  });

  it("targets every element class the viewer paints with non-scaling-stroke", () => {
    const svg = `<svg><defs><style>x</style></defs></svg>`;
    const out = applyPrintCssOverrides(svg);
    // The selector list must cover all interactive classes the SvgCanvas
    // attaches non-scaling-stroke to via the embedded <style> block.
    for (const cls of [
      ".ifc-object",
      ".user-area",
      ".site-element-polyline",
      ".site-element-polygon",
      ".site-element-point",
      ".ifc-label",
      ".user-area-label",
      ".site-element-label",
    ]) {
      expect(out).toContain(cls);
    }
  });
});
