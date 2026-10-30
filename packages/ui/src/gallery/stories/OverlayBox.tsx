import { type ReactNode, useState } from "react";
import { UNSAFE_PortalProvider } from "react-aria";

// Each story renders alone (?story=<id>), so overlays can be really open.
// Overlays are portalled into this box (UNSAFE_PortalProvider for RAC's own
// portals such as ToastRegion, plus each component's portalContainer prop) so the
// open overlay lives inside the story's [data-story] element and is captured.
// `transform` makes the box the containing block for fixed/absolute children.
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
