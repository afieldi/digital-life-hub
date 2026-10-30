import {
  Breadcrumbs,
  Link,
  Breadcrumb as RACBreadcrumb,
} from "react-aria-components";
import { focusRing } from "../primitives/focus";

export function Breadcrumb({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  return (
    <Breadcrumbs className="flex items-center font-ui text-sm">
      {items.map((item, i) => (
        <RACBreadcrumb
          key={item.href ?? item.label}
          className="flex items-center text-ink-tertiary data-[current]:text-ink-primary"
        >
          <Link
            href={item.href}
            className={`inline-flex min-h-11 items-center rounded-10 px-1 ${focusRing}`}
          >
            {item.label}
          </Link>
          {i < items.length - 1 ? (
            <span aria-hidden="true" className="px-2 text-ink-muted">
              /
            </span>
          ) : null}
        </RACBreadcrumb>
      ))}
    </Breadcrumbs>
  );
}
