import type { ActorWorker } from "./ActorWorker.ts";

// Worker interface
export const worker = self as unknown as ActorWorker;

// ToAddress type
export type ToAddress = string & { readonly _: unique symbol };

// BaseState interface
export interface BaseState {
  name: string;
  id: string | ToAddress;
  addressBook: Set<string>;
  topics: Set<string>;
}

export function actorState<T extends {}>(state: T & BaseState): T & BaseState {
  return state;
}

export const System = "SYSTEM" as const;

export type SystemType = typeof System;

// Message Address Interfaces

// SystemCommand interface
export interface SystemCommand {
  fm: typeof System;
  to: string;
}

// WorkerToSystem interface
export interface WorkerToSystem {
  fm: string;
  to: typeof System;
}

// Union of single address types
export type MessageAddressSingle = PairAddress | SystemCommand | WorkerToSystem;

// Address with array of strings or single string
export interface MessageAddressArray {
  fm: string;
  to: string | string[];
}

// Real message address with ToAddress
export interface MessageAddressReal {
  fm: string;
  to: ToAddress;
}

// Union of all possible message addresses
export type MessageAddress = MessageAddressSingle | MessageAddressArray;

// MessageType type
export type MessageType = GenericMessage

// ValidateMessageType type
export type ValidateMessageType<T extends string> = T extends MessageType
  ? T
  : T extends string
  ? never
  : `Invalid message type. Valid types are: ${MessageType extends string ? MessageType : never}`;

// CBType type
type CBType = `CB:${string}`;

// CallbackType type
type CallbackType<T extends string> = `CB:${T}`;

// tsfile type
export type tsfile = string

// BaseMessage interface
export type BaseMessage<K extends MessageType> = {
  type: any | CallbackType<any>;
  payload: unknown;
};

// AddressedMessage interface
export type AddressedMessage<K extends MessageType> = BaseMessage<K> & {
  address: {
    fm: string;
    to: string | string[] | ToAddress;
  };
};

// TargetedMessage interface
export type TargetedMessage<K extends MessageType> = BaseMessage<K> & {
  target: string | string[];
};

// Message type
export type Message = AddressedMessage<MessageType>;
export type TargetMessage = TargetedMessage<MessageType>;

// GenericMessage interface
export type GenericMessage = {
  address: {
    fm: string;
    to: string | string[];
  };
  type: string;
  payload: unknown;
};

// AcFnRet type
type AcFnRet = void | Promise<void> | unknown | Promise<unknown>

// GenericActorFunctions type
export type GenericActorFunctions = {
  readonly [key: string]: (payload: any) => AcFnRet;
};

// Topic type
export type Topic = string

// Actor interface to represent an actor in the system
export interface Actor {
  worker: Worker;
  topics: Set<Topic>;
}

// PairAddress interface
export interface PairAddress {
  fm: string;
  to: string;
}

// NonArrayAddress type
export type NonArrayAddress = PairAddress | SystemCommand | WorkerToSystem;

// notAddressArray function
export function notAddressArray
  (address: Message["address"]): address is NonArrayAddress {
  return !Array.isArray(address);
}
