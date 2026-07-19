import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ListingDetailBody } from "@/components/listing/ListingDetailBody";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Product detail page (/product/:id) — kept for direct / shareable links and
 * browser history. In the normal click-through flow the search page opens the
 * same content in a slide-in panel (ListingPanel) without navigating away;
 * both render the shared ListingDetailBody.
 */
export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        to="/search"
        className="inline-flex items-center gap-1 text-sm text-brand-text hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to search
      </Link>

      {id ? (
        <ListingDetailBody id={id} />
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-danger-text">
            Could not load this listing.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
