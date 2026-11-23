"use client";

import { AlertDialog, Button } from "@heroui/react";

/** A danger confirmation for deleting one finance record. */
export function ConfirmDelete({
  isOpen,
  title,
  body,
  confirmLabel,
  isPending,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog isOpen={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialog.Backdrop>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[400px]">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>{title}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>{body}</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                Cancel
              </Button>
              <Button isPending={isPending} variant="danger" onPress={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}
