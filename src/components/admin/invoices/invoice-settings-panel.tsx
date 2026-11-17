"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TrashBin, ArrowUpFromLine } from "@gravity-ui/icons";
import { AlertDialog, Button, Description, Input, Label, TextArea, TextField, toast } from "@heroui/react";
import { removeInvoiceQr, updateInvoiceSettings, uploadInvoiceQr } from "@/lib/actions/invoices";
import { QR_MAX_BYTES, QR_MIME_TYPES } from "@/lib/invoices/constants";
import type { InvoiceSettingsInput } from "@/lib/invoices/schemas";
import type { InvoiceSettingsRow } from "@/lib/invoices/types";

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border p-5">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  isRequired,
  description,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  isRequired?: boolean;
  description?: string;
  multiline?: boolean;
}) {
  return (
    <TextField isRequired={isRequired} value={value} onChange={onChange}>
      <Label>{label}</Label>
      {multiline ? <TextArea placeholder={placeholder} rows={3} /> : <Input placeholder={placeholder} />}
      {description ? <Description>{description}</Description> : null}
    </TextField>
  );
}

/** The UPI QR code printed at the bottom right of every PI. Stored in the private invoice-assets bucket. */
function QrCodeCard({ hasQr, previewUrl }: { hasQr: boolean; previewUrl: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  async function upload(file: File) {
    if (!(QR_MIME_TYPES as readonly string[]).includes(file.type)) {
      toast.danger("Upload the QR code as a PNG or JPEG.");
      return;
    }
    if (file.size > QR_MAX_BYTES) {
      toast.danger("Keep the QR image under 2 MB.");
      return;
    }
    setIsUploading(true);
    const form = new FormData();
    form.append("file", file);
    const result = await uploadInvoiceQr(form);
    setIsUploading(false);
    if (result.error) {
      toast.danger(result.error);
      return;
    }
    toast.success("QR code saved. It prints on every PI.");
    router.refresh();
  }

  async function remove() {
    setIsRemoving(true);
    const result = await removeInvoiceQr();
    setIsRemoving(false);
    setIsConfirmingRemove(false);
    if (result.error) {
      toast.danger(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <Card hint="Printed under “Scan to pay via UPI” on every PI. PNG or JPEG, up to 2 MB." title="UPI QR code">
      <div className="flex flex-wrap items-center gap-5">
        <div className="flex size-36 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-neutral-50">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from a private bucket
            <img alt="UPI QR code" className="size-full object-contain p-2" src={previewUrl} />
          ) : (
            <span className="px-3 text-center text-xs text-muted">{hasQr ? "Preview unavailable" : "No QR code yet"}</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={input}
            accept={QR_MIME_TYPES.join(",")}
            className="hidden"
            type="file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
          <Button isPending={isUploading} variant="secondary" onPress={() => input.current?.click()}>
            <ArrowUpFromLine className="size-4" />
            {hasQr ? "Replace QR code" : "Upload QR code"}
          </Button>
          {hasQr ? (
            <Button variant="danger-soft" onPress={() => setIsConfirmingRemove(true)}>
              <TrashBin className="size-4" />
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      <AlertDialog isOpen={isConfirmingRemove} onOpenChange={setIsConfirmingRemove}>
        <AlertDialog.Backdrop>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[400px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>Remove the QR code?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p>PIs downloaded from now on won&apos;t show a UPI QR code until a new one is uploaded.</p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">
                  Keep it
                </Button>
                <Button isPending={isRemoving} variant="danger" onPress={remove}>
                  Remove
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </Card>
  );
}

export function InvoiceSettingsPanel({ settings, qrPreviewUrl }: { settings: InvoiceSettingsRow; qrPreviewUrl: string | null }) {
  const router = useRouter();
  const [form, setForm] = useState<Required<{ [K in keyof InvoiceSettingsInput]: string }>>({
    sellerName: settings.seller_name,
    sellerAddress: settings.seller_address,
    sellerPhone: settings.seller_phone ?? "",
    sellerStateName: settings.seller_state_name ?? "",
    sellerStateCode: settings.seller_state_code ?? "",
    sellerGstin: settings.seller_gstin ?? "",
    bankAccountName: settings.bank_account_name ?? "",
    bankAccountNumber: settings.bank_account_number ?? "",
    bankIfsc: settings.bank_ifsc ?? "",
    bankName: settings.bank_name ?? "",
    bankAddress: settings.bank_address ?? "",
    numberPrefix: settings.number_prefix,
    defaultPaymentTerms: settings.default_payment_terms ?? "",
    footerNote: settings.footer_note ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const set = (key: keyof typeof form) => (value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsPending(true);
    setError(null);
    const result = await updateInvoiceSettings(form);
    setIsPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    toast.success("Invoice settings saved.");
    router.refresh();
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
      <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
        <Card hint="The block at the top of every PI." title="Company">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field isRequired label="Company name" value={form.sellerName} onChange={set("sellerName")} />
            <Field label="GSTIN" value={form.sellerGstin} onChange={set("sellerGstin")} />
            <div className="sm:col-span-2">
              <Field isRequired multiline label="Address" value={form.sellerAddress} onChange={set("sellerAddress")} />
            </div>
            <Field label="Telephone" value={form.sellerPhone} onChange={set("sellerPhone")} />
            <div className="grid grid-cols-[1fr_6rem] gap-4">
              <Field label="State name" value={form.sellerStateName} onChange={set("sellerStateName")} />
              <Field label="State code" value={form.sellerStateCode} onChange={set("sellerStateCode")} />
            </div>
          </div>
        </Card>

        <Card hint="Printed under “Bank Details”." title="Bank details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Account name" value={form.bankAccountName} onChange={set("bankAccountName")} />
            <Field label="Account number" value={form.bankAccountNumber} onChange={set("bankAccountNumber")} />
            <Field label="IFSC code" value={form.bankIfsc} onChange={set("bankIfsc")} />
            <Field label="Bank name" value={form.bankName} onChange={set("bankName")} />
            <div className="sm:col-span-2">
              <Field label="Bank address" value={form.bankAddress} onChange={set("bankAddress")} />
            </div>
          </div>
        </Card>

        <Card title="Numbering and defaults">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              isRequired
              description={`New PIs are numbered ${form.numberPrefix || "PREFIX"}/<financial year>/<next number>, e.g. ${form.numberPrefix || "PREFIX"}/2627/004. A number typed on a PI is kept, and numbering continues after the highest one.`}
              label="PI number prefix"
              value={form.numberPrefix}
              onChange={set("numberPrefix")}
            />
            <Field
              description="Filled in on new PIs; can be changed per PI."
              label="Default payment terms"
              value={form.defaultPaymentTerms}
              onChange={set("defaultPaymentTerms")}
            />
            <div className="sm:col-span-2">
              <Field label="Footer note" value={form.footerNote} onChange={set("footerNote")} />
            </div>
          </div>
        </Card>

        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button className="self-start" isPending={isPending} type="submit">
          Save settings
        </Button>
      </form>

      <div>
        <QrCodeCard hasQr={Boolean(settings.upi_qr_path)} previewUrl={qrPreviewUrl} />
      </div>
    </div>
  );
}
