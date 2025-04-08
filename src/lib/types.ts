export const worker = self as unknown as Worker;

// Strongly typed ActorId with validation at runtime
export type ActorId = string & { readonly __brand: unique symbol };

// Function to validate and create ActorId
export function createActorId(value: string): ActorId {
  // Validate format: name@uuid
  if (!/^[^@]+@[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Invalid ActorId format: ${value}. Must be in the format name@uuid`);
  }
  return value as ActorId;
}

// For backwards compatibility, keep ToAddress as an alias
export type ToAddress = ActorId;

// Basic state interface with all required properties for internal use
export interface BaseState {
  name: string;
  id: ActorId;
  addressBook: Set<ActorId>;
  [key: string]: any; // Allow any additional properties
}

// Interface for actor state initialization - only name is required
export interface ActorInit {
  name: string;
  id?: ActorId;
  addressBook?: Set<ActorId>;
  [key: string]: any; // Allow any additional properties
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

// Real message address with ActorId
export interface MessageAddressReal {
  fm: string;
  to: ActorId;
}

// Union of all possible message addresses
export type MessageAddress = MessageAddressSingle | MessageAddressArray | MessageAddressReal;

// Type for message type
export type MessageType = GenericMessage;

export type ValidateMessageType<T extends string> = T extends MessageType
  ? T
  : T extends string
  ? never
  : `Invalid message type. Valid types are: ${MessageType extends string ? MessageType : never}`;

export type tsfile = string;

export type BaseMessage<K extends MessageType> = {
  type: string;
  payload: unknown;
};

export type AddressedMessage<K extends MessageType> = BaseMessage<K> & {
  address: {
    fm: string;
    to: string | string[] | ActorId;
  };
};

export type TargetedMessage<K extends MessageType> = BaseMessage<K> & {
  target: string | string[] | ActorId;
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

type AcFnRet = void | Promise<void> | unknown | Promise<unknown>;
export type GenericActorFunctions = {
  readonly [key: string]: (payload: any) => AcFnRet;
};

export type Topic = string;

export interface PairAddress {
  fm: string;
  to: string;
}

export type NonArrayAddress = PairAddress | SystemCommand | WorkerToSystem;

// Type Guard to check if address is not an array
export function notAddressArray(
  address: Message["address"]
): address is NonArrayAddress {
  return !Array.isArray(address.to);
}

// Helper function to create properly typed actor state
export function createActorState<T extends Record<string, any>>(data: T & { name: string }): T & BaseState {
  return data as T & BaseState;
}
