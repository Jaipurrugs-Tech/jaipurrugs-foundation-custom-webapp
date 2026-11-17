// The proforma invoice as a PDF (@react-pdf/renderer), laid out like the foundation's
// existing PI: bordered grid, seller block, billing details beside the PI number, one
// row per line plus a row per discount, GST, amount in words, bank details and the UPI
// QR code. Client-only: imported dynamically by ./download.ts when someone downloads.
// The built-in Helvetica has no ₹ glyph, so amounts are plain numbers (as on the original).

import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { amountInWords, formatAmount, formatPiDate, formatPlain, invoiceTotals, lineAmounts } from "./calc";
import type { InvoicePdfData } from "./types";

const LINE = "#1f2937";
const COLS = { sno: "12%", particulars: "44%", rate: "14%", qty: "14%", amount: "16%" };

const s = StyleSheet.create({
  page: { paddingVertical: 28, paddingHorizontal: 30, fontFamily: "Helvetica", fontSize: 9.5, color: "#111827" },
  frame: { borderWidth: 1, borderColor: LINE },
  row: { flexDirection: "row" },
  bb: { borderBottomWidth: 1, borderBottomColor: LINE },
  br: { borderRightWidth: 1, borderRightColor: LINE },
  pad: { paddingVertical: 3.5, paddingHorizontal: 5 },
  bold: { fontFamily: "Helvetica-Bold" },
  right: { textAlign: "right" },
  center: { textAlign: "center" },
  title: { fontFamily: "Helvetica-Bold", fontSize: 12 },
  seller: { fontFamily: "Helvetica-Bold", fontSize: 11 },
  line: { marginBottom: 2.5 },
  underline: { textDecoration: "underline" },
  muted: { color: "#4b5563" },
  qr: { width: 108, height: 108, objectFit: "contain", alignSelf: "flex-end", marginTop: 4 },
  footer: { fontFamily: "Helvetica-BoldOblique", fontSize: 9 },
});

function Lines({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <>
      {text.split(/\r?\n/).map((line, i) => (
        <Text key={i} style={s.line}>
          {line}
        </Text>
      ))}
    </>
  );
}

/** One row of the five-column items grid. */
function GridRow({
  cells,
  bold = false,
  minHeight,
}: {
  cells: [React.ReactNode, React.ReactNode, React.ReactNode, React.ReactNode, React.ReactNode];
  bold?: boolean;
  minHeight?: number;
}) {
  const widths = [COLS.sno, COLS.particulars, COLS.rate, COLS.qty, COLS.amount];
  const align = [s.center, {}, {}, s.center, s.right];
  return (
    <View style={[s.row, s.bb]} wrap={false}>
      {cells.map((cell, i) => (
        <View key={i} style={[s.pad, { width: widths[i] }, minHeight ? { minHeight } : {}, i < 4 ? s.br : {}]}>
          {typeof cell === "string" || typeof cell === "number" ? (
            <Text style={[align[i], bold ? s.bold : {}]}>{cell}</Text>
          ) : (
            cell
          )}
        </View>
      ))}
    </View>
  );
}

/** A totals row: label under Rate+Quantity, amount under Total. */
function TotalRow({ label, amount, bold = false }: { label: string; amount: string; bold?: boolean }) {
  return (
    <View style={[s.row, s.bb]} wrap={false}>
      <View style={[s.pad, s.br, { width: "56%" }]} />
      <View style={[s.pad, s.br, { width: "28%" }]}>
        <Text style={bold ? s.bold : {}}>{label}</Text>
      </View>
      <View style={[s.pad, { width: "16%" }]}>
        <Text style={[s.right, bold ? s.bold : {}]}>{amount}</Text>
      </View>
    </View>
  );
}

