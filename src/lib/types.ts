// Worker interface
export const worker = self as unknown as Worker;

// ToAddress type
export type ActorId = string & { readonly __actorID: unique symbol };

export type TopicName = string & { readonly __topicName: unique symbol };

export function createActorId(value: string): ActorId {
  // Validate format: name@uuid
  if (
    !/^[^@]+@[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(value)
  ) {
    throw new Error(
      `Invalid ActorId format: ${value}. Must be in the format name@uuid`,
    );
  }
  return value as ActorId;
}

export function createTopicName(name: string): TopicName {
  return name as TopicName;
}

// BaseState interface
export interface BaseState {
  name: string;
  id: ActorId;
  addressBook: Set<ActorId>;
  topics: Set<TopicName>;
}

export function actorState<T extends object>(state: T): T & BaseState {
  return {
    id: "",
    addressBook: new Set(),
    topics: new Set(),
    ...state,
  } as T & BaseState;
}

export const System = "SYSTEM" as ActorId;

export type SystemType = typeof System;

export interface reverseProxy {
  address: string;
  url?: string | URL;
}

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

// Union of all possible message addresses
export type MessageAddress = MessageAddressSingle | MessageAddressArray;

// MessageType type
export type MessageType = GenericMessage;

// CallbackType type
type CallbackType<T extends string> = `CB:${T}`;

// tsfile type
export type tsfile = string;

// BaseMessage interface
export type BaseMessage<K extends MessageType> = {
  type: any | CallbackType<any>;
  payload: unknown;
};

// AddressedMessage interface
export type AddressedMessage<K extends MessageType> = BaseMessage<K> & {
  address: {
    fm: ActorId;
    to: ActorId | ActorId[];
  };
};

// TargetedMessage interface
export type TargetedMessage<K extends MessageType> = BaseMessage<K> & {
  target: ActorId | ActorId[];
};

// Message type
export type Message = AddressedMessage<MessageType>;
export type TargetMessage = TargetedMessage<MessageType>;

// GenericMessage interface
export type GenericMessage = {
  address: {
    fm: ActorId;
    to: ActorId | ActorId[];
  };
  type: string;
  payload: unknown;
};

// AcFnRet type
type AcFnRet = void | Promise<void> | unknown | Promise<unknown>;

// GenericActorFunctions type
export type GenericActorFunctions = {
  [key: string]: (payload: any, ctx?: any) => AcFnRet;
};

// Actor interface to represent an actor in the system
export interface ActorW {
  worker: Worker;
}

// PairAddress interface
export interface PairAddress {
  fm: string;
  to: string;
}

// NonArrayAddress type
export type NonArrayAddress = PairAddress | SystemCommand | WorkerToSystem;

export type MessageFrom<T extends Record<string, (p: any) => any>> = {
  [K in keyof T]: {
    type: K;
    payload: Parameters<T[K]>[0];
    target: string | string[];
  };
}[keyof T];

export type ReturnFrom<
  T extends Record<string, (p: any) => any>,
  M extends MessageFrom<T>,
> = ReturnType<T[M["type"]]>;

export type WorkerConstructor = new (
  scriptURL: string | URL,
  options?: WorkerOptions,
) => Worker;

export type custompayload = {
  file: string;
  base?: string | URL;
} | "PROXY"
