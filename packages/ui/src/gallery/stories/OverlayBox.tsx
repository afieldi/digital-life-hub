import { type ReactNode, useState } from "react";
import { UNSAFE_PortalProvider } from "react-aria";

// Each story renders alone (?story=<id>), so overlays can be really open.
// Overlays (popovers, modals, tooltips, toasts) are portalled into this box via
// UNSAFE_PortalProvider, so the open overlay lives inside the story's
// [data-story] element and is captured. `transform` makes the box the
// containing block for fixed/absolute children.
//
// `react-aria` is pinned to an exact version in packages/ui/package.json because
// UNSAFE_PortalProvider must come from the same react-aria instance that
// react-aria-components uses; a mismatched copy would silently not portal here.
export function OverlayBox({
  height = 280,
  width = 440,
  children,
}: {
  height?: number;
  width?: number;
  children: (container: HTMLDivElement) => ReactNode;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  return (
    <div
      ref={setEl}
      style={{ height, width, transform: "translateZ(0)" }}
      className="relative overflow-hidden rounded-18"
    >
      {el ? (
        <UNSAFE_PortalProvider getContainer={() => el}>
          {children(el)}
        </UNSAFE_PortalProvider>
      ) : null}
    </div>
  );
}
