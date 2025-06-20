import { LogChannel } from "@mommysgoodpuppy/logchannel";

export class SignalEvent<T> {
  // deno-lint-ignore no-explicit-any
  private static registry: Map<string, SignalEvent<any>> = new Map();

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

    SignalEvent.registry.set(this.id, this);

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
    SignalEvent.registry.delete(this.id);
    this.resolve = null;
    this.reject = null;
  }

  public static trigger(id: string, value: unknown): void {
    const signal = SignalEvent.registry.get(id);
    if (signal) {
      LogChannel.log("signal", "triggering", signal.name);
      signal.trigger(value);
    } else {
      console.error("stale signal triggered", id);
      //throw new Error("stale signal triggered")
    }
  }
}

export class Signal<T> {
  public readonly current: T;
  public readonly next: Promise<T>;
  private _signal: SignalEvent<T>;
  public readonly name: string;

  constructor(name: string, initialValue: T) {
    this.name = name;
    this.current = initialValue;
    this._signal = new SignalEvent<T>(`${this.name}-0`);
    this.next = this._signal.wait();
  }

  public set(newValue: T): void {
    if (this.current === newValue) return;

    // The cast is necessary because we made .current readonly for consumers.
    (this as { current: T }).current = newValue;

    SignalEvent.trigger(this._signal.id, newValue);
    this._signal = new SignalEvent<T>(`${this.name}-${Date.now()}`);
    (this as { next: Promise<T> }).next = this._signal.wait();
  }

  public watch(handler: (value: T) => void): () => void {
    let active = true;

    handler(this.current);

    const runLoop = async () => {
      while (active) {
        try {
          const value = await this.next;
          if (active) {
            handler(value);
          }
        } catch (error) {
          if (active) {
            console.error(`Watch loop for '${this.name}' failed:`, error);
          }
          break;
        }
      }
    };
    runLoop();

    return () => {
      active = false;
    };
  }
}
