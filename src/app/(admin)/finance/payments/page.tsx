import { redirect } from "next/navigation";

// "Payments received" became Invoices (tax invoices); keep old links working.
export default function FinancePaymentsRedirect() {
  redirect("/finance/invoices");
}
