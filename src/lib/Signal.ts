import { LogChannel } from "@mommysgoodpuppy/logchannel";
export class Signal<T> {
  // deno-lint-ignore no-explicit-any
  private static registry: Map<string, Signal<any>> = new Map();

  private resolve: ((value: T) => void) | null = null;
  private reject: ((reason?: unknown) => void) | null = null;
  private promise: Promise<T>;

  public readonly id: string;
  private name: string;
  private timeoutId?: number;

  constructor(name: string, timeout?: number) {
    this.id = crypto.randomUUID();
    this.name = name;

    this.promise = new Promise((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });

    Signal.registry.set(this.id, this);

    if (timeout) {
      this.timeoutId = setTimeout(() => {
        this.reject?.(
          new Error(`Signal '${this.name}' (${this.id}) timed out after ${timeout}ms`),
        );
      }, timeout);
    }
  }

  wait(): Promise<T> {
    // This ensures cleanup happens even if the consumer doesn't `await` or `.then` the promise.
    return this.promise.finally(() => this.destroy());
  }

  private trigger(value: T): void {
    if (this.resolve) {
      LogChannel.log(
        "signal",
        `Signal '${this.name}' (${this.id}) triggered with value:`,
        value,
      );
      this.resolve(value);
    }
  }

  private destroy(): void {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    Signal.registry.delete(this.id);
    this.resolve = null;
    this.reject = null;
  }

  public static trigger(id: string, value: unknown): void {
    const signal = Signal.registry.get(id);
    if (signal) {
      LogChannel.log("signal", "triggering", signal.name);
      signal.trigger(value);
    } else {
      console.error("stale signal triggered", id);
      //throw new Error("stale signal triggered")
    }
  }
}
