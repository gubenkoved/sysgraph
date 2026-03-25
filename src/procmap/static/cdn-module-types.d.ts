declare module "https://cdn.jsdelivr.net/npm/d3@6/+esm" {
  export * from "d3";
}

declare module "https://cdn.jsdelivr.net/npm/force-graph/+esm" {
  import ForceGraph from "force-graph";
  export default ForceGraph;
  export * from "force-graph";
}

declare module "https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js" {
  import { Pane } from "tweakpane";
  export { Pane };
  export * from "tweakpane";
}

declare module "https://cdn.jsdelivr.net/npm/json-formatter-js/+esm" {
    import JSONFormatter from "json-formatter-js";
    export default JSONFormatter;
    export { JSONFormatter };
}

declare module "https://cdn.jsdelivr.net/npm/fuse.js@7.1.0/dist/fuse.mjs" {
  import Fuse from "fuse";
  export default Fuse;
}