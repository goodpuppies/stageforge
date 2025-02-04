import { CustomLogger } from "../logger/customlogger.ts";
import {
  System,
  type Message,
  type TargetMessage,
  type AddressedMessage,
  type MessageType
} from "./types.ts";


export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

export function StandardizeAddress(message: TargetMessage | Message, ctx: any): AddressedMessage<MessageType> {
  let from
  if (ctx.state) { from = ctx.state.id }
  else { from = System }

  let addressedMessage: AddressedMessage<MessageType>;

  if ('target' in message) {
    addressedMessage = {
      address: { fm: from, to: message.target },
      ...message,
    };
  } else {
    addressedMessage = message;
  }
  return addressedMessage
}

export class Signal<T> {
  private resolve: ((value: T) => void) | null = null;
  private promise: Promise<T> | null = null;

  constructor() {
    this.promise = new Promise((res) => {
      this.resolve = res;
    });
  }

  wait(): Promise<T> {
    return this.promise!;
  }

  trigger(value: T): void {
    if (this.resolve) {
      CustomLogger.log("actorsys", "signal triggered");
      this.resolve(value);
    }
  }
}
