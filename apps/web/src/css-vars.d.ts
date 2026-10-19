import "react";

// Components pass computed values (fill levels, map offsets) to CSS as --mt-* custom
// properties; the stylesheet decides how they're drawn.
declare module "react" {
  interface CSSProperties {
    [variable: `--mt-${string}`]: string | undefined;
  }
}
