export function assertCompatibilityDate(
  value: string,
  now: Date = new Date(),
  maxAgeDays = 180,
): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`Invalid Nitro compatibility date: ${value}`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) throw new Error(`Invalid Nitro compatibility date: ${value}`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ageDays = (today - date.valueOf()) / 86_400_000;
  if (ageDays < 0) throw new Error(`Nitro compatibility date ${value} is in the future`);
  if (ageDays > maxAgeDays) {
    throw new Error(
      `Nitro compatibility date ${value} is ${Math.floor(
        ageDays,
      )} days old; maximum is ${maxAgeDays}`,
    );
  }
}
