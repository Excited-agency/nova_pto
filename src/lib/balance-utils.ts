export function getBalanceText(balance: number | undefined): string {
  if (balance === undefined) return "—"
  return `${balance} days`
}
