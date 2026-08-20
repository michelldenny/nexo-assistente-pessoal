export const formatMoneyInput = (value: string) => {
  const digits = value
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "")
    .slice(0, 15);
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(digits || "0") / 100);
};
export const parseMoneyInput = (value: string) =>
  Number(value.replace(/\D/g, ""));
export const formatMonth = (month: string) => {
  const label = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(new Date(`${month}-01T12:00:00Z`))
    .replace(/\s+de\s+/gi, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
};
