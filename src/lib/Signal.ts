import { LogChannel } from "@mommysgoodpuppy/logchannel";
export class Signal<T> {
  private resolve: ((value: T) => void) | null = null;
  private promise: Promise<T> | null = null;
  private id: symbol;

  constructor() {
    this.id = Symbol('signal');
    this.promise = new Promise((res) => {
      this.resolve = res;
    });
  }

  wait(): Promise<T> {
    return this.promise!;
  }

  trigger(value: T): void {
    if (this.resolve) {
      LogChannel.log("signal", `signal ${this.id.toString()} triggered with value:`, value);
      this.resolve(value);
    }
  }
}