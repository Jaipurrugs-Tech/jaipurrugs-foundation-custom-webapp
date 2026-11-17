"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, TrashBin } from "@gravity-ui/icons";
import { AlertDialog, Button, Checkbox, Chip, Input, Label, Modal, Switch, TextArea, TextField, toast } from "@heroui/react";
import { deleteInvoiceTerm, saveInvoiceTerm, setInvoiceTermActive } from "@/lib/actions/invoices";
import type { InvoiceTermRow } from "@/lib/invoices/types";

function TermForm({ term, onSaved }: { term: InvoiceTermRow | null; onSaved: () => void }) {
  const [title, setTitle] = useState(term?.title ?? "");
  const [body, setBody] = useState(term?.body ?? "");
  const [isDefault, setIsDefault] = useState(term?.is_default ?? false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsPending(true);
    setError(null);
    const result = await saveInvoiceTerm(term?.id ?? null, { title, body, isDefault });
    setIsPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSaved();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <TextField isRequired value={title} onChange={setTitle}>
        <Label>Title</Label>
        <Input placeholder="e.g. Cancellation" />
      </TextField>
      <TextField isRequired value={body} onChange={setBody}>
        <Label>Text</Label>
        <TextArea placeholder="e.g. Cancellations made 7 days before the visit are refunded in full." rows={4} />
      </TextField>
      <Checkbox isSelected={isDefault} onChange={setIsDefault}>
        <Checkbox.Content>
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          Tick it on new proforma invoices by default
        </Checkbox.Content>
      </Checkbox>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button fullWidth isPending={isPending} type="submit">
        {term ? "Save term" : "Add term"}
      </Button>
    </form>
  );
}

/** The library of terms & conditions a PI can include. A PI keeps a copy of the ones chosen for it. */
export function InvoiceTermsPanel({ terms }: { terms: InvoiceTermRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<InvoiceTermRow | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<InvoiceTermRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  function openForm(term: InvoiceTermRow | null) {
    setEditing(term);
    setIsFormOpen(true);
  }

  async function toggle(term: InvoiceTermRow, isActive: boolean) {
    const result = await setInvoiceTermActive(term.id, isActive);
    if (result.error) toast.danger(result.error);
    router.refresh();
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setIsDeleting(true);
    const result = await deleteInvoiceTerm(pendingDelete.id);
    setIsDeleting(false);
    if (result.error) {
      toast.danger(result.error);
      return;
    }
    setPendingDelete(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          Choose which of these to print on each PI. Editing a term here doesn&apos;t change PIs already saved with
          it.
        </p>
        <Button onPress={() => openForm(null)}>
          <Plus className="size-4" />
          Add term
        </Button>
      </div>

      {terms.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted">
          No terms yet. Add your payment, cancellation and inclusion terms to pick them on a PI.
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border/70 rounded-2xl border border-border">
          {terms.map((term) => (
            <li key={term.id} className="flex items-start gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{term.title}</span>
                  {term.is_default ? (
                    <Chip color="accent" size="sm" variant="soft">
                      Default
                    </Chip>
                  ) : null}
                  {!term.is_active ? (
                    <Chip size="sm" variant="soft">
                      Off
                    </Chip>
                  ) : null}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{term.body}</p>
              </div>
              <Switch aria-label={`${term.title} available`} isSelected={term.is_active} onChange={(on) => toggle(term, on)}>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch>
              <Button isIconOnly aria-label="Edit term" size="sm" variant="ghost" onPress={() => openForm(term)}>
                <Pencil className="size-4" />
              </Button>
              <Button isIconOnly aria-label="Delete term" size="sm" variant="ghost" onPress={() => setPendingDelete(term)}>
                <TrashBin className="size-4 text-danger" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Modal.Backdrop isOpen={isFormOpen} onOpenChange={setIsFormOpen}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-lg">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{editing ? "Edit term" : "Add term"}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <TermForm
                key={editing?.id ?? "new"}
                term={editing}
                onSaved={() => {
                  setIsFormOpen(false);
                  router.refresh();
                }}
              />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <AlertDialog isOpen={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialog.Backdrop>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[420px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>Delete &ldquo;{pendingDelete?.title}&rdquo;?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p>It won&apos;t be offered on new PIs. PIs already saved with it keep their copy.</p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">
                  Cancel
                </Button>
                <Button isPending={isDeleting} variant="danger" onPress={handleDelete}>
                  Delete term
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}
