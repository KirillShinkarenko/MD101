export const formatNumber = (value: number | null): string => {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }
  return new Intl.NumberFormat("en-US").format(value);
};

export const formatUsd = (value: number | null): string => {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }
  return `$${value.toFixed(6)}`;
};