export function InvoicePdfDocument({ data }: { data: InvoicePdfData }) {
  const { settings, invoice, qrDataUri } = data;
  // Per-rate GST split for the totals block; the overall figures are the saved ones.
  const totals = invoiceTotals(
    invoice.items.map((item) => ({
      rate: item.rate,
      quantity: item.quantity,
      discountRate: item.discount_rate,
      gstRate: item.gst_rate,
    })),
  );

  return (
    <Document title={invoice.pi_number} author={settings.seller_name} subject="Proforma invoice">
      <Page size="A4" style={s.page}>
        <View style={s.frame}>
          <View style={[s.pad, s.bb]}>
            <Text style={s.title}>PROFORMA INVOICE</Text>
          </View>

          {/* Seller */}
          <View style={[s.pad, s.bb]}>
            <Text style={[s.seller, s.line]}>{settings.seller_name}</Text>
            <Lines text={settings.seller_address} />
            {settings.seller_phone ? <Text style={s.line}>Tel: {settings.seller_phone}</Text> : null}
            {settings.seller_state_name ? <Text style={s.line}>State Name {settings.seller_state_name}</Text> : null}
            {settings.seller_state_code ? <Text style={s.line}>State Code {settings.seller_state_code}</Text> : null}
            {settings.seller_gstin ? <Text style={s.bold}>GSTN No. {settings.seller_gstin}</Text> : null}
          </View>

          {/* Billing details | PI number, date, payment terms */}
          <View style={[s.row, s.bb]}>
            <View style={[s.pad, s.br, { width: "62%" }]}>
              <Text style={[s.bold, s.underline, { marginBottom: 6 }]}>Billing Details</Text>
              <Text style={s.line}>{invoice.billing_name}</Text>
              <Lines text={invoice.billing_address} />
              {invoice.billing_gstin ? <Text style={s.line}>GSTIN: {invoice.billing_gstin}</Text> : null}
            </View>
            <View style={{ width: "38%" }}>
              {[
                ["PI No.", invoice.pi_number],
                ["Date", formatPiDate(invoice.pi_date)],
                ["Payment Terms:", invoice.payment_terms ?? ""],
              ].map(([label, value], i) => (
                <View key={label}>
                  <View style={[s.pad]}>
                    <Text style={s.bold}>{label}</Text>
                  </View>
                  <View style={[s.pad, i < 2 ? s.bb : {}]}>
                    <Text style={s.bold}>{value || " "}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* Items */}
          <GridRow bold cells={["S. No.", <Text key="h" style={[s.bold, s.center]}>Particulars</Text>, "Rate", "Quantity", "Total Amt (INR)"]} />
          {invoice.items.map((item, index) => {
            const { gross, discount } = lineAmounts({
              rate: item.rate,
              quantity: item.quantity,
              discountRate: item.discount_rate,
              gstRate: item.gst_rate,
            });
            return (
              <View key={index}>
                <GridRow
                  cells={[
                    String(index + 1),
                    <View key="p">
                      <Text>{item.description}</Text>
                      {item.sac_code ? <Text style={[s.muted, { marginTop: 2 }]}>SAC: {item.sac_code}</Text> : null}
                      {item.details ? <Text style={{ marginTop: 8 }}>{item.details}</Text> : null}
                    </View>,
                    formatPlain(item.rate),
                    formatPlain(item.quantity),
                    formatAmount(gross),
                  ]}
                />
                {discount > 0 ? (
                  <GridRow
                    cells={[
                      "",
                      <Text key="d" style={s.right}>
                        - {item.discount_label || "Discount"}
                      </Text>,
                      formatPlain(item.discount_rate),
                      formatPlain(item.quantity),
                      `-${formatAmount(discount)}`,
                    ]}
                  />
                ) : null}
              </View>
            );
          })}
          <GridRow cells={["", "", "", "", ""]} minHeight={16} />

          {/* Totals */}
          <TotalRow bold amount={formatAmount(invoice.taxable_total)} label="Total Amount" />
          {totals.gstByRate
            .filter((g) => g.rate > 0)
            .map((g) => (
              <TotalRow key={g.rate} amount={formatAmount(g.gst)} label={`Add GST@ ${formatPlain(g.rate)}%`} />
            ))}
          <TotalRow bold amount={formatAmount(invoice.grand_total)} label="Net Total Payable" />
          <View style={[s.pad, s.bb]}>
            <Text style={[s.bold, s.right]}>{amountInWords(invoice.grand_total)}</Text>
          </View>

          {/* Bank details | UPI QR */}
          <View style={[s.row, s.bb]} wrap={false}>
            <View style={[s.pad, { width: "60%", paddingVertical: 8 }]}>
              <Text style={[s.bold, { marginBottom: 5 }]}>Bank Details</Text>
              {settings.bank_account_name ? <Text style={s.line}>{settings.bank_account_name}</Text> : null}
              {settings.bank_account_number ? <Text style={s.line}>A/c No: {settings.bank_account_number}</Text> : null}
              {settings.bank_ifsc ? <Text style={s.line}>IFSC Code: {settings.bank_ifsc}</Text> : null}
              {settings.bank_name ? <Text style={s.line}>Bank Name: {settings.bank_name}</Text> : null}
              {settings.bank_address ? <Text style={s.line}>Bank Address: {settings.bank_address}</Text> : null}
            </View>
            <View style={[s.pad, { width: "40%", paddingVertical: 8 }]}>
              {qrDataUri ? (
                <>
                  <Text style={[s.bold, s.right]}>Scan to pay via UPI</Text>
                  {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not an HTML img */}
                  <Image src={qrDataUri} style={s.qr} />
                </>
              ) : null}
            </View>
          </View>

          {invoice.terms.length > 0 ? (
            <View style={[s.pad, s.bb, { paddingVertical: 8 }]}>
              <Text style={[s.bold, { marginBottom: 5 }]}>Terms &amp; Conditions</Text>
              {invoice.terms.map((term, i) => (
                <Text key={i} style={[s.line, { lineHeight: 1.35 }]}>
                  {i + 1}. {term.title ? <Text style={s.bold}>{term.title}: </Text> : null}
                  {term.body}
                </Text>
              ))}
            </View>
          ) : null}

          <View style={[s.pad, { paddingVertical: 10 }]}>
            {settings.footer_note ? <Text style={s.footer}>*{settings.footer_note}</Text> : <Text> </Text>}
          </View>
        </View>
      </Page>
    </Document>
  );
}
