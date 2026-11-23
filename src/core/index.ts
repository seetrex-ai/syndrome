// Public API of the simulation core. Pure TypeScript: no React, no DOM, no
// window. Runs identically in the browser, a Web Worker and Node (tests and
// validation). See docs/spec.md §2 rule 2 and §5.

/** Code distances the app offers. Odd, so a majority vote on the logical operator exists. */
export const DISTANCES = [3, 5, 7, 9] as const;
export type Distance = (typeof DISTANCES)[number];

export * from "./lattice/index";
export * from "./noise/index";
export * from "./decoder/index";
export * from "./sim/index";
