import type { WebSocket } from "ws";
import type { JwtUser } from "./types.js";
import { licenseAllowsData } from "./license.js";
import { memberIdsForDevice } from "./viewers.js";

export interface ClientSocket {
  ws: WebSocket;
  user: JwtUser;
}

const clients = new Set<ClientSocket>();

export function addClient(client: ClientSocket): void {
  clients.add(client);
  client.ws.on("close", () => clients.delete(client));
}

export function emitToUser(
  userId: number,
  payload: Record<string, unknown>,
): void {
  const data = JSON.stringify(payload);
  for (const client of clients) {
    if (client.user.id === userId && client.ws.readyState === 1) {
      client.ws.send(data);
    }
  }
}

export function emitPinUpdate(
  userId: number,
  deviceKeyId: number,
  pin: number,
  value: string,
  properties?: Record<string, string>,
): void {
  const visible = licenseAllowsData();
  const payload = {
    type: "pin",
    deviceKeyId,
    pin,
    value: visible ? value : "",
    properties: visible ? (properties ?? {}) : {},
    licensed: visible,
  };
  emitToUser(userId, payload);
  for (const memberId of memberIdsForDevice(userId, deviceKeyId)) {
    if (memberId !== userId) emitToUser(memberId, payload);
  }
}

export function emitDeviceStatus(
  userId: number,
  deviceKeyId: number,
  online: boolean,
): void {
  const payload = {
    type: "device",
    deviceKeyId,
    online,
  };
  emitToUser(userId, payload);
  for (const memberId of memberIdsForDevice(userId, deviceKeyId)) {
    if (memberId !== userId) emitToUser(memberId, payload);
  }
}
