import { render } from "@testing-library/react";
import {
  addToast,
  createToastQueue,
  ToastRegion,
} from "../src/primitives/Toast";

test("x", () => {
  const q = createToastQueue();
  addToast(q, "Hi", "success");
  const { container } = render(<ToastRegion queue={q} className="absolute" />);
  console.log(container.innerHTML, q.visibleToasts.length);
});
