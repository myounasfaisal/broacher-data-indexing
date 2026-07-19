import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { SidePanel } from "@/components/ui/side-panel";
import { ListingDetailBody } from "@/components/listing/ListingDetailBody";

/**
 * Right-side slide-in panel showing a product's full detail while the list
 * behind it stays mounted (and scrolled). Clicking a different product just
 * swaps the content (the `id` prop changes) — the panel never closes and
 * reopens. `edit` opens it with the edit form already expanded.
 *
 * The "Full page" link opens the same listing at /product/:id for a
 * shareable URL; direct links and browser history keep working through that
 * route.
 */
export function ListingPanel({
  id,
  onClose,
  edit = false,
}: {
  id: string | null;
  onClose: () => void;
  /** Open with the edit form already expanded (a row's Edit button). */
  edit?: boolean;
}) {
  return (
    <SidePanel
      open={id !== null}
      onClose={onClose}
      title="Product details"
      headerActions={
        <Link
          to={`/product/${id}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-btn px-2.5 text-xs font-medium text-brand-text hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
          title="Open as a full page (shareable link)"
        >
          Full page
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      }
    >
      {id && <ListingDetailBody id={id} onDeleted={onClose} defaultEdit={edit} />}
    </SidePanel>
  );
}
