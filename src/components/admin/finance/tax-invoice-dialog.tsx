"use client";

import { useEffect, useState } from "react";
import { Modal, Spinner } from "@heroui/react";
import { loadTripProformas } from "@/lib/actions/finance";
import type { Option, ProformaBalance } from "@/lib/finance/queries";
import { TaxInvoiceForm } from "./tax-invoices-manager";

/** Add a tax invoice for one trip, right where you are (e.g. the Trips grid). */
export function TaxInvoiceDialog({
  trip,
  onClose,
  onSaved,
}: {
  /** The trip to add it to; null keeps the dialog closed. */
  trip: Option | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Loaded PIs, tagged with the trip they belong to, so a different trip shows "Loading…" until its own arrive.
  const [loaded, setLoaded] = useState<{ tripId: string; rows: ProformaBalance[] } | null>(null);
  const proformas = trip && loaded?.tripId === trip.id ? loaded.rows : null;

  useEffect(() => {
    if (!trip) return;
    let live = true;
    loadTripProformas(trip.id)
      .then((rows) => live && setLoaded({ tripId: trip.id, rows }))
      .catch(() => live && setLoaded({ tripId: trip.id, rows: [] }));
    return () => {
      live = false;
    };
  }, [trip]);

  return (
    <Modal.Backdrop isOpen={trip !== null} onOpenChange={(open) => !open && onClose()}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-lg">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Add tax invoice</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            {trip && proformas ? (
              <TaxInvoiceForm
                key={trip.id}
                proformas={proformas}
                target={{ taxInvoice: null, visitId: trip.id, proformaId: null }}
                visitOptions={[trip]}
                onSaved={onSaved}
              />
            ) : (
              <p className="flex items-center gap-2 py-6 text-sm text-muted">
                <Spinner size="sm" />
                Loading…
              </p>
            )}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
