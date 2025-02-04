
import { ActorWorker } from "./ActorWorker.ts";


export const worker = self as unknown as ActorWorker;


export type ToAddress = string & { readonly _: unique symbol };



export interface BaseState {
  name: string;
  id: string | ToAddress;
  addressBook: Set<string>;
}

export function actorState<T extends {}>(state: T & BaseState): T & BaseState {
  return state;
}

export const System = "SYSTEM" as const;

export type SystemType = typeof System;

// Message Address Interfaces


export interface SystemCommand {
  fm: typeof System;
  to: string;
}

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







export type MessageType = GenericMessage

export type ValidateMessageType<T extends string> = T extends MessageType
  ? T
  : T extends string
  ? never
  : `Invalid message type. Valid types are: ${MessageType extends string ? MessageType : never}`;



type CBType = `CB:${string}`;

// Then extend Payload to include both regular and callback types




export type tsfile = string

type CallbackType<T extends string> = `CB:${T}`;






export type BaseMessage<K extends MessageType> = {
  type: any | CallbackType<any>;
  payload: unknown;
};

export type AddressedMessage<K extends MessageType> = BaseMessage<K> & {
  address: {
    fm: string;
    to: string | string[] | ToAddress;
  };
};

export type TargetedMessage<K extends MessageType> = BaseMessage<K> & {
  target: string | string[];
};

export type Message = AddressedMessage<MessageType>;
export type TargetMessage = TargetedMessage<MessageType>;



export type GenericMessage = {
  address: {
    fm: string;
    to: string | string[];
  };
  type: string;
  payload: unknown;
};

type AcFnRet = void | Promise<void> | unknown | Promise<unknown>
export type GenericActorFunctions = {
  readonly [key: string]: (payload: any) => AcFnRet;
};

export type Topic = string


export interface PairAddress {
  fm: string;
  to: string ;
}
export type NonArrayAddress = PairAddress | SystemCommand | WorkerToSystem;

// Type Guard to check if address is not an array
export function notAddressArray
(address: Message["address"]): address is NonArrayAddress {
  return !Array.isArray(address);
}
