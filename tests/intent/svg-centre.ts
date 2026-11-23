// The centre of a drawn SVG mark, read from its GEOMETRY (not from the
// `data-cx`/`data-cy` hooks it also carries): a circle's cx/cy, a rect's
// centre, a polygon's vertex centroid. The chart tests compare this with the
// hooks (a test reading only the hook never sees a shape drawn off its
// point).

export interface Point {
  readonly x: number;
  readonly y: number;
}

const num = (el: Element, attr: string): number => {
  const value = el.getAttribute(attr);
  if (value === null) throw new Error(`<${el.tagName}> has no ${attr}`);
  const n = Number(value);
  if (!Number.isFinite(n))
    throw new Error(`<${el.tagName}> ${attr}="${value}"`);
  return n;
};

export function drawnCentre(el: Element): Point {
  switch (el.tagName.toLowerCase()) {
    case "circle":
      return { x: num(el, "cx"), y: num(el, "cy") };
    case "rect":
      return {
        x: num(el, "x") + num(el, "width") / 2,
        y: num(el, "y") + num(el, "height") / 2,
      };
    case "polygon": {
      const vertices = (el.getAttribute("points") ?? "")
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(",").map(Number));
      if (
        vertices.length < 3 ||
        vertices.some(
          (v) => v.length !== 2 || v.some((c) => !Number.isFinite(c)),
        )
      ) {
        throw new Error(`<polygon> points="${el.getAttribute("points")}"`);
      }
      const sum = vertices.reduce(
        (acc, [x, y]) => ({ x: acc.x + x!, y: acc.y + y! }),
        { x: 0, y: 0 },
      );
      return { x: sum.x / vertices.length, y: sum.y / vertices.length };
    }
    default:
      throw new Error(`no centre for <${el.tagName}>`);
  }
}

/** The centre the mark CLAIMS, from its `data-cx`/`data-cy` hooks. */
export const claimedCentre = (el: Element): Point => ({
  x: num(el, "data-cx"),
  y: num(el, "data-cy"),
});
