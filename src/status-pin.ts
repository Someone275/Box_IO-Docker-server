/** Virtual pin that follows a device key: "1" online, "0" offline. */
export const DEVICE_STATUS_PIN = 100;

/** Device presence stays visible when a license is hiding other pin values. */
export function clientPinValue(pin: number, value: string, licensed: boolean): string {
  if (pin === DEVICE_STATUS_PIN) return value === "1" ? "1" : "0";
  return licensed ? value : "";
}
