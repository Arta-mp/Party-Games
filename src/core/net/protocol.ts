import { z } from 'zod';

/** §4.2 wire protocol. Everything that crosses the network is validated with these schemas. */

export interface Hello {
  name: string;
  deviceId: string;
  /** after an election the new host doesn't know device ids; players reclaim their seat with this */
  playerId?: string;
}

export const lobbyActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), ready: z.boolean() }),
  z.object({ type: z.literal('kick'), id: z.string() }),
  z.object({ type: z.literal('lock'), locked: z.boolean() }),
  z.object({ type: z.literal('select'), gameId: z.string(), config: z.unknown() }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('next') }),
  z.object({ type: z.literal('toLobby') }),
  z.object({ type: z.literal('transfer'), id: z.string() }),
  z.object({ type: z.literal('rename'), name: z.string().max(40) }),
]);
export type LobbyAction = z.infer<typeof lobbyActionSchema>;

export const envelopeSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('lobby'), a: lobbyActionSchema }),
  z.object({ scope: z.literal('game'), a: z.unknown() }),
]);
export type Envelope = z.infer<typeof envelopeSchema>;

export const clientMsgSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    name: z.string().min(1).max(40),
    deviceId: z.string().min(8).max(64),
    playerId: z.string().max(40).optional(),
  }),
  z.object({ t: z.literal('action'), action: envelopeSchema, seq: z.number().int() }),
  z.object({ t: z.literal('ping') }),
]);
export type ClientMsg = z.infer<typeof clientMsgSchema>;

export const hostMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('welcome'), playerId: z.string(), now: z.number() }),
  z.object({ t: z.literal('lobby'), lobby: z.record(z.string(), z.unknown()), now: z.number() }),
  z.object({ t: z.literal('view'), gameId: z.string(), view: z.unknown(), rev: z.number(), now: z.number() }),
  z.object({ t: z.literal('error'), code: z.string() }),
  /** host transfer: full snapshot to the new host only */
  z.object({ t: z.literal('snapshot'), data: z.unknown() }),
  z.object({ t: z.literal('pong'), now: z.number() }),
]);
export type HostMsg = z.infer<typeof hostMsgSchema>;

export { CODE_ALPHABET, CODE_RE, makeRoomCode, normalizeCode } from './code';
