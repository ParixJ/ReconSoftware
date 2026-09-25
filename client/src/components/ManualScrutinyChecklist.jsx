import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// The reference tool presents these as reviewer procedures, not automatic findings.
export const MANUAL_SCRUTINY_CHECKLIST = [
  ["Vouching", [
    "Confirm opening and closing balances have been checked for each ledger.",
    "CBC (confirmation by correspondence) done for all bank and loan accounts, and reconciled.",
    "Any query requiring account changes has been communicated to the client.",
    "Check P&F on both sides of the ledger.",
    "Go through vouching books not yet scrutinized (e.g. Purchase, Sales, Bank).",
    "Check how Sales Tax (VAT/CST) / Service tax is accounted for.",
    "Flag any Purchase Register party who is a relative.",
    "If jobwork is booked as purchase, note those parties for TDS provision review.",
  ]],
  ["Other process", [
    "Refer prior year's queries and their resolutions.",
    "Refer the yellow sheet, prior year's audit report, and current year's financial statements.",
    "Refer comparatives — check audit clause and tax computation (44AB / 44AD) with the client.",
    "Refer the audit manual, process flow, and error log.",
  ]],
  ["Ledgers — general", [
    "Know which group each ledger belongs to before scrutinizing it — that determines what to check.",
    "Check contra accounts for sister concerns (unsecured loans, creditors, debtors, loans & advances) and every other party under audit with you.",
    "Confirm AM&Co / ARM balances tally with the client's books.",
  ]],
  ["Capital account", [
    "Large capital introduced — verify source.",
    "Monthly withdrawals — adequate/reasonable for the business (judgement call).",
    "IT angle — 80C, 80D, 80G, advance tax, IT refund interest.",
    "Extraordinary items (gifts, TDS/TCS, profit on asset sale) — check treatment.",
  ]],
  ["Secured loans", [
    "Check loan and reconciliation statement.",
    "Confirm loan is in the client's name.",
    "Verify purpose and utilization of the loan.",
    "Tally interest/charges figures with the books.",
    "Interest on term loans is allowed under Sec 43B on payment basis.",
    "Check any interest subsidy relief calculation.",
    "Capitalize interest up to the date the asset is put to use, for loans taken for capital assets.",
  ]],
  ["Unsecured loans", [
    "New loans — confirm PAN and source of funds are available if required.",
    "Additions to existing loans — same PAN/source check.",
    "Interest paid to a relative lender — report under related-party disclosure.",
    "Confirm TDS deducted on loan interest, or Form 15G/H obtained.",
    "Interest rate should fall between 12–15%; query the client if outside that range.",
    "Report loan acceptance/repayment under the relevant tax audit clause.",
  ]],
  ["Reserve & surplus", [
    "If P&L is negative, it should be grouped as miscellaneous expenditure on the assets side.",
    "Subsidies booked as capital reserve — verify proof and treatment.",
  ]],
  ["Sundry creditors", [
    "Purchases from a relative — report the amount.",
    "Review journal entries in the account and their treatment.",
    "Request contra confirmation for large balances.",
    "Mixed accounts (purchases + unsecured loans) — ask the client to split them.",
    "Confirm it's genuinely a creditor and not an unsecured loan or customer advance.",
  ]],
  ["Advance from customers", [
    "Confirm how the opening balance was cleared (sale, journal, or payment).",
    "Confirm it's genuinely an advance and not an unsecured loan.",
    "Request contra confirmation if in doubt.",
  ]],
  ["Provisions", [
    "Reverse last year's provision.",
    "Base this year's provision on actual bills to avoid later adjustments (electricity, telephone, rent, audit fees, legal fees, salary/wages, bonus, etc.).",
    "Statutory dues (VAT/CST, TDS, professional tax, PF, ESI, house tax) — check March payment dates; confirm prior-year disallowances for non-payment are resolved this year if applicable.",
    "Items allowable only on payment basis — confirm paid on or before the due date.",
    "No provision needed if the client follows cash-basis accounting.",
  ]],
  ["Bank", [
    "Review every bank statement and BRS.",
    "If the BRS shows unrecorded interest/charges, ensure entries are passed.",
    "Note accounts opened and/or closed during the year.",
  ]],
  ["Deposits received", [
    "Establish the nature of each deposit.",
    "Confirm interest receivable and TDS deducted, cross-checked against Form 26AS.",
    "Report acceptance/repayment under the relevant tax audit clause, with proof.",
  ]],
  ["Investments", [
    "Confirm investment income (FD/NSC/PPF/debentures interest) is credited to P&L.",
    "Cross-check TDS deducted and income against Form 26AS.",
    "Pass an interest-receivable entry if applicable.",
    "Confirm share/security closing balances against Demat statements.",
    "Note the valuation method (cost or market) in the notes to accounts.",
    "Split into quoted/unquoted; disclose market price of unquoted investments if held at cost.",
    "Additions — verify proof, ownership, Demat confirmation, physical verification of NSC/FD, and treatment of share application money.",
    "Disposals — verify proof, gain/loss calculation, STT payment, Demat confirmation, and that off-market sale prices are reasonable; check whether an early exit revokes a previously claimed 80C exemption.",
  ]],
  ["Deposits made", [
    "Confirm whether it's genuinely an investment or a deposit.",
    "For new deposits, confirm non-refundable amounts are expensed/capitalized rather than booked as deposits.",
    "Confirm ownership, purpose, and interest receivable/TDS (tie to Form 26AS).",
    "For reductions, verify proof of refund and confirm interest receivable up to the return date.",
    "Telephone/finance company deposits — confirm the related expense/loan is also reflected correctly.",
    "Review long-outstanding deposits closely.",
  ]],
  ["Debtors", [
    "Review journal entries (discounts, kasar, bad debts).",
    "For bad debts written off, check how long it was outstanding and whether legal action was taken.",
    "Request contra confirmation for large or doubtful balances.",
    "Mixed accounts (debtors + loan) — ask the client to split them.",
    "For export debtors (100% EOU) and jobwork debtors, cross-check TDS deduction (rate, amount, date) against the TDS summary.",
  ]],
  ["Advance to suppliers", [
    "Confirm correct grouping (debtor vs loans & advances vs supplier advance).",
    "Investigate any odd/unusual balances.",
    "Confirm the opening balance was cleared through a purchase credit, not another route.",
    "If given for jobwork or contractor payment, confirm TDS was deducted at payment or expense credit, whichever is earlier.",
  ]],
];

export default function ManualScrutinyChecklist() {
  return <Card className="border border-border" aria-labelledby="manual-scrutiny-heading">
    <CardHeader><CardTitle id="manual-scrutiny-heading" className="text-lg">Manual review checklist</CardTitle>
      <p className="text-sm text-muted-foreground">Procedures from the reference scrutiny manual. These require auditor judgment or evidence beyond uploaded ledgers.</p></CardHeader>
    <CardContent className="space-y-2">{MANUAL_SCRUTINY_CHECKLIST.map(([title, items]) =>
      <details key={title} className="border border-border px-3 py-2 text-sm">
        <summary className="cursor-pointer">{title} · {items.length}</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">{items.map((item) => <li key={item}>{item}</li>)}</ul>
      </details>)}</CardContent>
  </Card>;
}
